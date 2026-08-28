import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Scoring } from '../projections/scoring';
import {
  FittedParams,
  FITTED_PARAMS,
  UNFITTED_PARAMS,
} from '../projections/fitted';
import { scoringForSeason } from '../archive/archive-scoring';
import { CalibrationRepository } from './calibration.repository';
import { HistoryRow } from '../projections/features';
import {
  commonRows,
  excludedRows,
  observationsFor,
  runBacktest,
} from './harness';
import {
  byPosition,
  byPriceBand,
  calibrationCurve,
  describePopulation,
  errorStats,
  ErrorStats,
  Observation,
  PopulationSummary,
} from './metrics';
import { fitParams, FitReport } from './fit';

/**
 * The calibration harness (B-007 Phase 3) and the fit that feeds it (Phase 4).
 *
 * The split that makes the numbers mean anything:
 *
 *   TRAIN     2023-24 + first half of 2024-25   — what the fit may learn from
 *   VALIDATE  second half of 2024-25            — chooses shape parameters only
 *   TEST      2025-26                           — scored once, never fitted on
 *   HELD OUT  live 2026/27                      — not touched here at all
 *
 * The defensive-contribution term is the exception and is labelled one everywhere it appears: the
 * category exists only in 2025-26, so it cannot be both fitted and held out across seasons. It is
 * fitted on 2025-26 GW1–19 and the test report carries that fact rather than implying a clean split.
 */

/**
 * Every season the archive holds except the held-out one.
 *
 * Was `['2023-24', '2024-25']` while the archive went back only that far. Extending it to 2016-17
 * (253,568 rows, all points-verified) takes the training corpus from 57,008 rows to 223,821.
 *
 * The older seasons are NOT the same shape and nothing here pretends they are, and the two boundaries
 * are one season apart: expected goals start in **2022-23** and the `starts` column in **2023-24**
 * (measured 2026-08-28 — 2022-23 has zero non-null start rows; `archive/coverage.ts` is the table and
 * the assertion). Those rows carry NULL for the columns they lack and every
 * consumer excludes them from the terms they cannot speak to — the start curve is fitted on the
 * rows that have a start label, the xG rates on the minutes that have an xG. What the older seasons
 * DO carry is minutes, points, goals, assists, clean sheets, saves and bonus, which is most of the
 * model, and a previous season for every row that had one.
 */
/**
 * The two seasons the served model is fitted on — unchanged, and now MEASURED rather than inherited.
 *
 * The archive holds ten seasons and this list can take all nine trainable ones. Simulating 2025-26
 * under `greedy-1ft`, with the fitted-availability block stripped so every arm is the regime the
 * model actually serves:
 *
 *     two seasons, no decay                 1833
 *     nine seasons, no decay                1895
 *     nine seasons, one-season half-life    1959
 *     what currently ships                  1926
 *
 * More seasons helps, and down-weighting the old ones helps again — which is what the league's own
 * discontinuities predict (five substitutions from 2022-23; home advantage gone in the
 * behind-closed-doors 2020-21). But 1959 against 1926 is under a point a round, inside the noise
 * this project says a 37-round comparison cannot resolve, and the half-life behind it was chosen on
 * the test season. So the corpus stays at two until that is done properly on validation.
 */
export const TRAIN_SEASONS = ['2023-24', '2024-25'];
export const TEST_SEASON = '2025-26';
/** rounds of 2024-25 reserved for choosing shape parameters */
const VALIDATE_FROM_ROUND = 20;
/**
 * The defensive-contribution split, inside the one season that has the category.
 *
 * Rounds 1-12 fit it, 13-19 choose its shape parameter, and 20-38 are never used for it. It cannot be
 * held out across seasons the way everything else is, so it is held out within one — and the report
 * says so rather than implying a clean split.
 */
export const DEFCON_FIT_ROUND = 12;
export const DEFCON_FIT_MAX_ROUND = 19;

export interface CalibrationReport {
  label: string;
  generatedFor: string;
  model: ErrorStats;
  baselineForm: ErrorStats;
  baselinePriorSeason: ErrorStats;
  /**
   * Kept for the pairwise tables, NOT as a verdict. D-020: MAE over the whole field is minimised by
   * predicting that nobody scores, so "beats the baselines on MAE" is not a statement about whether
   * this model makes better decisions. That question is `DecisionService`'s.
   */
  beatsForm: boolean;
  beatsPriorSeason: boolean;
  path: string;
}

