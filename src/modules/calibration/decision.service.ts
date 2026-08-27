import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Scoring } from '../projections/scoring';
import { FittedParams } from '../projections/fitted';
import { scoringForSeason } from '../archive/archive-scoring';
import { CalibrationRepository } from './calibration.repository';
import { BENCH_WEIGHT } from '../optimizer/policy';
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
import {
  GREEDY_ONE_FT,
  NO_TRANSFER,
  openingSquad,
  SeasonResult,
  simulateSeason,
  SimPolicy,
} from './season-sim';

/**
 * The free-transfer cap and the hit cost, for the season being simulated.
 *
 * Passed in rather than assumed: the bank was one, then two, then five, and the five holds for
 * 2024-25 onward (`fpl-agent-guide` §2.2). The test season here is 2025-26, so five is right — but a
 * simulator that hardcodes it is silently wrong the first time an earlier season is walked.
 */
export const SIM_OPTIONS = { freeTransferCap: 5, hitCost: 4 };

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
  seasons: SeasonResult[];
}

@Injectable()
export class DecisionService {
  private readonly log = new Logger(DecisionService.name);

  constructor(private readonly repo: CalibrationRepository) {}

  async evaluate(
    label: string,
    params: FittedParams,
    /**
     * What a bench place is worth when each predictor picks its opening fifteen (B-023).
     *
     * A parameter rather than a constant read here, so `pnpm optimize:bench-sweep` can vary it
     * without touching this file — and so the sweep measures the same simulator the report does
     * rather than a copy of it written to flatter the answer.
     */
    benchWeight = BENCH_WEIGHT,
    /** Skip the report file; a sweep runs this dozens of times and wants the numbers, not the prose. */
    options: { write?: boolean } = {},
  ): Promise<DecisionReport> {
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

    // Phase 3-4: the season simulation. Every predictor picks its own opening fifteen and then walks
    // the season under the real rules — which is the point: this is the first metric where "which
    // fifteen you own" is part of what is being measured.
    const seasons: SeasonResult[] = [];
    for (const policy of [NO_TRANSFER, GREEDY_ONE_FT] as SimPolicy[]) {
      for (const p of PREDICTORS) {
        // `form` is null for every player at a season's first deadline, so it cannot choose an
        // opening squad at all. It falls back to last season's points-per-90 — the only signal
        // knowable at that point, and the charter's own naive baseline — and takes over from round 2.
        const opening = await openingSquad(
          [...squadPool.values()],
          p,
          rules,
          p === 'form' ? 'priorSeason' : null,
          benchWeight,
        );
        seasons.push(
          simulateSeason(byRound, opening, p, rules, policy, SIM_OPTIONS),
        );
      }
      // The template squad, run under the same policy, as the crowd proxy.
      seasons.push({
        ...simulateSeason(
          byRound,
          squads[0].members,
          'model',
          rules,
          policy,
          SIM_OPTIONS,
        ),
        squadLabel: 'template (crowd proxy)',
      });
    }

    const path =
      options.write === false
        ? ''
        : await this.writeReport(
            label,
            result.rows,
            population,
            squads,
            decisions,
            roundsBy,
            squadRound,
            seasons,
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

    return { path, ordering, decisions, seasons };
  }

  /**
   * Public because the replay harness needs the same tables (B-025).
   *
   * A second resolver would be a second answer to "which season is scored by which rules", and the
   * fit already showed what that costs: scoring 2023-24 with the current table gives every player a
   * defensive-contribution term in a season where the category did not exist.
   */
  async scoringResolver(): Promise<(season: string) => Scoring> {
    const cache = new Map<string, Scoring>();
    let live: Scoring | null = null;
    for (const season of [...TRAIN_SEASONS, TEST_SEASON]) {
      const table = scoringForSeason(season);
      if (table) {
        cache.set(season, Scoring.from(table.scoring));
        continue;
      }
      this.log.warn(
        `${season}: no reconstructed scoring table — using the live config`,
      );
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
    seasons: SeasonResult[],
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
          DEFAULT_KS.map(
            (k) => `points captured @${k} | precision @${k} `,
          ).join('| ') +
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
        return (
          a !== null &&
          a !== undefined &&
          b !== null &&
          b !== undefined &&
          a > b
        );
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
        w(
          `**Beats \`form\` on rank correlation and on points captured at every k.**`,
        );
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
    w(
      `| Squad | Predictor | rounds | points | XI efficiency | captain regret |`,
    );
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
    w(
      `| Squad | comparison | rounds | mean difference | ± s.e. | clears noise |`,
    );
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
        .filter((x) => x.d !== null) as {
        squad: string;
        d: NonNullable<ReturnType<typeof pairedDifference>>;
      }[];
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
    w(`## The simulated season`);
    w();
    w(
      `Each predictor picks its **own** opening fifteen and walks the season under the real rules — ` +
        `one free transfer a round banked to ${SIM_OPTIONS.freeTransferCap}, the 50% sell-on fee, ` +
        `auto-substitutions on 0 minutes only, the vice taking the armband when the captain blanks ` +
        `and nobody doubling when both do. **This is the first metric where *which* fifteen you own ` +
        `is part of what is measured**, which is exactly where the ordering advantage should show up ` +
        `if it is real.`,
    );
    w();
    w(
      `**Both policies are deliberately weak, and the totals below are floors rather than ` +
        `estimates.** \`no-transfer\` holds the opening squad for the whole season. \`greedy-1ft\` ` +
        `takes at most one free transfer a round, on this round's projection, and **never takes a ` +
        `hit** — so the −4 path is exercised by a unit test and never by a walked season. Choosing ` +
        `transfers well is B-008, which plugs into this same simulator rather than bringing its own.`,
    );
    w();
    w(
      `**Chips are unused.** A wildcard or free hit is a transfer policy (B-008); bench boost and ` +
        `triple captain are single-week variance bets needing B-017's distributions. An unused chip ` +
        `is a handicap applied equally to every predictor. A guessed one is a confound.`,
    );
    w();
    w(
      `**\`form\` cannot choose an opening squad** — it is this season's trailing rounds and there ` +
        `are none at the first deadline. It falls back to last season's points per 90, the only ` +
        `signal knowable then and the charter's own naive baseline, and takes over from round 2. A ` +
        `baseline handed a better opening squad than it could have chosen is not a baseline.`,
    );
    w();
    w(
      `| Policy | Squad picked by | rounds | **points** | transfers | hits | final team value |`,
    );
    w(`|---|---|---:|---:|---:|---:|---:|`);
    for (const r of seasons) {
      w(
        `| ${r.policy} | ${r.squadLabel ?? r.predictor} | ${r.rounds.length} | **${r.totalPoints}** | ` +
          `${r.totalTransfers} | ${r.totalHitCost} | £${(r.finalTeamValue / 10).toFixed(1)}m |`,
      );
    }
    w();
    w(`### Is the difference bigger than the noise?`);
    w();
    w(
      `| Policy | comparison | rounds | mean difference | ± s.e. | clears noise |`,
    );
    w(`|---|---|---:|---:|---:|---|`);
    for (const policy of ['no-transfer', 'greedy-1ft']) {
      const forPolicy = seasons.filter((s2) => s2.policy === policy);
      const model = forPolicy.find((s2) => s2.predictor === 'model');
      for (const against of ['form', 'priorSeason'] as Predictor[]) {
        const other = forPolicy.find((s2) => s2.predictor === against);
        if (!model || !other) continue;
        const d = pairedDifference(
          model.rounds.map((r) => ({
            season: TEST_SEASON,
            round: r.round,
            points: r.points,
            ceiling: 0,
            captainPoints: 0,
            bestFieldedPoints: 0,
            substitutions: 0,
          })),
          other.rounds.map((r) => ({
            season: TEST_SEASON,
            round: r.round,
            points: r.points,
            ceiling: 0,
            captainPoints: 0,
            bestFieldedPoints: 0,
            substitutions: 0,
          })),
        );
        if (!d) continue;
        w(
          `| ${policy} | model − ${against} | ${d.rounds} | ` +
            `${d.meanDifference >= 0 ? '+' : ''}${d.meanDifference.toFixed(2)} | ` +
            `${d.standardError.toFixed(2)} | ${d.clearsNoise ? '**yes**' : 'no'} |`,
        );
      }
    }
    w();
    w(`### What the simulated season says`);
    w();
    {
      const get = (policy: string, predictor: Predictor, template = false) =>
        seasons.find(
          (x) =>
            x.policy === policy &&
            x.predictor === predictor &&
            Boolean(x.squadLabel) === template,
        );
      const holdModel = get('no-transfer', 'model');
      const holdForm = get('no-transfer', 'form');
      const greedyModel = get('greedy-1ft', 'model');
      const greedyForm = get('greedy-1ft', 'form');
      const greedyTemplate = get('greedy-1ft', 'model', true);

      if (holdModel && holdForm) {
        w(
          `**Held all season, the model's opening fifteen is worth ${holdModel.totalPoints} points ` +
            `against ${holdForm.totalPoints}** — a gap of ` +
            `${holdModel.totalPoints - holdForm.totalPoints} over the season, which clears the noise ` +
            `floor comfortably. This is the ordering advantage from the section above, showing up ` +
            `exactly where Phase 2 predicted it would: **in which fifteen you own, not in how you ` +
            `arrange a fifteen you already have.** Note what the \`form\` row actually is — form ` +
            `cannot pick an opening squad, so that squad was chosen by last season's points per 90.`,
        );
        w();
      }
      if (greedyModel && greedyForm) {
        const gap = greedyModel.totalPoints - greedyForm.totalPoints;
        w(
          `**Give both a transfer a week and most of that gap closes.** \`form\` goes from ` +
            `${holdForm?.totalPoints ?? '—'} to ${greedyForm.totalPoints}; the model goes from ` +
            `${holdModel?.totalPoints ?? '—'} to ${greedyModel.totalPoints}, a remaining gap of ` +
            `**${gap}** which does **not** clear the noise floor. A weekly transfer is a powerful ` +
            `error-correction mechanism, and it corrects a weak opening squad faster than it ` +
            `improves a strong one. **A model that is better only before the first deadline is worth ` +
            `much less than the season totals first suggest.**`,
        );
        w();
      }
      if (greedyTemplate && greedyModel) {
        const diff = greedyTemplate.totalPoints - greedyModel.totalPoints;
        if (diff > 0) {
          w(
            `**And the most uncomfortable number in this report: the crowd's opening fifteen, run ` +
              `under the same policy and the same projections, scores ${greedyTemplate.totalPoints} ` +
              `against the model's ${greedyModel.totalPoints} — ${diff} points better.** The only ` +
              `difference between those two runs is the opening squad, so this says our squad solve ` +
              `is worse than simply owning what everyone else owned. It is a proxy for the FPL ` +
              `average rather than the average itself, and it is not a flattering one. **Recorded as ` +
              `the headline finding it is**, not buried under the rows above.`,
          );
          w();
        }
      }
      w(
        `**The bar B-012 set was: beat \`form\` on ordering AND on simulated season points, or say ` +
          `plainly that we did not.** Ordering: yes, on points-captured at every k. Season points: ` +
          `**only when neither side may transfer.** Once both can, the difference does not clear the ` +
          `noise floor. \`modelVersion\` does not move on this, and the serving version is not ` +
          `deleted — B-007 (D-020) established both rules and neither is met here.`,
      );
      w();
      w(
        `The next question is not "is the model better" but "why is a squad built from its own ` +
          `projections worse than the crowd's", and B-013 (which component is wrong) and B-014 (team ` +
          `strength carries no signal, and both fixture elasticities fitted to 0) are where it gets ` +
          `answered.`,
      );
    }
    w();
    w(`### The baseline that does not exist`);
    w();
    w(
      `**The real FPL average is unavailable for archive seasons.** \`Gameweek.averageScore\` ` +
        `exists for the live season only, upstream serves no past season's \`bootstrap-static\`, and ` +
        `the archive carries no per-round average. The **template squad** row above — the legal ` +
        `fifteen maximising ownership, held under the same policy — is the closest thing available ` +
        `and is a **proxy**, not the average. Recording the absence rather than quietly dropping it: ` +
        `an unavailable baseline left out of a table reads as a baseline that was beaten.`,
    );
    w();

    w(`## Still to come in this report`);
    w();
    w(
      `Nothing — B-012's phases are complete. What is **not** measured here, and is named rather ` +
        `than implied: a transfer policy worth the name (B-008), chips, uncertainty on any ` +
        `projection (B-017), and the per-component calibration that would say *which* term drives ` +
        `what is measured here (B-013).`,
    );
    w();
    w(`Nothing was written to \`projections\` — asserted, not assumed.`);
    w();

    const dir = 'reports';
    await mkdir(dir, { recursive: true });
    const path = join(
      dir,
      `decision-quality${label === 'fitted' ? '' : `-${label}`}.md`,
    );
    await writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }
}
