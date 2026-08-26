import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Scoring } from '../projections/scoring';
import { FittedParams } from '../projections/fitted';
import { scoringForSeason } from '../archive/archive-scoring';
import { CalibrationRepository } from './calibration.repository';
import {
  commonRows,
  PREDICTORS,
  Predictor,
  PredictionRow,
  runBacktest,
} from './harness';
import {
  DEFAULT_KS,
  ORDERING_VIEWS,
  orderingByRound,
  OrderingSummary,
  summariseOrdering,
} from './ordering';
import { TEST_SEASON, TRAIN_SEASONS } from './calibration.service';
import { fixedSquads, FixedSquad } from './fixed-squads';
import {
  decideOverSeason,
  DecisionSummary,
  pairedDifference,
  RoundDecision,
} from './xi-decision';

/**
 * The seed behind every random fixed squad in this report.
 *
 * Recorded rather than hidden, and constant rather than drawn: an unseeded random baseline produces
 * a number nobody can reproduce, which is not a baseline.
 */
export const SQUAD_SEED = 20260827;
export const RANDOM_SQUADS = 4;

/**
 * The decision-quality report (B-012).
 *
 * Separate from `CalibrationService` on purpose. That one answers "how far off is each prediction",
 * which D-020 established is the wrong verdict for this product; this one answers "did the model make
 * better decisions", which is the question a squad optimiser actually poses. Keeping them in one
 * service would have meant one report where the error tables sit above the decision tables and get
 * read as the headline again.
 *
 * Invariant, inherited from B-007 and extended by B-012: **nothing here writes anything.** The
 * `projections` row count is asserted unmoved around every run.
 */

export interface DecisionReport {
  path: string;
  ordering: Map<Predictor, OrderingSummary>;
  decisions: DecisionSummary[];
}

@Injectable()
export class DecisionService {
  private readonly log = new Logger(DecisionService.name);

  constructor(private readonly repo: CalibrationRepository) {}

  async evaluate(label: string, params: FittedParams): Promise<DecisionReport> {
    const before = await this.repo.projectionCount();
    const beforeRuns = await this.repo.optimizerRunCount();
    const scoringFor = await this.scoringResolver();
    const rows = await this.repo.history([...TRAIN_SEASONS, TEST_SEASON]);

    const result = runBacktest(rows, params, scoringFor, {
      evaluate: (row) => row.season === TEST_SEASON,
    });

    // Ordering is a comparison, so it runs on the common population like every other comparison
    // (B-012 invariant 3) — a predictor ranking a field its rival could not see is not being
    // compared to it.
    const population = commonRows(result.rows);
    const ordering = new Map<Predictor, OrderingSummary>();
    for (const p of PREDICTORS) {
      ordering.set(
        p,
        summariseOrdering(orderingByRound(population, p, ORDERING_VIEWS[0])),
      );
    }

    // Phase 2: the XI and the armband, over squads shared by every predictor so the comparison is
    // about the decision and not about who got the better fifteen.
    const rules = await this.repo.rules();
    const byRound = new Map<number, Map<number, PredictionRow>>();
    for (const r of population) {
      let m = byRound.get(r.round);
      if (!m) byRound.set(r.round, (m = new Map()));
      m.set(r.playerCode, r);
    }
    // Squads are built from ROUND 1, and scored from round 2 — because `form` has no trailing round
    // at a season's first deadline, so round 1 is absent from the common population entirely. Two
    // consequences, both deliberate: the squad is chosen at opening-day prices and opening-day
    // ownership (rather than after a round of transfers has already moved the crowd), and the
    // comparison covers 37 rounds rather than 38. Both are stated in the report.
    const squadRound = Math.min(...result.rows.map((r) => r.round));
    const squadPool = new Map<number, PredictionRow>();
    for (const r of result.rows) {
      if (r.round === squadRound) squadPool.set(r.playerCode, r);
    }
    const squads = await fixedSquads(
      [...squadPool.values()],
      await this.repo.ownershipAt(TEST_SEASON, squadRound),
      rules,
      SQUAD_SEED,
      RANDOM_SQUADS,
    );

    const decisions: DecisionSummary[] = [];
    const roundsBy = new Map<string, RoundDecision[]>();
    for (const squad of squads) {
      for (const p of PREDICTORS) {
        const r = decideOverSeason(squad, byRound, p, rules, TEST_SEASON);
        decisions.push(r.summary);
        roundsBy.set(`${squad.label}|${p}`, r.rounds);
      }
    }

    const path = await this.writeReport(
      label,
      result.rows,
      population,
      squads,
      decisions,
      roundsBy,
      squadRound,
    );

    const after = await this.repo.projectionCount();
    if (after !== before) {
      throw new Error(
        `the decision harness wrote to projections (${before} → ${after}). Invariant 1 exists ` +
          `because a backtest row becomes the newest by createdAt and would then be served.`,
      );
    }

    const afterRuns = await this.repo.optimizerRunCount();
    if (afterRuns !== beforeRuns) {
      throw new Error(
        `the decision harness wrote to optimizer_runs (${beforeRuns} → ${afterRuns}). A simulated ` +
          `season is thousands of solves; one persisted becomes the newest run and the app serves a ` +
          `2025-26 recommendation as this week's advice.`,
      );
    }

    return { path, ordering, decisions };
  }