@Injectable()
export class CalibrationService {
  private readonly log = new Logger(CalibrationService.name);

  constructor(private readonly repo: CalibrationRepository) {}

  /** Fit on the training seasons and print what changed. Writes no parameters — the caller does. */
  async fit(): Promise<FitReport> {
    const scoringFor = await this.scoringResolver();
    const all = await this.repo.history([...TRAIN_SEASONS, TEST_SEASON]);

    // Reads TRAIN_SEASONS. It used to name the two seasons inline, which meant the constant decided
    // only which rows were LOADED and the fit silently kept training on the same two however the
    // corpus grew — a widened archive would have produced a "ten-season fit" whose numbers came from
    // two, and nothing in the output would have said so. The validation reservation stays attached
    // to the season it belongs to.
    const VALIDATE_SEASON = '2024-25';
    const train = all.filter(
      (r) =>
        TRAIN_SEASONS.includes(r.season) &&
        (r.season !== VALIDATE_SEASON || r.round < VALIDATE_FROM_ROUND),
    );
    // The ONLY rows of the test season the fit may touch, and only the defcon parameters read them.
    // They were once folded into `train`, where the frequency measurements iterated them as well — so
    // a quarter of the "held-out" season informed every measured parameter while the provenance said
    // just the one term was affected.
    const defconTrain = all.filter(
      (r) => r.season === TEST_SEASON && r.round <= DEFCON_FIT_ROUND,
    );
    const validate = all.filter(
      (r) => r.season === VALIDATE_SEASON && r.round >= VALIDATE_FROM_ROUND,
    );
    // Only the test season has the defensive-contribution category, so its shape parameter is
    // validated on the rounds between the fit window and the held-out remainder.
    const defconValidate = all.filter(
      (r) =>
        r.season === TEST_SEASON &&
        r.round > DEFCON_FIT_ROUND &&
        r.round <= DEFCON_FIT_MAX_ROUND,
    );

    this.log.log(
      `fitting on ${train.length} rows, validating on ${validate.length}; ` +
        `defcon only: ${defconTrain.length} fit / ${defconValidate.length} validate`,
    );
    return fitParams({
      train,
      defconTrain,
      validate,
      defconValidate,
      scoringFor,
    });
  }

  /**
   * Score a model on the held-out test season and write the report.
   *
   * `params` is explicit so the same harness scores the unfitted baseline and the fitted model on
   * identical rows — a fitted model that cannot beat the guesses it replaced has changed the code and
   * nothing else, and that has to be visible rather than assumed.
   */
  async evaluate(
    label: string,
    params: FittedParams,
  ): Promise<CalibrationReport> {
    const before = await this.repo.projectionCount();
    const scoringFor = await this.scoringResolver();
    const rows = await this.repo.history([...TRAIN_SEASONS, TEST_SEASON]);

    const result = runBacktest(rows, params, scoringFor, {
      evaluate: (row) => row.season === TEST_SEASON,
    });

    // Every comparison runs on the rows BOTH of its predictors could score, PAIRWISE (B-012
    // invariant 3). Not a single three-way intersection: `priorSeason` needs 450 minutes last
    // season, so intersecting all three at once shrinks the population to 11,648 of 29,482 and
    // answers "does the model beat form" on a set of rows chosen by a third predictor that the
    // question does not involve. Pairwise gives each comparison the largest population that is
    // genuinely common to it.
    const vsForm = commonRows(result.rows, ['model', 'form']);
    const vsPrior = commonRows(result.rows, ['model', 'priorSeason']);
    const model = errorStats(observationsFor(vsForm, 'model'));
    const baselineForm = errorStats(observationsFor(vsForm, 'form'));
    const baselinePriorSeason = errorStats(
      observationsFor(vsPrior, 'priorSeason'),
    );

    const path = await this.writeReport(label, params, result, rows);

    const after = await this.repo.projectionCount();
    if (after !== before) {
      throw new Error(
        `the harness wrote to projections (${before} → ${after}). Invariant 1 exists because a ` +
          `backtest row becomes the newest by createdAt and would then be served as the live model.`,
      );
    }

    return {
      label,
      generatedFor: TEST_SEASON,
      model,
      baselineForm,
      baselinePriorSeason,
      beatsForm: model.mae < baselineForm.mae,
      beatsPriorSeason:
        errorStats(observationsFor(vsPrior, 'model')).mae <
        baselinePriorSeason.mae,
      path,
    };
  }

