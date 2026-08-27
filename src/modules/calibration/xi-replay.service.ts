import { Injectable, Logger } from '@nestjs/common';
import highsLoader from 'highs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FittedParams } from '../projections/fitted';
import { BENCH_WEIGHT, COLLISION_LAMBDA } from '../optimizer/policy';
import { CalibrationRepository } from './calibration.repository';
import { DecisionService } from './decision.service';
import { TEST_SEASON, TRAIN_SEASONS } from './calibration.service';
import { PredictionRow, runBacktest } from './harness';
import { openingSquad } from './season-sim';
import {
  fixturesForRound,
  replaySeason,
  ReplayResult,
  ReplayRound,
} from './xi-replay';

/**
 * `pnpm replay:xi` — the harness B-025 exists to build, wired to the archive.
 *
 * One arm per run, named by the caller. The objective under test is whatever this commit's `ilp.ts`
 * emits, so the two arms of B-025 are two runs at two commits rather than a branch inside the code:
 * a harness that could switch objectives would need an `if` in the thing being measured, and the arm
 * that is not being served is the one nobody would keep correct.
 *
 * **Nothing here writes to the database.** The projection and optimizer-run counts are asserted
 * unmoved around the walk, the same invariant the decision harness carries — a backtest row becomes
 * the newest by `createdAt` and would then be served as this week's advice.
 */

export interface ReplayReport {
  path: string;
  result: ReplayResult;
  /** the round the fifteen was bought in */
  squadRound: number;
  /** the fifteen, as "webName (POS, Tn)" — a report a human can check against the solve */
  squad: string[];
}

@Injectable()
export class XiReplayService {
  private readonly log = new Logger(XiReplayService.name);

  constructor(
    private readonly repo: CalibrationRepository,
    private readonly decisions: DecisionService,
  ) {}

  async run(
    label: string,
    params: FittedParams,
    options: {
      benchWeight?: number;
      collisionLambda?: number;
      write?: boolean;
    } = {},
  ): Promise<ReplayReport> {
    const benchWeight = options.benchWeight ?? BENCH_WEIGHT;
    const collisionLambda = options.collisionLambda ?? COLLISION_LAMBDA;

    const before = await this.repo.projectionCount();
    const beforeRuns = await this.repo.optimizerRunCount();

    const scoringFor = await this.decisions.scoringResolver();
    const rows = await this.repo.history([...TRAIN_SEASONS, TEST_SEASON]);
    const result = runBacktest(rows, params, scoringFor, {
      evaluate: (row) => row.season === TEST_SEASON,
    });
    const rules = await this.repo.rules();

    const byRound = new Map<number, Map<number, PredictionRow>>();
    for (const r of result.rows) {
      let m = byRound.get(r.round);
      if (!m) byRound.set(r.round, (m = new Map()));
      m.set(r.playerCode, r);
    }
    if (byRound.size === 0) {
      throw new Error(
        `no ${TEST_SEASON} rows to replay — run \`pnpm import:archive\` first`,
      );
    }

    // The opening fifteen is bought in the first round the model can speak about, at that round's
    // prices, and held to the last. `model` only: this harness compares two objectives against each
    // other, not two predictors against each other, and running the baselines through it would
    // triple the solve count to answer a question the decision report already answers.
    const squadRound = Math.min(...byRound.keys());
    const openingPool = [...(byRound.get(squadRound) ?? new Map()).values()];
    const opening = await openingSquad(
      openingPool,
      'model',
      rules,
      null,
      benchWeight,
      {
        fixtures: fixturesForRound(byRound.get(squadRound)!),
        lambda: collisionLambda,
      },
    );

    const highs = await highsLoader();
    const replayed = replaySeason(
      TEST_SEASON,
      byRound,
      opening,
      'model',
      rules,
      (lp) => highs.solve(lp),
      { label, benchWeight, collisionLambda },
    );

    const after = await this.repo.projectionCount();
    if (after !== before) {
      throw new Error(
        `the replay harness wrote to projections (${before} → ${after})`,
      );
    }
    const afterRuns = await this.repo.optimizerRunCount();
    if (afterRuns !== beforeRuns) {
      throw new Error(
        `the replay harness wrote to optimizer_runs (${beforeRuns} → ${afterRuns})`,
      );
    }

    const squad = opening.map(
      (p) => `${p.webName} (${p.position}, T${p.teamCode})`,
    );
    this.log.log(
      `${label}: ${replayed.rounds.length} rounds, ${replayed.totalPoints} points, ` +
        `${replayed.roundsForgoingEp} rounds forgoing ${replayed.totalEpForgone.toFixed(1)} projected points`,
    );

    const path =
      options.write === false
        ? ''
        : await this.writeReport(replayed, squadRound, squad);
    return { path, result: replayed, squadRound, squad };
  }

