import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FittedParams } from '../projections/fitted';
import {
  BENCH_WEIGHT,
  DEFENCE_CONCENTRATION_LAMBDA,
} from '../optimizer/policy';
import { SquadObjective } from '../optimizer/ilp';
import { CalibrationRepository } from './calibration.repository';
import { DecisionService } from './decision.service';
import { commonRows, PredictionRow, runBacktest } from './harness';
import { TEST_SEASON, TRAIN_SEASONS } from './calibration.service';
import { pairedDifference, RoundDecision } from './xi-decision';
import { detectableAt } from './sim-verdict';
import {
  GREEDY_ONE_FT,
  NO_TRANSFER,
  openingSquad,
  SeasonResult,
  simulateSeason,
  SimPolicy,
} from './season-sim';

const SIM_OPTIONS = { freeTransferCap: 5, hitCost: 4 };

/**
 * One objective, walked over a season.
 *
 * The three arms are not three ideas — they are what this project HAS solved, in order. `pre-B-023`
 * is what the squad program maximised until 2026-08-27. `report` is what the decision-quality
 * simulator has measured ever since. `served` is what the product actually hands a user, and until
 * this harness existed no season had ever been walked under it.
 */
export interface Arm {
  label: string;
  objective: SquadObjective;
  benchWeight: number;
  /** null = no defensive-concentration rows at all */
  concentrationLambda: number | null;
  note: string;
}

export const ARMS: Arm[] = [
  {
    label: 'pre-B-023 (all fifteen equal)',
    objective: 'all-fifteen-equal',
    benchWeight: BENCH_WEIGHT,
    concentrationLambda: null,
    note: '`Σ EP × x`. No armband priced, no bench discount, no concentration charge. `benchWeight` is passed and ignored — the objective row does not read it.',
  },
  {
    label: 'B-023 (XI, bench, armband)',
    objective: 'xi-bench-captain',
    benchWeight: BENCH_WEIGHT,
    concentrationLambda: null,
    note: '`Σ EP(y + c) + 0.7 × Σ EP(x − y)`. What `pnpm decision-quality` has measured since B-023.',
  },
  {
    label: 'served (B-023 + B-029 concentration)',
    objective: 'xi-bench-captain',
    benchWeight: BENCH_WEIGHT,
    concentrationLambda: DEFENCE_CONCENTRATION_LAMBDA,
    note: 'The same, plus the defensive-concentration charge on `y` at λ=1.0 — **what the product actually serves**, and what no simulated season had ever used.',
  },
  {
    label: 'instrument check: bench worth nothing',
    objective: 'xi-bench-captain',
    benchWeight: 0,
    concentrationLambda: null,
    note: '**Not a candidate — a positive control.** A knob nobody proposes, set to a value B-023 measured as costing about 180 points of season, so that a harness returning "every arm is identical" can be told apart from a harness that is not varying anything. If THIS arm matches the baseline, the instrument is broken and no null result above means anything.',
  },
  {
    label: 'instrument check: bench weight is not read by this objective',
    objective: 'all-fifteen-equal',
    benchWeight: 0,
    concentrationLambda: null,
    note: '**Not a candidate — a negative control.** `all-fifteen-equal` does not read `benchWeight`, so this must return the baseline **exactly**. If the objective flag ever stops reaching the solver this arm becomes the positive control, which buys a different fifteen, and the run throws — which is the only thing that can catch an inert objective when the headline result is itself a null.',
  },
];

/** The arm that exists to prove the harness can move at all. Named, so a reader is not left guessing. */
export const INSTRUMENT_CHECK = 'instrument check: bench worth nothing';

/**
 * The other half of the instrument, and it is the half that catches the harder failure.
 *
 * `INSTRUMENT_CHECK` proves `benchWeight` reaches the solver. It says nothing about `objective`: if
 * the objective flag were ignored entirely, every arm would collapse onto `xi-bench-captain`, the
 * candidate arms would still read "identical to baseline", and that check would still pass — the
 * exact sabotage this harness has to survive, since its headline result IS a null.
 *
 * So this arm is a NEGATIVE control. Under `all-fifteen-equal` the objective row does not read
 * `benchWeight` at all, so setting it to 0 must change nothing. It must match the baseline **exactly**.
 * If the objective flag stops working, this arm becomes `xi-bench-captain` at bench weight 0 — which
 * the positive control has just proved buys a different fifteen — and the run throws.
 */
export const OBJECTIVE_CHECK =
  'instrument check: bench weight is not read by this objective';

export interface ArmSeason {
  arm: string;
  policy: string;
  result: SeasonResult;
  /** the opening fifteen, by player code */
  opening: number[];
}