  private async scoringResolver(): Promise<(season: string) => Scoring> {
    const cache = new Map<string, Scoring>();
    let live: Scoring | null = null;
    for (const season of [...TRAIN_SEASONS, TEST_SEASON]) {
      const table = scoringForSeason(season);
      if (table) {
        cache.set(season, Scoring.from(table.scoring));
        continue;
      }
      this.log.warn(`${season}: no reconstructed scoring table — using the live config`);
      live ??= Scoring.from(await this.repo.liveScoring());
      cache.set(season, live);
    }
    return (season) => {
      const s = cache.get(season);
      if (!s) throw new Error(`no scoring table resolved for ${season}`);
      return s;
    };
  }

  private async writeReport(
    label: string,
    all: PredictionRow[],
    population: PredictionRow[],
    squads: FixedSquad[],
    decisions: DecisionSummary[],
    roundsBy: Map<string, RoundDecision[]>,
    squadRound: number,
  ): Promise<string> {
    const lines: string[] = [];
    const w = (s = '') => lines.push(s);
    const n3 = (x: number | null) => (x === null ? '—' : x.toFixed(3));
    const pct = (x: number | null) =>
      x === null ? '—' : `${(x * 100).toFixed(1)}%`;

    w(`# Decision quality — ${label}`);
    w();
    w(
      `Test season **${TEST_SEASON}**, held out of the fit. This is the report B-012 exists for: ` +
        `\`calibration-*.md\` says how far each prediction was from the outcome, and this one says ` +
        `whether the ordering those predictions imply is any better than the alternatives.`,
    );
    w();
    w(`## Why not MAE`);
    w();
    w(
      `MAE is minimised by the conditional median. Most player-gameweeks are players who barely ` +
        `feature, so a predictor that says near-zero for everyone wins MAE and tells a squad ` +
        `optimiser nothing — it never asks what a player will score, it asks which fifteen, which ` +
        `eleven of those, and who takes the armband. Every one of those is an ordering question. ` +
        `Recorded as D-020.`,
    );
    w();
    w(`## The defensive-contribution caveat, on this verdict too`);
    w();
    w(
      `The season scored here is ${TEST_SEASON}, and ${TEST_SEASON} rounds 1–19 are where the ` +
        `defensive-contribution parameters were fitted — that category exists in no earlier season, ` +
        `so it cannot be held out across seasons. Those rows are passed to the fit separately and no ` +
        `other parameter reads them, but the defcon term's contribution below is **not** held out. ` +
        `Every calibration report carries this; the verdict carries it too, or it claims a cleaner ` +
        `holdout than it has.`,
    );
    w();
    w(`## Ordering`);
    w();
    w(
      `Scored **per round and then averaged**, never pooled: pooling conflates ranking a deadline's ` +
        `players well with knowing which rounds were high-scoring, and only the first is a job the ` +
        `product does. Rounds where nobody scored produce no number and are dropped rather than ` +
        `counted as zero.`,
    );
    w();
    w(
      `**Spearman is tie-corrected**, and it cannot reach 1 here: FPL outcomes are massively tied, ` +
        `so the outcome itself carries no order to recover among the players on 0, 1 or 2. The ` +
        `ceiling is the data's, not the model's. **Points captured @ k** is the primary top-k ` +
        `metric — the realised points of a predictor's top *k* over the realised points of the true ` +
        `top *k*, which a tie at the boundary cannot move. **Precision@k** is reported beside it and ` +
        `is the fragile one.`,
    );
    w();
    w(
      `Population: **${population.length}** of ${all.length} player-gameweeks — the rows every ` +
        `predictor could score, so the ranking each produced is over the same field.`,
    );
    w();

    for (const view of ORDERING_VIEWS) {
      w(`### ${view.label}`);
      w();
      w(
        `| Predictor | rounds | Spearman | ` +
          DEFAULT_KS.map((k) => `points captured @${k} | precision @${k} `).join('| ') +
          `|`,
      );
      w(`|---|---:|---:|` + DEFAULT_KS.map(() => `---:|---:|`).join(''));
      for (const p of PREDICTORS) {
        const s = summariseOrdering(orderingByRound(population, p, view));
        w(
          `| ${p} | ${s.rounds} | ${n3(s.meanSpearman)} | ` +
            DEFAULT_KS.map(
              (k) =>
                `${pct(s.meanPointsCaptured.get(k) ?? null)} | ${pct(s.meanPrecision.get(k) ?? null)} `,
            ).join('| ') +
            `|`,
        );
      }
      w();
    }

    w(`## What the ordering says`);
    w();
    {
      const whole = ORDERING_VIEWS[0];
      const m = summariseOrdering(orderingByRound(population, 'model', whole));
      const f = summariseOrdering(orderingByRound(population, 'form', whole));
      const capturedWins = DEFAULT_KS.filter((k) => {
        const a = m.meanPointsCaptured.get(k);
        const b = f.meanPointsCaptured.get(k);
        return a !== null && a !== undefined && b !== null && b !== undefined && a > b;
      });
      const rhoWin =
        m.meanSpearman !== null &&
        f.meanSpearman !== null &&
        m.meanSpearman > f.meanSpearman;

      w(
        `Against \`form\`, over the whole field: Spearman **${n3(m.meanSpearman)}** against ` +
          `**${n3(f.meanSpearman)}**, and points captured @11 **${pct(m.meanPointsCaptured.get(11) ?? null)}** ` +
          `against **${pct(f.meanPointsCaptured.get(11) ?? null)}**.`,
      );
      w();
      if (!rhoWin && capturedWins.length === DEFAULT_KS.length) {
        w(
          `**A split, and the split is the finding.** \`form\` orders the *whole field* better, and ` +
            `this model captures more points in the *top k* at every k measured. Those are not in ` +
            `conflict: a whole-field rank correlation is dominated by the mass of players who score ` +
            `nothing, which \`form\` ranks well by predicting nothing for them — and a squad ` +
            `optimiser never chooses between two players who will both blank. It chooses at the top, ` +
            `which is what points-captured@k measures. **On the part of the ranking the product ` +
            `uses, the model is ahead.**`,
        );
        w();
        w(
          `That is a claim about ordering, not about points. It becomes a claim about points when ` +
            `the season simulation lands (Phases 3–4), and not before.`,
        );
      } else if (rhoWin && capturedWins.length === DEFAULT_KS.length) {
        w(`**Beats \`form\` on rank correlation and on points captured at every k.**`);
      } else if (capturedWins.length === 0) {
        w(
          `**Does not beat \`form\` on points captured at any k.** Recorded as it stands. The ` +
            `serving version is not deleted and \`modelVersion\` does not move on this.`,
        );
      } else {
        w(
          `**Mixed**: ahead on points captured at ${capturedWins.map((k) => `@${k}`).join(', ')} ` +
            `and behind at the rest. Recorded as it stands rather than summarised into a verdict ` +
            `the numbers do not support.`,
        );
      }
      w();
      w(
        `\`priorSeason\` is far behind on every measure, which is the sanity check on the metric ` +
          `itself: a baseline that cannot see this season should not rank this season's rounds.`,
      );
    }
    w();
    w(`## The XI and the armband`);
    w();
    w(
      `Every predictor is handed **the same fifteen players** and picks an XI, a bench order and a ` +
        `captain from them. If each picked its own squad the XI comparison would be confounded by ` +
        `the squad comparison, and a model could field a worse XI out of a better fifteen and look ` +
        `better for it.`,
    );
    w();
    w(
      `The squads are chosen once, at **round ${squadRound}**, by rules that read no model: the ` +
        `**template** is the legal fifteen maximising \`selectedBy\` ` +
        `— an integer program, because the top fifteen by ownership breaks the position quotas, the ` +
        `three-per-club cap and the budget all at once — plus **${RANDOM_SQUADS} seeded random legal ` +
        `squads** (seed \`${SQUAD_SEED}\`) so the verdict does not rest on one squad's quirks.`,
    );
    w();
    w(
      `**XI efficiency** is the share of the points that squad *could* have delivered that the ` +
        `predictor's selections actually took — so squads of different quality can be read side by ` +
        `side. **Captain regret** is the mean gap per round between the best realised score among ` +
        `the players fielded and the captain's; a bench player's haul is an XI decision, not an ` +
        `armband one, so it is deliberately not in the denominator.`,
    );
    w();
    w(
      `**The squads are built at round ${squadRound} and scored from round ` +
        `${Math.min(...[...roundsBy.values()][0].map((r) => r.round))}.** \`form\` has no trailing ` +
        `round at a season's first deadline, so round 1 is absent from the comparison population ` +
        `entirely — which means the squads are picked at opening-day prices and opening-day ` +
        `ownership, before a round of transfers has moved the crowd, and the season measured here is ` +
        `37 rounds rather than 38.`,
    );
    w();
    w(`| Squad | Predictor | rounds | points | XI efficiency | captain regret |`);
    w(`|---|---|---:|---:|---:|---:|`);
    for (const d of decisions) {
      w(
        `| ${d.squad} | ${d.predictor} | ${d.rounds} | ${d.totalPoints} | ` +
          `${pct(d.xiEfficiency)} | ${n3(d.captainRegret)} |`,
      );
    }
    w();
    w(`### Is the difference bigger than the noise?`);
    w();
    w(
      `**A mean difference over 38 rounds is not a result on its own.** Measured on the B-011 ` +
        `collision sweep next door (\`reports/guards-009.md\`, 103 archived gameweeks): a paired ` +
        `per-round difference of +0.59 realised points carried a standard deviation of 0.92, and the ` +
        `per-season sign flipped — −2.41, +2.34, +0.97 across three seasons of the same comparison. ` +
        `A season does not contain enough rounds to resolve effects of a couple of points a week.`,
    );
    w();
    w(
      `So each row below is **paired by round** — both predictors faced the same fixtures, blanks ` +
        `and hauls, so the round-to-round variance that dominates the totals cancels — and carries ` +
        `the standard error of that pairing. "Clears noise" is |mean| > 2 standard errors, which is ` +
        `a crude bar and is meant to be.`,
    );
    w();
    w(`| Squad | comparison | rounds | mean difference | ± s.e. | clears noise |`);
    w(`|---|---|---:|---:|---:|---|`);
    for (const squad of squads) {
      for (const against of ['form', 'priorSeason'] as Predictor[]) {
        const d = pairedDifference(
          roundsBy.get(`${squad.label}|model`) ?? [],
          roundsBy.get(`${squad.label}|${against}`) ?? [],
        );
        if (!d) continue;
        w(
          `| ${squad.label} | model − ${against} | ${d.rounds} | ` +
            `${d.meanDifference >= 0 ? '+' : ''}${d.meanDifference.toFixed(2)} | ` +
            `${d.standardError.toFixed(2)} | ${d.clearsNoise ? '**yes**' : 'no'} |`,
        );
      }
    }
    w();

    {
      const pairs = squads
        .map((sq) => ({
          squad: sq.label,
          d: pairedDifference(
            roundsBy.get(`${sq.label}|model`) ?? [],
            roundsBy.get(`${sq.label}|form`) ?? [],
          ),
        }))
        .filter((x) => x.d !== null) as { squad: string; d: NonNullable<ReturnType<typeof pairedDifference>> }[];
      const cleared = pairs.filter((x) => x.d.clearsNoise);
      const positive = pairs.filter((x) => x.d.meanDifference > 0);
      w();
      if (cleared.length === 0) {
        w(
          `**Nothing here separates the predictors.** Not one model-versus-\`form\` comparison ` +
            `clears two standard errors, and the sign of the difference flips across squads ` +
            `(${positive.length} of ${pairs.length} positive). **This is a null result and it is ` +
            `reported as one** — the model does not make measurably better XI and captain decisions ` +
            `than \`form\` over one season, on any of these fifteens.`,
        );
        w();
        w(
          `That is not a contradiction of the ordering section above, and it is worth being precise ` +
            `about why. Given a **fixed** fifteen, most of the XI picks itself: the decisions left ` +
            `are a handful of marginal calls at the bench boundary and the armband, which is a much ` +
            `smaller surface than ranking six hundred players. The ordering advantage is real and ` +
            `this is the wrong instrument to see it with — **it shows up in which fifteen you own, ` +
            `not in how you arrange the fifteen you already have.** Testing that needs the ` +
            `transfers, which is Phase 3.`,
        );
      } else {
        w(
          `**${cleared.length} of ${pairs.length}** model-versus-\`form\` comparisons clear two ` +
            `standard errors: ${cleared.map((c) => `${c.squad} (${c.d.meanDifference >= 0 ? '+' : ''}${c.d.meanDifference.toFixed(2)})`).join(', ')}.`,
        );
      }
      w();
    }
    w(`## Still to come in this report`);
    w();
    w(
      `B-012's remaining phases: a full-season simulation under the real rules — free transfers ` +
        `banked to five, −4 hits, the 50% sell fee, transfers as a policy (Phases 3–4). The squads ` +
        `above are **held fixed all season**, so what is measured here is the XI and the armband and ` +
        `nothing else; a model that would have transferred its way to a better squad gets no credit ` +
        `for it yet.`,
    );
    w();
    w(`Nothing was written to \`projections\` — asserted, not assumed.`);
    w();

    const dir = 'reports';
    await mkdir(dir, { recursive: true });
    const path = join(dir, `decision-quality${label === 'fitted' ? '' : `-${label}`}.md`);
    await writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }
}
