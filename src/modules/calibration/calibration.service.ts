import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Scoring } from '../projections/scoring';
import { FittedParams, FITTED_PARAMS, UNFITTED_PARAMS } from '../projections/fitted';
import { scoringForSeason } from '../archive/archive-scoring';
import { CalibrationRepository } from './calibration.repository';
import { HistoryRow } from './features';
import { runBacktest } from './harness';
import {
  byPosition,
  byPriceBand,
  calibrationCurve,
  errorStats,
  ErrorStats,
  Observation,
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

    const train = all.filter(
      (r) =>
        r.season === '2023-24' ||
        (r.season === '2024-25' && r.round < VALIDATE_FROM_ROUND),
    );
    // The ONLY rows of the test season the fit may touch, and only the defcon parameters read them.
    // They were once folded into `train`, where the frequency measurements iterated them as well — so
    // a quarter of the "held-out" season informed every measured parameter while the provenance said
    // just the one term was affected.
    const defconTrain = all.filter(
      (r) => r.season === TEST_SEASON && r.round <= DEFCON_FIT_ROUND,
    );
    const validate = all.filter(
      (r) => r.season === '2024-25' && r.round >= VALIDATE_FROM_ROUND,
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
    return fitParams({ train, defconTrain, validate, defconValidate, scoringFor });
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

    const model = errorStats(result.model);
    const baselineForm = errorStats(result.baselineForm);
    const baselinePriorSeason = errorStats(result.baselinePriorSeason);

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
      beatsPriorSeason: model.mae < baselinePriorSeason.mae,
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
  private async scoringResolver(): Promise<(season: string) => Scoring> {
    const cache = new Map<string, Scoring>();
    let live: Scoring | null = null;

    for (const season of [...TRAIN_SEASONS, TEST_SEASON]) {
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
    const model = errorStats(result.model);
    const form = errorStats(result.baselineForm);
    const prior = errorStats(result.baselinePriorSeason);

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
    w(`| Model | n | MAE | RMSE | bias | mean predicted | mean actual |`);
    w(`|---|---:|---:|---:|---:|---:|---:|`);
    w(row('this model', model));
    w(row('baseline: form (trailing 4 rounds)', form));
    w(row('baseline: last season points/90', prior));
    w();
    w(
      model.mae < form.mae && model.mae < prior.mae
        ? `**Beats both baselines on MAE.**`
        : `**Does NOT beat both baselines on MAE.** Recorded as it stands; the model version is not ` +
            `bumped on a negative result (B-007, maintainer decision 2026-08-26).`,
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
    for (const p of byPosition(result.model)) {
      w(
        `| ${p.label} | ${p.stats.n} | ${f(p.stats.mae)} | ${f(p.stats.rmse)} | ${f(p.stats.bias)} |`,
      );
    }
    w();
    w(`## By price band`);
    w();
    w(
      `The known defect is head-specific — the premium head read 2–4× \`ep_next\` (archive B-004, ` +
        `finding 1) — so a single mean would hide exactly the thing this exists to measure.`,
    );
    w();
    w(`| Band | n | MAE | bias | mean predicted | mean actual |`);
    w(`|---|---:|---:|---:|---:|---:|`);
    for (const b of byPriceBand(result.model)) {
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
    for (const b of calibrationCurve(result.model)) {
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

export { UNFITTED_PARAMS, FITTED_PARAMS };
export type { Observation };