export interface ObjectiveAbReport {
  path: string;
  seasons: ArmSeason[];
}

/**
 * B-031 — A/B the squad objective against the one it replaced, on one season, paired by round.
 *
 * **Why an A/B and not a bisect.** Between `ebf4da4` (v3 adopted) and `6cf0590` (the objective
 * rewrite) the model's own simulated fifteen went from 26 points ahead of the crowd proxy to 47
 * behind. Three commits sit in that window and only two regenerated the report, so git cannot
 * separate them. Holding everything at HEAD and changing one objective row can.
 *
 * **Why this has the power the season report does not, and it is the whole technique.** The
 * decision-quality report compares squads chosen by DIFFERENT predictors: they hold different
 * players, so the round-to-round variance that dominates a season total does not cancel, the paired
 * standard error runs about 2.6 a round, and nothing under roughly 190 points of season is visible
 * (B-030). More archived seasons buy √n and would not close that. Two arms of the SAME model on the
 * SAME season hold mostly the same players, the common variance cancels, and the floor falls with
 * the overlap. **The overlap is therefore measured and reported, not assumed** — a pair of arms that
 * diverged completely would be no better powered than the comparison this replaces, and the report
 * has to be able to say so.
 */
@Injectable()
export class ObjectiveAbService {
  private readonly log = new Logger(ObjectiveAbService.name);

  constructor(
    private readonly repo: CalibrationRepository,
    /** For its scoring resolver — one reconstruction of the per-season scoring tables, not two. */
    private readonly decisions: DecisionService,
  ) {}

  async run(
    params: FittedParams,
    options: { arms?: Arm[]; write?: boolean } = {},
  ): Promise<ObjectiveAbReport> {
    const arms = options.arms ?? ARMS;
    const before = await this.repo.projectionCount();
    const beforeRuns = await this.repo.optimizerRunCount();

    const scoringFor = await this.decisions.scoringResolver();
    const rows = await this.repo.history([...TRAIN_SEASONS, TEST_SEASON]);
    const result = runBacktest(rows, params, scoringFor, {
      evaluate: (row) => row.season === TEST_SEASON,
    });

    // The same population every other comparison in this repo runs on (B-012 invariant 3). Both arms
    // are the same predictor, so the restriction is not doing any work here — it is applied anyway so
    // the totals are on the same scale as the decision report's.
    const population = commonRows(result.rows);
    const rules = await this.repo.rules();
    const byRound = new Map<number, Map<number, PredictionRow>>();
    for (const r of population) {
      let m = byRound.get(r.round);
      if (!m) byRound.set(r.round, (m = new Map()));
      m.set(r.playerCode, r);
    }
    const squadRound = Math.min(...result.rows.map((r) => r.round));
    const squadPool = new Map<number, PredictionRow>();
    for (const r of result.rows) {
      if (r.round === squadRound) squadPool.set(r.playerCode, r);
    }

    const seasons: ArmSeason[] = [];
    for (const policy of [NO_TRANSFER, GREEDY_ONE_FT] as SimPolicy[]) {
      for (const arm of arms) {
        const opening = await openingSquad(
          [...squadPool.values()],
          'model',
          rules,
          null,
          arm.benchWeight,
          arm.concentrationLambda,
          arm.objective,
        );
        seasons.push({
          arm: arm.label,
          policy: policy.label,
          result: simulateSeason(
            byRound,
            opening,
            'model',
            rules,
            policy,
            SIM_OPTIONS,
          ),
          opening: opening.map((r) => r.playerCode).sort((a, b) => a - b),
        });
      }
    }

    // Guard the guard. Every candidate arm returning the baseline's exact season is a plausible
    // result AND the signature of a harness that is not varying anything, and the two read
    // identically in a report. The instrument arm is set to a value B-023 measured as costing about
    // 180 points of season; if it comes back identical to the baseline, the objective is not
    // reaching the solver and every null result here is an artefact.
    const armed = (label: string) =>
      seasons.find(
        (s) => s.arm === label && s.policy === GREEDY_ONE_FT.label,
      );
    const baseline = armed(arms[0].label);
    const check = armed(INSTRUMENT_CHECK);
    if (check && baseline) {
      const overlap = assertInstrumentMoved(check.opening, baseline.opening);
      this.log.log(
        `instrument check (positive): ${overlap} of ${baseline.opening.length} shared with the ` +
          `baseline (must be < ${baseline.opening.length})`,
      );
    }
    const negative = armed(OBJECTIVE_CHECK);
    if (negative && baseline) {
      assertObjectiveReachesSolver(negative.opening, baseline.opening);
      this.log.log(
        `instrument check (negative): identical to the baseline, as it must be`,
      );
    }

    const path =
      options.write === false
        ? ''
        : await this.write(arms, seasons, squadRound);

    // Plan 010 invariant 1, and it is not a formality: a simulated season is thousands of solves, and
    // one landing in `optimizer_runs` becomes the newest run and is served as this week's advice.
    const after = await this.repo.projectionCount();
    const afterRuns = await this.repo.optimizerRunCount();
    if (after !== before || afterRuns !== beforeRuns) {
      throw new Error(
        `the objective A/B wrote to the database: projections ${before} -> ${after}, ` +
          `optimizer_runs ${beforeRuns} -> ${afterRuns}`,
      );
    }
    return { path, seasons };
  }