  /**
   * One `Scoring` per season, resolved once.
   *
   * A season with no reconstructed table falls back to the live config and says so loudly — scoring a
   * season under another season's rules is a silent error, and the defensive-contribution category
   * makes it a large one.
   */
  /**
   * The scoring table to use per season, cached.
   *
   * Public because `ComponentCalibrationService` scores the same seasons and must use the SAME
   * tables — a second copy of this resolver is a second answer to "what were the rules that year",
   * and the two reports would disagree without either being wrong on its own terms.
   *
   * `seasons` defaults to the ones the served fit reads; the rolling-origin referee (B-040) passes all
   * ten. The resolver still throws on a season it was not built for rather than quietly reaching for
   * the live table — a season scored with another season's rules is a silent error, which is why the
   * fallback inside the loop warns even where it is the only answer available.
   */
  async scoringResolver(
    seasons: readonly string[] = [...TRAIN_SEASONS, TEST_SEASON],
  ): Promise<(season: string) => Scoring> {
    const cache = new Map<string, Scoring>();
    let live: Scoring | null = null;

    for (const season of seasons) {
      const table = scoringForSeason(season);
      if (table) {
        cache.set(season, Scoring.from(table.scoring));
        continue;
      }
      this.log.warn(
        `${season}: no reconstructed scoring table — falling back to the live config, which prices ` +
          `categories this season may not have had.`,
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
    params: FittedParams,
    result: ReturnType<typeof runBacktest>,
    rows: HistoryRow[],
  ): Promise<string> {
    // Pairwise, not a single three-way intersection — see `evaluate`.
    const vsForm = commonRows(result.rows, ['model', 'form']);
    const vsPrior = commonRows(result.rows, ['model', 'priorSeason']);
    const common = vsForm;
    const excluded = excludedRows(result.rows, ['model', 'form']);
    const model = errorStats(observationsFor(vsForm, 'model'));
    const form = errorStats(observationsFor(vsForm, 'form'));
    const modelVsPrior = errorStats(observationsFor(vsPrior, 'model'));
    // `form` and the model on the rows that ALSO carry a prior-season baseline — i.e. players with
    // 450+ minutes last season. Same comparison, different population, and the contrast is the point.
    const established = commonRows(result.rows, [
      'model',
      'form',
      'priorSeason',
    ]);
    const prior = errorStats(observationsFor(vsPrior, 'priorSeason'));

    // The same three on every row each predictor could reach, which is what B-007 reported and what
    // made its headline gap partly bookkeeping. Kept beside the headline so the difference between
    // the two tables IS the finding, rather than something a reader has to be told about.
    const modelAll = errorStats(observationsFor(result.rows, 'model'));
    const formAll = errorStats(observationsFor(result.rows, 'form'));
    const priorAll = errorStats(observationsFor(result.rows, 'priorSeason'));

    const lines: string[] = [];
    const w = (s = '') => lines.push(s);

    w(`# Calibration — ${label}`);
    w();
    w(`Test season: **${TEST_SEASON}**, held out of the fit.`);
    w(
      `Trained on ${TRAIN_SEASONS.join(' + ')} (2024-25 rounds ${VALIDATE_FROM_ROUND}+ reserved for ` +
        `choosing shape parameters). Live 2026/27 is not touched here at all.`,
    );
    w();
    w(
      `**The defensive-contribution parameters are the one exception to the holdout.** That category ` +
        `exists only in ${TEST_SEASON}, so its dispersion was fitted on rounds 1–${DEFCON_FIT_ROUND} ` +
        `of this very season and its rate parameter chosen on rounds ${DEFCON_FIT_ROUND + 1}–` +
        `${DEFCON_FIT_MAX_ROUND}. Those rows are passed to the fit separately and **no other parameter ` +
        `reads them**. Rounds ${DEFCON_FIT_MAX_ROUND + 1}–38 are untouched by the fit entirely. The ` +
        `defcon term's contribution to the headline below is therefore not held out; everything else ` +
        `is.`,
    );
    w();
    w(`## Headline`);
    w();
    w(
      `**Each comparison runs on the rows both of its predictors could score.** That restriction is ` +
        `B-012's, and it changes the answer: a baseline scored over a different population is not a ` +
        `comparison. \`form\` produces no number for a player with no trailing round — a season debut, ` +
        `a return from a long injury, a new signing — and those are the hardest rows in the corpus, ` +
        `so leaving them on one side of the comparison only made part of the gap bookkeeping.`,
    );
    w();
    w(
      `**Pairwise rather than one three-way intersection**, because \`priorSeason\` needs 450 minutes ` +
        `last season and intersecting all three at once would answer "does this model beat \`form\`" ` +
        `on a population chosen by a third predictor the question does not involve.`,
    );
    w();
    w(`### Against \`form\` — trailing 4 rounds`);
    w();
    w(`| Model | n | MAE | RMSE | bias | mean predicted | mean actual |`);
    w(`|---|---:|---:|---:|---:|---:|---:|`);
    w(row('this model', model));
    w(row('baseline: form', form));
    w();
    w(
      model.mae < form.mae
        ? `**Beats \`form\` on MAE** (and ${model.rmse < form.rmse ? 'on' : 'not on'} RMSE).`
        : `**Does not beat \`form\` on MAE** (${model.rmse < form.rmse ? 'it does on RMSE' : 'nor on RMSE'}).`,
    );
    w();
    w(`### Against last season's points per 90`);
    w();
    w(`| Model | n | MAE | RMSE | bias | mean predicted | mean actual |`);
    w(`|---|---:|---:|---:|---:|---:|---:|`);
    w(row('this model', modelVsPrior));
    w(row('baseline: last season points/90', prior));
    w();
    w(
      modelVsPrior.mae < prior.mae
        ? `**Beats last season's points per 90 on MAE.**`
        : `**Does not beat last season's points per 90 on MAE.**`,
    );
    w();
    w(`### Against \`form\`, restricted to established players`);
    w();
    w(
      `The same two predictors on the rows that also carry a prior-season baseline — which is a ` +
        `filter for **450+ minutes last season**, so it is a filter for players who actually play. ` +
        `This is not a third baseline; it is the same \`form\` comparison on a different population, ` +
        `and the gap between this table and the one above is the most useful number in the report.`,
    );
    w();
    w(`| Model | n | MAE | RMSE | bias | mean predicted | mean actual |`);
    w(`|---|---:|---:|---:|---:|---:|---:|`);
    w(row('this model', errorStats(observationsFor(established, 'model'))));
    w(row('baseline: form', errorStats(observationsFor(established, 'form'))));
    w();
    {
      const m = errorStats(observationsFor(established, 'model'));
      const b = errorStats(observationsFor(established, 'form'));
      w(
        m.mae < b.mae
          ? `**Beats \`form\` here**, on rows where it loses over the full field. The difference ` +
              `between the two populations is fringe players: rows where the outcome is usually ` +
              `zero, where a near-zero prediction is very hard to beat on MAE, and which a squad ` +
              `optimiser never chooses between. That is the case for reading MAE over the whole ` +
              `field as the wrong verdict (D-020) — measured rather than argued.`
          : `**Does not beat \`form\` here either**, which removes the "MAE is dominated by fringe ` +
              `players" explanation for the headline. That explanation is D-020's, and this is the ` +
              `test of it.`,
      );
    }
    w();
    w(`### The same three on every row each could reach`);
    w();
    w(
      `Not a comparison — three different populations. Kept because it is what was reported before ` +
        `B-012, so the effect of the restriction is visible rather than described.`,
    );
    w();
    w(`| Model | n | MAE | RMSE | bias | mean predicted | mean actual |`);
    w(`|---|---:|---:|---:|---:|---:|---:|`);
    w(row('this model', modelAll));
    w(row('baseline: form (trailing 4 rounds)', formAll));
    w(row('baseline: last season points/90', priorAll));
    w();
    w(`### The rows the restriction costs`);
    w();
    w(
      `The rows the \`form\` comparison had to leave out. A count invites the reader to assume they ` +
        `were unremarkable; they are not — they are the players nobody had a trailing number for.`,
    );
    w();
    w(population(describePopulation(excluded)));
    w();
    w(
      `**MAE over the whole field is not the verdict** (D-020, and B-012 replaces it). It is ` +
        `minimised by the conditional median, and most rows are players who barely feature, so a ` +
        `predictor that says near-zero for everyone wins it while telling a squad optimiser nothing. ` +
        `The decision metrics — ordering, XI and captain choice, a simulated season — live in ` +
        `\`reports/decision-quality.md\`. Whatever this file says, the model version is not bumped on ` +
        `a negative result there, and the serving version is not deleted until its successor beats it.`,
    );
    w();
    w(`### Baseline availability`);
    w();
    w(
      `\`ep_next\` is **not** among the baselines here and cannot be: the archive's \`xP\` is FPL's ` +
        `\`ep_this\` scraped after each gameweek and is post-match contaminated, so it is not stored. ` +
        `\`ep_next\` is scored only against live gameweeks with a captured deadline snapshot ` +
        `(B-007 Phase 2).`,
    );
    w();
    w(`## By position`);
    w();
    w(`| Position | n | MAE | RMSE | bias |`);
    w(`|---|---:|---:|---:|---:|`);
    for (const p of byPosition(observationsFor(common, 'model'))) {
      w(
        `| ${p.label} | ${p.stats.n} | ${f(p.stats.mae)} | ${f(p.stats.rmse)} | ${f(p.stats.bias)} |`,
      );
    }
    w();
    w(`## By price band`);
    w();
    w(
      `A single mean hides a directional error, which is the kind that matters most to an optimiser ` +
        `— every comparison it makes is skewed the same way. B-004's finding 1 said the premium head ` +
        `read 2–4× \`ep_next\`; **that was measured against FPL's own model rather than against ` +
        `realised points, and against realised points it is false** (D-020). The bands below are the ` +
        `record of what the error actually is.`,
    );
    w();
    w(`| Band | n | MAE | bias | mean predicted | mean actual |`);
    w(`|---|---:|---:|---:|---:|---:|`);
    for (const b of byPriceBand(observationsFor(common, 'model'))) {
      w(
        `| ${b.label} | ${b.stats.n} | ${f(b.stats.mae)} | ${f(b.stats.bias)} | ` +
          `${f(b.stats.meanPredicted)} | ${f(b.stats.meanActual)} |`,
      );
    }
    w();
    w(`## Calibration`);
    w();
    w(
      `Error says how far off a prediction is; calibration says whether the model means what it says. ` +
        `A model can carry a respectable MAE and still be systematically high everywhere, which for a ` +
        `squad optimiser is worse than noise — every comparison it makes is skewed the same way.`,
    );
    w();
    w(`| Predicted band | n | mean predicted | mean actual |`);
    w(`|---|---:|---:|---:|`);
    for (const b of calibrationCurve(observationsFor(common, 'model'))) {
      if (b.n === 0) continue;
      const upper = b.upper === Infinity ? '∞' : b.upper.toFixed(0);
      w(
        `| ${b.lower.toFixed(0)}–${upper} | ${b.n} | ${f(b.meanPredicted)} | ${f(b.meanActual)} |`,
      );
    }
    w();
    w(`## Rows not scored`);
    w();
    if (result.skipped.length === 0) w(`None.`);
    else {
      w(`| Reason | n |`);
      w(`|---|---:|`);
      for (const s of result.skipped) w(`| ${s.reason} | ${s.n} |`);
    }
    w();
    w(`## Parameters used`);
    w();
    w('```json');
    w(JSON.stringify(params, null, 2));
    w('```');
    w();
    w(
      `Corpus: ${rows.length} archive player-gameweeks. Nothing was written to \`projections\` — ` +
        `asserted, not assumed.`,
    );
    w();

    const dir = 'reports';
    await mkdir(dir, { recursive: true });
    const path = join(dir, `calibration-${label}.md`);
    await writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }
}

function row(label: string, s: ErrorStats): string {
  return (
    `| ${label} | ${s.n} | ${f(s.mae)} | ${f(s.rmse)} | ${f(s.bias)} | ` +
    `${f(s.meanPredicted)} | ${f(s.meanActual)} |`
  );
}

function f(x: number): string {
  return x.toFixed(3);
}

/** Renders an excluded/included population as a small markdown block. */
function population(p: PopulationSummary): string {
  if (p.n === 0) return 'None — every predictor scored every row.';
  const lines: string[] = [];
  lines.push(
    `**${p.n} rows**, mean actual **${f(p.meanActual)}**, ` +
      `**${(p.blankShare * 100).toFixed(1)}%** of them zero minutes.`,
  );
  lines.push('');
  lines.push('| Split | n | mean actual |');
  lines.push('|---|---:|---:|');
  for (const r of p.byPosition) {
    lines.push(`| ${r.label} | ${r.n} | ${f(r.meanActual)} |`);
  }
  for (const r of p.byPriceBand) {
    if (r.n === 0) continue;
    lines.push(`| ${r.label} | ${r.n} | ${f(r.meanActual)} |`);
  }
  return lines.join('\n');
}

export { UNFITTED_PARAMS, FITTED_PARAMS };
export type { Observation };