  /**
   * One file, one section per arm, replaced in place by label.
   *
   * The alternative was a file per run plus a hand-written summary, and a hand-written summary of a
   * measurement is a number nobody can re-derive. Sections are keyed by their heading, so re-running
   * an arm overwrites that arm and leaves the other one exactly as its own run left it.
   */
  private async writeReport(
    result: ReplayResult,
    squadRound: number,
    squad: string[],
  ): Promise<string> {
    const dir = join(process.cwd(), 'reports');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'xi-replay.md');

    const heading = `## ${result.label}`;
    const lines: string[] = [heading, ''];
    const w = (s = '') => lines.push(s);

    w(
      `Bench weight ${result.benchWeight}, collision lambda ${result.collisionLambda}. Season ${TEST_SEASON}, ` +
        `fifteen bought in round ${squadRound} and held — no transfers, so every difference between ` +
        `arms is the objective.`,
    );
    w();
    w('| | |');
    w('|---|---:|');
    w(`| rounds | ${result.rounds.length} |`);
    w(`| realised points (the LP's own XI) | ${result.totalPoints} |`);
    w(`| ceiling (best XI these fifteen could field) | ${result.totalCeiling} |`);
    w(
      `| XI efficiency | ${result.xiEfficiency === null ? '—' : `${(result.xiEfficiency * 100).toFixed(1)}%`} |`,
    );
    w(`| rounds owning a conflicting pair | ${result.roundsOwningAPair} |`);
    w(`| rounds starting both sides of one | ${result.roundsStartingAPair} |`);
    w(
      `| projected points forgone in the XI and armband | ${result.totalEpForgone.toFixed(2)} |`,
    );
    w(`| rounds forgoing any | ${result.roundsForgoingEp} |`);
    w();

    w('**The fifteen.** ' + squad.join(', ') + '.');
    w();

    const worst = [...result.rounds]
      .filter((r) => r.forgone.length > 0)
      .sort((a, b) => b.epForgone - a.epForgone)
      .slice(0, 10);
    if (worst.length === 0) {
      w(
        '**No round benched a better-projected player for a worse one.** That is the claim this ' +
          'harness exists to be able to make or refuse, and here it is made.',
      );
    } else {
      w(
        '**Rounds where the solver benched a better-projected player**, worst first. This is the ' +
          'shape of the GW2 complaint that opened B-025, counted over a season rather than argued ' +
          'from one solve.',
      );
      w();
      w('| round | forgone | benched | for |');
      w('|---:|---:|---|---|');
      for (const r of worst) {
        for (const swap of r.forgone) {
          w(
            `| ${r.round} | ${(swap.benchedEp - swap.startedEp).toFixed(2)} | ` +
              `${swap.benched} (${swap.benchedEp.toFixed(2)}) | ${swap.started} (${swap.startedEp.toFixed(2)}) |`,
          );
        }
      }
      w();
    }

    w('<details><summary>Every round</summary>');
    w();
    w('| round | points | ceiling | formation | owned pairs | started | captain exposure | forgone |');
    w('|---:|---:|---:|---|---:|---:|---:|---:|');
    for (const r of result.rounds) w(roundRow(r));
    w();
    w('</details>');
    w();

    const existing = await readFile(path, 'utf8').catch(() => '');
    const kept = existing
      .split(/^## /m)
      .slice(1)
      .map((chunk) => `## ${chunk}`)
      .filter((chunk) => !chunk.startsWith(`${heading}\n`));

    const header = [
      '# The XI replay (B-025)',
      '',
      "What the solver's OWN eleven scored, round by round, over an archived season. Every other",
      'harness in this repo re-chooses the lineup by predicted points and is therefore blind to the',
      "LP's `y` and `k` columns — which is how a knob acting only through them came to be tuned on",
      'measurements that could not observe it.',
      '',
      'One section per arm. Regenerate with `pnpm replay:xi -- --label <arm>`.',
      '',
    ].join('\n');

    await writeFile(
      path,
      [header, ...kept, lines.join('\n')].join('\n').replace(/\n{3,}/g, '\n\n'),
      'utf8',
    );
    return path;
  }
}

function roundRow(r: ReplayRound): string {
  return (
    `| ${r.round} | ${r.points} | ${r.ceiling} | ${r.formation} | ${r.ownedPairs} | ` +
    `${r.startedPairs} | ${r.captainConflicts} | ${r.epForgone.toFixed(2)} |`
  );
}