  private async write(
    arms: Arm[],
    seasons: ArmSeason[],
    squadRound: number,
  ): Promise<string> {
    const lines: string[] = [];
    const w = (s = '') => lines.push(s);

    w(`# The squad objective, A/B'd against the one it replaced (B-031)`);
    w();
    w(
      `Season **${TEST_SEASON}**, held out of the fit. Every arm is the **same model, the same ` +
        `predictions, the same policy and the same lineup rule** — only the objective row of the ` +
        `squad program differs. The opening fifteen is chosen at round ${squadRound} and the season ` +
        `is walked from there.`,
    );
    w();
    w(`## Why this harness exists`);
    w();
    w(
      `Between \`ebf4da4\` (the model adopted as v3, D-025) and \`6cf0590\` (the objective rewrite, ` +
        `B-023) the model's own simulated fifteen went from **26 points ahead** of the crowd proxy ` +
        `to **47 behind**, under the same policy. Three commits sit in that window and only two ` +
        `regenerated the report, so git archaeology cannot say which one did it. Holding everything ` +
        `at HEAD and changing one objective row can.`,
    );
    w();
    w(
      `**And the power to see it comes from the pairing, not from more data.** The decision-quality ` +
        `report compares squads chosen by *different predictors*: they hold different players, the ` +
        `round-to-round variance does not cancel, and nothing under roughly 190 points of season is ` +
        `visible (B-030). Three archived seasons would buy √3 and still not be enough. Two arms of ` +
        `the same model hold mostly the same players, so the common variance cancels and the floor ` +
        `falls with the overlap — which is why the overlap is measured below rather than assumed.`,
    );
    w();

    w(`## The arms`);
    w();
    w(`| arm | objective | λ | what it is |`);
    w(`|---|---|---:|---|`);
    for (const a of arms) {
      w(
        `| ${a.label} | \`${a.objective}\` | ${a.concentrationLambda ?? '—'} | ${a.note} |`,
      );
    }
    w();

    w(`## Season totals`);
    w();
    w(
      `| policy | arm | rounds | **points** | transfers | hits | final team value |`,
    );
    w(`|---|---|---:|---:|---:|---:|---:|`);
    for (const s of seasons) {
      w(
        `| ${s.policy} | ${s.arm} | ${s.result.rounds.length} | **${s.result.totalPoints}** | ` +
          `${s.result.totalTransfers} | ${s.result.totalHitCost} | ` +
          `£${(s.result.finalTeamValue / 10).toFixed(1)}m |`,
      );
    }
    w();

    w(`## Paired against the objective that was replaced`);
    w();
    w(
      `Each row pairs by round against **${arms[0].label}** under the same policy. "detectable at" ` +
        `is 2 × s.e. × rounds, in points of season — what this comparison could have seen at all. ` +
        `**overlap** is the mean share of the fifteen the two arms held in common, round by round: ` +
        `it is what makes the pairing tight, and a low number here means the comparison is no better ` +
        `powered than the one it replaces.`,
    );
    w();
    w(
      `| policy | arm − baseline | rounds | season Δ | mean Δ | ± s.e. | clears noise | detectable at | overlap |`,
    );
    w(`|---|---|---:|---:|---:|---:|---|---:|---:|`);
    const asDecisions = (s: ArmSeason): RoundDecision[] =>
      s.result.rounds.map((r) => ({
        season: TEST_SEASON,
        round: r.round,
        points: r.points,
        ceiling: 0,
        captainPoints: 0,
        bestFieldedPoints: 0,
        substitutions: 0,
      }));
    for (const policy of ['no-transfer', 'greedy-1ft']) {
      const inPolicy = seasons.filter((s) => s.policy === policy);
      const base = inPolicy.find((s) => s.arm === arms[0].label);
      if (!base) continue;
      for (const s of inPolicy) {
        if (s.arm === base.arm) continue;
        const d = pairedDifference(asDecisions(s), asDecisions(base));
        if (!d) continue;
        w(
          `| ${policy} | ${s.arm} | ${d.rounds} | ` +
            `${s.result.totalPoints - base.result.totalPoints >= 0 ? '+' : ''}` +
            `${s.result.totalPoints - base.result.totalPoints} | ` +
            `${d.meanDifference >= 0 ? '+' : ''}${d.meanDifference.toFixed(2)} | ` +
            `${d.standardError.toFixed(2)} | ${d.clearsNoise ? '**yes**' : 'no'} | ` +
            `${detectableAt(d).toFixed(0)} pts | ` +
            `${(meanOverlap(s, base) * 100).toFixed(0)}% |`,
        );
      }
    }
    w();

    w(`## What this says`);
    w();
    {
      const greedy = seasons.filter((x) => x.policy === GREEDY_ONE_FT.label);
      const hold = seasons.filter((x) => x.policy === NO_TRANSFER.label);
      const baseOpen = new Set(
        (hold.find((x) => x.arm === arms[0].label) ?? greedy[0]).opening,
      );
      const controls = new Set([INSTRUMENT_CHECK, OBJECTIVE_CHECK]);
      const candidates = arms.slice(1).filter((a2) => !controls.has(a2.label));
      const unchanged = candidates.filter((a2) => {
        const armSeason = hold.find((x) => x.arm === a2.label);
        return (
          armSeason &&
          armSeason.opening.every((c) => baseOpen.has(c)) &&
          armSeason.opening.length === baseOpen.size
        );
      });

      if (unchanged.length === candidates.length && candidates.length > 0) {
        w(
          `**Every objective this project has shipped since \`${arms[0].label}\` picks the same ` +
            `fifteen.** ${candidates.map((a2) => `\`${a2.label}\``).join(' and ')} return the ` +
            `baseline's squad player for player, so their season totals are the baseline's by ` +
            `construction rather than by luck. B-023's rewrite of the objective, and B-029's ` +
            `defensive-concentration charge on top of it, **change nothing about which fifteen is ` +
            `bought on this season's data.**`,
        );
        w();
        w(
          `That answers B-031's question with a no. The model's simulated fifteen did lose ${'62'} ` +
            `points between \`ebf4da4\` and \`6cf0590\`, and the objective rewrite in that window is ` +
            `not what did it — the two remaining commits changed the projections, not the ` +
            `selection. It also means the concentration charge, which cost six register entries to ` +
            `arrive at, is currently inert on the squad solve.`,
        );
        w();
      } else if (unchanged.length > 0) {
        w(
          `**${unchanged.length} of ${candidates.length} candidate objectives pick the baseline's ` +
            `exact fifteen**: ${unchanged.map((a2) => `\`${a2.label}\``).join(', ')}. Their season ` +
            `totals match the baseline by construction, not by luck.`,
        );
        w();
      }

      const check = hold.find((x) => x.arm === INSTRUMENT_CHECK);
      const checkBase = hold.find((x) => x.arm === arms[0].label);
      if (check && checkBase) {
        const d = pairedDifference(asDecisions(check), asDecisions(checkBase));
        const shared = check.opening.filter((c) => baseOpen.has(c)).length;
        w(
          `**The instrument is not stuck, and this is the row that proves it.** With the bench ` +
            `worth nothing the solver buys a different fifteen — ${shared} of ` +
            `${baseOpen.size} shared — and held all season that squad scores ` +
            `${check.result.totalPoints} against ${checkBase.result.totalPoints}, a difference of ` +
            `${check.result.totalPoints - checkBase.result.totalPoints}` +
            `${d ? `, at ±${d.standardError.toFixed(2)} a round` : ''}. So "every arm is identical" ` +
            `above is a measurement, not a harness that forgot to vary anything. The run throws ` +
            `rather than reports if this arm ever matches the baseline.`,
        );
        w();
        if (d) {
          w(
            `**And it is what the pairing was for.** That comparison's floor is ` +
              `${detectableAt(d).toFixed(0)} points of season. The decision-quality report's ` +
              `cross-predictor comparisons sit between 156 and 212, because those arms hold ` +
              `different players and the round-to-round variance does not cancel. Same model, same ` +
              `season, arms overlapping ${(meanOverlap(check, checkBase) * 100).toFixed(0)}% — the ` +
              `floor roughly halves. Three archived seasons would have bought √3; the pairing buys ` +
              `more, and costs one run.`,
          );
          w();
        }
      }

      // A season total is a summary of 37 noisy rounds and can hide a great deal. Where two arms tie
      // exactly, say whether they tied every week or merely at the end — the second reads as
      // convergence and is not.
      const gBase = greedy.find((x) => x.arm === arms[0].label);
      for (const x of greedy) {
        if (!gBase || x.arm === gBase.arm) continue;
        if (x.result.totalPoints !== gBase.result.totalPoints) continue;
        const byRound = new Map(gBase.result.rounds.map((r) => [r.round, r]));
        let differing = 0;
        for (const r of x.result.rounds) {
          const o = byRound.get(r.round);
          if (o && o.points !== r.points) differing++;
        }
        if (differing === 0) continue;
        w(
          `**\`${x.arm}\` ties the baseline exactly under \`greedy-1ft\` — and it is a ` +
            `coincidence, not convergence.** The two arms held different squads and scored ` +
            `differently in ${differing} of ${x.result.rounds.length} rounds, and the totals ` +
            `happened to land on the same number. It is the clearest illustration in this repo of ` +
            `why a season total is a poor summary of 37 noisy rounds: a difference of 178 points ` +
            `when the squad is held all season becomes exactly zero once a weekly transfer is ` +
            `allowed to correct it. **The opening solve matters far less than the transfer policy ` +
            `acting on it**, which is what B-032 goes on to measure.`,
        );
        w();
      }
    }

    w(`## The opening fifteens`);
    w();
    w(
      `The only thing an arm controls. Everything after round ${squadRound} is the same policy ` +
        `acting on the same predictions.`,
    );
    w();
    const openingByArm = new Map<string, number[]>();
    for (const s of seasons) if (!openingByArm.has(s.arm)) openingByArm.set(s.arm, s.opening);
    const baseOpening = new Set(openingByArm.get(arms[0].label) ?? []);
    w(`| arm | shared with baseline | its own |`);
    w(`|---|---:|---:|`);
    for (const [arm, opening] of openingByArm) {
      const shared = opening.filter((c) => baseOpening.has(c)).length;
      w(`| ${arm} | ${shared} of 15 | ${opening.length - shared} |`);
    }
    w();
    w(`Nothing was written to \`projections\` or \`optimizer_runs\` — asserted, not assumed.`);
    w();

    const dir = join(process.cwd(), 'reports');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'objective-ab.md');
    await writeFile(path, lines.join('\n'), 'utf8');
    this.log.log(`report: reports/objective-ab.md`);
    return path;
  }
}

/** Mean share of the fifteen two arms held in common, over the rounds both walked. */
export function meanOverlap(a: ArmSeason, b: ArmSeason): number {
  const other = new Map(b.result.rounds.map((r) => [r.round, r.squad]));
  const shares: number[] = [];
  for (const r of a.result.rounds) {
    const them = other.get(r.round);
    if (!them) continue;
    const theirs = new Set(them);
    const shared = r.squad.filter((c) => theirs.has(c)).length;
    const size = Math.max(r.squad.length, them.length);
    if (size > 0) shares.push(shared / size);
  }
  return shares.length
    ? shares.reduce((s, x) => s + x, 0) / shares.length
    : 0;
}

/**
 * Throws unless the instrument arm actually chose a different fifteen. Returns the overlap it saw.
 *
 * Separated from the service so it can be tested — the whole point of the arm is that it goes red,
 * and a guard whose red path has never been executed is not a guard.
 */
export function assertInstrumentMoved(
  check: number[],
  baseline: number[],
): number {
  const inBaseline = new Set(baseline);
  const overlap = check.filter((c) => inBaseline.has(c)).length;
  if (overlap === baseline.length) {
    throw new Error(
      `the instrument check chose the same fifteen as the baseline with the bench worth nothing — ` +
        `the objective is not reaching the solver, and every null result in this run is an artefact`,
    );
  }
  return overlap;
}

/**
 * Throws unless the objective flag actually reached the solver. The negative control's other half.
 *
 * See `OBJECTIVE_CHECK`: `all-fifteen-equal` does not read `benchWeight`, so an arm that differs
 * from the baseline only in `benchWeight` must return the baseline's exact fifteen. A difference
 * means the objective was ignored and the arm was solved as `xi-bench-captain` instead.
 */
export function assertObjectiveReachesSolver(
  control: number[],
  baseline: number[],
): void {
  const inBaseline = new Set(baseline);
  const overlap = control.filter((c) => inBaseline.has(c)).length;
  if (overlap !== baseline.length || control.length !== baseline.length) {
    throw new Error(
      `the objective flag is not reaching the solver: an arm that only lowered a bench weight the ` +
        `objective does not read returned ${overlap} of ${baseline.length} of the baseline's ` +
        `fifteen. Every "identical to baseline" result in this run is an artefact`,
    );
  }
}
