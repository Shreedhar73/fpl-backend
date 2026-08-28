import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HistoryRow } from '../projections/features';
import { Scoring } from '../projections/scoring';
import { FittedParams } from '../projections/fitted';
import { CalibrationRepository } from './calibration.repository';
import { CalibrationService } from './calibration.service';
import { fitParams, SEASON_HALF_LIFE } from './fit';
import { commonRows, Predictor, runBacktest } from './harness';
import { FoldSplit } from './rolling-origin';
import {
  DEFAULT_KS,
  ORDERING_VIEWS,
  orderingByRound,
  OrderingView,
} from './ordering';
import {
  AcrossFolds,
  acrossFolds,
  assertNoLeak,
  candidateSeasons,
  describeCandidate,
  FoldOptions,
  FoldPlan,
  MIN_COMPONENT_ROWS,
  WINDOW_CANDIDATES,
  WindowCandidate,
  Paired,
  pairedByRound,
  planFolds,
  RoundValue,
  splitForFold,
} from './rolling-origin';

/**
 * Runs the rolling-origin referee (B-040, plan 027 task 1) and writes its report.
 *
 * The pure part — how folds are planned, split, checked for leaks and paired — is `rolling-origin.ts`
 * and is unit-testable without a database. This file is the wiring: read the archive once, run each
 * fold, write one report.
 *
 * **The fit runs once per fold and that is the cost of the thing.** Ten seasons is 253,568 rows and a
 * fold refits the whole model, so a full sweep is minutes, not seconds. The alternative — fit once and
 * score every season — is the bug this harness exists to prevent, so the cost is the point.
 */
@Injectable()
export class RollingOriginService {
  private readonly log = new Logger(RollingOriginService.name);

  constructor(
    private readonly repo: CalibrationRepository,
    private readonly calibration: CalibrationService,
  ) {}

  /**
   * The primary comparison quantity, and why it is this one.
   *
   * `pointsCaptured` @ k over one round: the realised points of a predictor's top *k* over the
   * realised points of the true top *k*. It is the metric D-020 settled on — the optimiser asks which
   * eleven, not what a player scores — and unlike precision@k it cannot be moved by a tie at the
   * boundary. Per round, so the pairing that follows is D-033's.
   */
  static readonly PRIMARY_K = 11;

  async run(options: RunOptions = {}): Promise<RollingOriginReport> {
    const arms: Predictor[] = ['model', 'form', 'priorSeason'];
    const rows = await this.repo.history(
      options.seasons ?? (await this.seasonsInArchive()),
    );
    const seasons = [...new Set(rows.map((r) => r.season))].sort();
    const scoringFor = await this.calibration.scoringResolver(seasons);

    const plans = planFolds(rows, options.folds);
    this.log.log(
      `planned ${plans.length} folds over ${seasons.length} seasons, ${rows.length} rows`,
    );

    const folds: FoldResult[] = [];
    for (const plan of plans) {
      folds.push(this.runFold(rows, plan, scoringFor, options));
    }

    const report: RollingOriginReport = {
      generated: new Date().toISOString(),
      seasons,
      totalRows: rows.length,
      k: options.k ?? RollingOriginService.PRIMARY_K,
      trainWindow: options.folds?.trainWindow ?? null,
      imputedStarts: options.folds?.imputedStarts ?? false,
      seasonHalfLife: SEASON_HALF_LIFE,
      selectedWindow: options.selectWindow ?? false,
      folds,
      across: this.summarise(folds, arms),
    };
    report.path = await this.write(report);
    return report;
  }

  /**
   * One fold: fit on the past, score the season, pair per round.
   *
   * A fold with a blocker is planned, reported and NOT run. That asymmetry is deliberate — a fold
   * whose training corpus has no start labels would still produce a full set of numbers, because the
   * minutes fit falls back to its unfitted defaults on an empty sample without saying so. Reporting
   * "this fold could not be run, because X" is a result; reporting a plausible number from an
   * unfitted model is the failure this whole harness is built against.
   */
  private runFold(
    rows: HistoryRow[],
    plan: FoldPlan,
    scoringFor: (season: string) => Scoring,
    options: RunOptions,
  ): FoldResult {
    if (plan.blockers.length > 0) {
      this.log.warn(
        `fold ${plan.evalSeason}: not run — ${plan.blockers.join('; ')}`,
      );
      return { plan, ran: false, paired: {}, rounds: 0, scoredRows: 0 };
    }

    const split = splitForFold(rows, plan, options.folds);
    // Proves the split rather than trusting it. Task 2's leak sabotage is what this catches.
    assertNoLeak(plan, split);

    const imputedStarts = options.folds?.imputedStarts ?? false;
    // Plan 027 task 4: the training window and the recency decay are CHOSEN, per fold, on the season
    // before it — never on the fold being scored. Without this they are two constants somebody set,
    // and the register already carries a measurement (nine seasons unweighted 1895, one-season
    // half-life 1959) that was declined precisely because it was read off the test season.
    const selection = options.selectWindow
      ? this.selectWindow(rows, plan, split, scoringFor, imputedStarts, options)
      : null;

    const fit = fitParams({
      train: selection
        ? split.train.filter((r) => selection.seasons.includes(r.season))
        : split.train,
      defconTrain: split.defconTrain,
      validate: split.validate,
      defconValidate: split.defconValidate,
      scoringFor,
      imputedStarts,
      seasonHalfLife: selection?.candidate.seasonHalfLife,
    });
    const params: FittedParams = options.transform
      ? options.transform(fit.params, plan)
      : fit.params;

    // The walk is handed the training seasons and the evaluation season only. Nothing later exists
    // as far as this fold is concerned, which is what "rolling origin" means.
    const upToFold = rows.filter(
      (r) =>
        plan.trainSeasons.includes(r.season) || r.season === plan.evalSeason,
    );
    const result = runBacktest(upToFold, params, scoringFor, {
      evaluate: split.evaluate,
    });

    const view = options.view ?? ORDERING_VIEWS[0];
    const k = options.k ?? RollingOriginService.PRIMARY_K;
    const paired: Record<string, Paired | null> = {};
    // Pairwise populations, never one three-way intersection: `priorSeason` needs 450 minutes in the
    // previous season, so intersecting all three answers "does the model beat form" on a set of rows
    // a third predictor chose. The same rule `CalibrationService.evaluate` follows.
    for (const baseline of ['form', 'priorSeason'] as const) {
      const common = commonRows(result.rows, ['model', baseline]);
      paired[`model vs ${baseline}`] = pairedByRound(
        this.perRound(common, 'model', view, k),
        this.perRound(common, baseline, view, k),
      );
    }

    // The decisive comparison for plan 027 task 6, when asked for: the SAME fold, fitted twice —
    // once on recorded labels alone and once with the imputed seasons — and paired round by round.
    // Comparing the two arms' separate model-vs-form numbers would work, but it compares through a
    // baseline neither arm is about; this pairs the two models directly, on identical rows.
    if (
      options.compareImputed &&
      plan.capability.startLabelRows >= MIN_COMPONENT_ROWS
    ) {
      const other = fitParams({
        train: split.train,
        defconTrain: split.defconTrain,
        validate: split.validate,
        defconValidate: split.defconValidate,
        scoringFor,
        imputedStarts: !(options.folds?.imputedStarts ?? false),
      });
      const otherResult = runBacktest(upToFold, other.params, scoringFor, {
        evaluate: split.evaluate,
      });
      const common = commonRows(result.rows, ['model', 'form']);
      const otherCommon = commonRows(otherResult.rows, ['model', 'form']);
      paired[
        options.folds?.imputedStarts
          ? 'model imputed vs model recorded-only'
          : 'model recorded-only vs model imputed'
      ] = pairedByRound(
        this.perRound(common, 'model', view, k),
        this.perRound(otherCommon, 'model', view, k),
      );
    }

    const scored = commonRows(result.rows, ['model', 'form']);
    this.log.log(
      `fold ${plan.evalSeason}: trained on ${plan.trainSeasons.join(', ')} ` +
        `(${split.train.length} rows), scored ${scored.length}`,
    );
    return {
      plan,
      ran: true,
      paired,
      rounds: new Set(scored.map((r) => r.round)).size,
      scoredRows: scored.length,
      selection,
      fittedMinutes: {
        startIntercept: params.minutes.startIntercept,
        startSlope: params.minutes.startSlope,
        subAppearanceRate: params.minutes.subAppearanceRate,
      },
    };
  }

  /**
   * Choose a training window and a recency half-life on the fold's validation season.
   *
   * Every candidate is fitted on its own window of the fold's training seasons and scored on the
   * SAME validation rows — the tail of the season before the fold. The winner is the one with the
   * highest mean points-captured@k there, and the fold is then refitted under it and scored once.
   *
   * Two things this must never do, and both are checked by construction rather than by care: a
   * candidate cannot reach a season the fold does not train on, and no candidate is ever scored on
   * the evaluation season. `assertNoLeak` has already run on the split those rows come from.
   */
  private selectWindow(
    rows: HistoryRow[],
    plan: FoldPlan,
    split: FoldSplit,
    scoringFor: (season: string) => Scoring,
    imputedStarts: boolean,
    options: RunOptions,
  ): WindowSelection | null {
    if (split.validate.length === 0) return null;
    const view = options.view ?? ORDERING_VIEWS[0];
    const k = options.k ?? RollingOriginService.PRIMARY_K;
    const validateSeasons = new Set([
      ...plan.trainSeasons,
      // the validation rows themselves, which are the tail of the last training season
    ]);
    const upToValidate = rows.filter((r) => validateSeasons.has(r.season));

    const scored: CandidateScore[] = [];
    for (const candidate of WINDOW_CANDIDATES) {
      const seasons = candidateSeasons(plan, candidate);
      const train = split.train.filter((r) => seasons.includes(r.season));
      if (train.length === 0) continue;
      const params = fitParams({
        train,
        defconTrain: split.defconTrain,
        validate: split.validate,
        defconValidate: split.defconValidate,
        scoringFor,
        imputedStarts,
        seasonHalfLife: candidate.seasonHalfLife,
      }).params;
      const result = runBacktest(upToValidate, params, scoringFor, {
        evaluate: (row) =>
          row.season === plan.validateSeason &&
          row.round >= plan.validateFromRound,
      });
      const common = commonRows(result.rows, ['model', 'form']);
      const perRound = this.perRound(common, 'model', view, k);
      const captured =
        perRound.length === 0
          ? null
          : perRound.reduce((t, r) => t + r.value, 0) / perRound.length;
      scored.push({ candidate, seasons, rounds: perRound.length, captured });
    }

    const usable = scored.filter(
      (c): c is CandidateScore & { captured: number } => c.captured !== null,
    );
    if (usable.length === 0) return null;
    const best = usable.reduce((a, b) => (b.captured > a.captured ? b : a));
    const worst = usable.reduce((a, b) => (b.captured < a.captured ? b : a));
    this.log.log(
      `fold ${plan.evalSeason}: chose ${describeCandidate(best.candidate)} on ` +
        `${plan.validateSeason} (captured ${(100 * best.captured).toFixed(2)}%, ` +
        `spread ${(100 * (best.captured - worst.captured)).toFixed(2)}pp)`,
    );
    return {
      candidate: best.candidate,
      seasons: best.seasons,
      validateCaptured: best.captured,
      // How much the choice was worth at all. A flat grid means the objective could not tell the
      // candidates apart and the "winner" is noise — the same guard `fit.ts` puts on its own sweeps.
      spread: best.captured - worst.captured,
      candidates: scored,
    };
  }

  /** One predictor's points-captured@k, per round of the fold — the values that get paired. */
  private perRound(
    rows: ReturnType<typeof commonRows>,
    predictor: Predictor,
    view: OrderingView,
    k: number,
  ): RoundValue[] {
    const ks = DEFAULT_KS.includes(k) ? DEFAULT_KS : [...DEFAULT_KS, k];
    const out: RoundValue[] = [];
    for (const r of orderingByRound(rows, predictor, view, ks)) {
      const captured = r.pointsCaptured.get(k);
      // A round where the true top k scored nothing produces no ratio at all. Dropped from both
      // arms by the pairing, never counted as a zero for either.
      if (captured === null || captured === undefined) continue;
      out.push({ season: r.season, round: r.round, value: captured });
    }
    return out;
  }

  private summarise(
    folds: FoldResult[],
    arms: Predictor[],
  ): Record<string, AcrossFolds | null> {
    const out: Record<string, AcrossFolds | null> = {};
    // Every comparison any fold produced, not a fixed list: the imputation A/B appears on some folds
    // and not others, and a summary that only knew about the baselines would drop it silently.
    const labels = new Set<string>(
      arms.filter((a) => a !== 'model').map((a) => `model vs ${a}`),
    );
    for (const f of folds) {
      if (!f.ran) continue;
      for (const label of Object.keys(f.paired)) labels.add(label);
    }
    for (const label of labels) {
      out[label] = acrossFolds(
        folds
          .filter((f) => f.ran)
          .map((f) => ({
            season: f.plan.evalSeason,
            paired: f.paired[label] ?? null,
          })),
      );
    }
    return out;
  }

  private async seasonsInArchive(): Promise<string[]> {
    return this.repo.archiveSeasons();
  }

  private async write(report: RollingOriginReport): Promise<string> {
    const dir = join(process.cwd(), 'reports');
    await mkdir(dir, { recursive: true });
    // Two arms, two files. Overwriting one report with the other's numbers is how a comparison
    // becomes a single table nobody can reproduce the other half of.
    // One file per ARM, named for what makes it that arm. Overwriting one arm's report with
    // another's is how a comparison becomes a single table nobody can reproduce the other half of —
    // and the recency half-life is part of the arm, not a detail: the same corpus scored 1895
    // unweighted and 1959 at a one-season half-life.
    const suffix = [
      report.imputedStarts ? 'imputed' : null,
      Number.isFinite(report.seasonHalfLife)
        ? `hl${report.seasonHalfLife}`
        : null,
    ].filter(Boolean);
    const path = join(
      dir,
      suffix.length === 0
        ? 'rolling-origin.md'
        : `rolling-origin-${suffix.join('-')}.md`,
    );
    await writeFile(path, renderReport(report), 'utf8');
    return path;
  }
}

export interface RunOptions {
  seasons?: string[];
  /**
   * Fit each fold a second time with the imputation flag inverted and pair the two models directly.
   *
   * Only on folds that have recorded start labels to fall back to — a fold whose training seasons
   * carry none has no recorded-only arm to compare against, and the report says so rather than
   * pairing against an unfitted model.
   */
  compareImputed?: boolean;
  /**
   * Choose the training window and recency half-life per fold, on the season before it.
   *
   * Off, every fold trains on every earlier season at equal weight — which is a choice nobody made
   * deliberately, and the one this project's own comment says is the worse of two.
   */
  selectWindow?: boolean;
  folds?: FoldOptions;
  view?: OrderingView;
  k?: number;
  /**
   * A candidate's difference from the incumbent, applied to the parameters the fold fitted.
   *
   * An arm is a transform and not a set of parameters on purpose: parameters fitted once and reused
   * across folds are the leak this harness exists to close, so a candidate says how it DIFFERS from
   * a fit and the fold does the fitting.
   */
  transform?: (params: FittedParams, plan: FoldPlan) => FittedParams;
}

export interface CandidateScore {
  candidate: WindowCandidate;
  seasons: string[];
  rounds: number;
  /** mean points-captured@k on the validation season, or null when it produced no round */
  captured: number | null;
}

export interface WindowSelection {
  candidate: WindowCandidate;
  seasons: string[];
  validateCaptured: number;
  /** best minus worst on validation — how much the choice was worth at all */
  spread: number;
  candidates: CandidateScore[];
}

export interface FoldResult {
  plan: FoldPlan;
  /** false when the fold was planned and refused — the reason is in `plan.blockers` */
  ran: boolean;
  paired: Record<string, Paired | null>;
  rounds: number;
  scoredRows: number;
  /** what the fold chose, and what it chose between — null when selection was off */
  selection?: WindowSelection | null;
  /** the three minutes parameters, carried so a report can show the fit MOVED between folds */
  fittedMinutes?: {
    startIntercept: number;
    startSlope: number;
    subAppearanceRate: number;
  };
}

export interface RollingOriginReport {
  generated: string;
  seasons: string[];
  totalRows: number;
  /**
   * The k the pairing actually used.
   *
   * Carried, not hardcoded in the prose: `--k 15` changes what was measured, and a report whose
   * header says @11 whatever it paired on is the sim-verdict failure this project has already paid
   * for once — output that cannot be wrong because it does not read its input.
   */
  k: number;
  /** null when every earlier season was used */
  trainWindow: number | null;
  /** whether the folds were allowed to fit minutes on imputed start probabilities */
  imputedStarts: boolean;
  /**
   * The season recency half-life the fits ran under, in seasons; `Infinity` is no decay.
   *
   * Carried because it is set by an environment variable and changes every fitted constant. A report
   * that does not say which regime produced it is a report nobody can reproduce — and this project
   * has one measured pair where the same corpus scored 1895 unweighted and 1959 at a one-season
   * half-life, so the difference is not decorative.
   */
  seasonHalfLife: number;
  /** whether each fold chose its own window and decay on the season before it */
  selectedWindow: boolean;
  folds: FoldResult[];
  across: Record<string, AcrossFolds | null>;
  path?: string;
}

/**
 * Below this many folds, "clears twice the between-fold error" is not a result.
 *
 * The standard error of a mean over *n* folds is itself estimated from those *n* numbers; at two, it
 * is one squared difference and two folds that agree by chance produce a tiny error bar. The bar is
 * still reported — it is the honest arithmetic of what was run — but the verdict says out loud that
 * it is a direction rather than a decision. Set at four because that is where the archive's start
 * labels could plausibly reach if plan 027 task 6 lands, so it is a bar this project can actually
 * clear rather than one written to be unreachable.
 */
export const MIN_FOLDS_FOR_A_SPREAD = 4;

/**
 * The first season the archive records expected goals.
 *
 * A fold evaluating a season before this one trained without xG anywhere, so its attack terms are
 * running on fallbacks. That is a data confound, not a model result, and the verdict says so.
 */
const FIRST_XG_SEASON = '2022-23';

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const sign = (x: number) => (x >= 0 ? '+' : '');

/**
 * The report, as a function of the numbers.
 *
 * Prose that does not read its own input is the shape `sim-verdict.ts` was written to kill — a
 * paragraph that says "the model wins" whatever the run produced. Every sentence below that makes a
 * claim reads the value it claims about.
 */
export function renderReport(report: RollingOriginReport): string {
  const lines: string[] = [];
  lines.push('# Rolling-origin referee');
  lines.push('');
  lines.push(
    `Generated ${report.generated} over ${report.seasons.length} seasons ` +
      `(${report.seasons.join(', ')}), ${report.totalRows.toLocaleString()} archive rows. ` +
      `Training window: ${report.trainWindow === null ? 'every earlier season' : `${report.trainWindow} season(s)`}. ` +
      `Season half-life: ${Number.isFinite(report.seasonHalfLife) ? `${report.seasonHalfLife} season(s) — older seasons down-weighted` : 'none — every season counts equally'}. ` +
      `Imputed start labels: ${report.imputedStarts ? 'USED — the seasons before 2023-24 fit the minutes model on inferred probabilities (plan 027 task 6)' : 'not used'}.`,
  );
  lines.push('');
  lines.push(
    'Each fold fits on the seasons BEFORE its evaluation season and scores that season once. The ' +
      'incumbent is refitted per fold like every other arm — scoring the served parameters, which ' +
      'were fitted on 2023-24 and 2024-25, against the 2024-25 fold would hand it its own training ' +
      `season. The quantity paired is points captured @${report.k} per round (D-020), the pairing is per ` +
      'round (D-033), and the number a single holdout could never produce is the last table: the ' +
      'spread ACROSS folds.',
  );
  lines.push('');

  lines.push('## Folds');
  lines.push('');
  lines.push(
    '| eval season | trained on | train-season rows | start labels | imputed | defcon | scored rounds | ran |',
  );
  lines.push('|---|---|---:|---:|---:|---|---:|---|');
  for (const f of report.folds) {
    lines.push(
      `| ${f.plan.evalSeason} | ${f.plan.trainSeasons.join(', ') || '—'} | ` +
        `${f.plan.capability.trainRows.toLocaleString()} | ` +
        `${f.plan.capability.startLabelRows.toLocaleString()} | ` +
        `${f.plan.capability.imputedStartRows === 0 ? '—' : f.plan.capability.imputedStartRows.toLocaleString()} | ` +
        `${f.plan.defcon} | ` +
        `${f.ran ? f.rounds : 0} | ${f.ran ? 'yes' : 'no'} |`,
    );
  }
  lines.push('');

  const refused = report.folds.filter((f) => !f.ran);
  if (refused.length > 0) {
    lines.push('### Folds that were refused, and why');
    lines.push('');
    lines.push(
      'A refused fold is a result. The minutes curves fall back to their unfitted defaults on an ' +
        'empty sample without complaining, so a fold with no start labels in its training seasons ' +
        'would emit a complete set of plausible numbers from a model that was never fitted.',
    );
    lines.push('');
    for (const f of refused) {
      lines.push(`- **${f.plan.evalSeason}** — ${f.plan.blockers.join('; ')}`);
    }
    lines.push('');
  }

  const ran = report.folds.filter((f) => f.ran);
  const selected = ran.filter((f) => f.selection);
  if (selected.length > 0) {
    lines.push('### What each fold chose, and on what');
    lines.push('');
    lines.push(
      'The training window and the recency half-life are chosen INSIDE each fold, on the season ' +
        'before it, and the fold is then scored once under the winner. `spread` is best minus worst ' +
        'across the candidates on that validation season: a flat grid means the objective could not ' +
        'tell them apart and the winner is noise, whatever it is called.',
    );
    lines.push('');
    lines.push(
      '| eval season | chosen | trained on | validate captured | spread | candidates |',
    );
    lines.push('|---|---|---|---:|---:|---:|');
    for (const f of selected) {
      const sel = f.selection!;
      lines.push(
        `| ${f.plan.evalSeason} | ${describeCandidate(sel.candidate)} | ` +
          `${sel.seasons.join(', ')} | ${pct(sel.validateCaptured)} | ` +
          `${(100 * sel.spread).toFixed(2)}pp | ${sel.candidates.length} |`,
      );
    }
    lines.push('');
    for (const f of selected) {
      const sel = f.selection!;
      lines.push(`**${f.plan.evalSeason} — every candidate**`);
      lines.push('');
      lines.push('| candidate | seasons | rounds | validate captured |');
      lines.push('|---|---:|---:|---:|');
      for (const c of sel.candidates) {
        lines.push(
          `| ${describeCandidate(c.candidate)} | ${c.seasons.length} | ${c.rounds} | ` +
            `${c.captured === null ? '—' : pct(c.captured)} |`,
        );
      }
      lines.push('');
    }
  }
  if (ran.length > 0 && ran[0].fittedMinutes) {
    lines.push('### What the refit actually moved');
    lines.push('');
    lines.push(
      'Carried because "refitted per fold" is a claim a report should be able to lose. Identical ' +
        'rows here would mean the folds shared a fit.',
    );
    lines.push('');
    lines.push(
      '| eval season | startIntercept | startSlope | subAppearanceRate |',
    );
    lines.push('|---|---:|---:|---:|');
    for (const f of ran) {
      const m = f.fittedMinutes!;
      lines.push(
        `| ${f.plan.evalSeason} | ${m.startIntercept.toFixed(4)} | ` +
          `${m.startSlope.toFixed(4)} | ${m.subAppearanceRate.toFixed(4)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Paired per-round difference, within each fold');
  lines.push('');
  lines.push(
    `| comparison | eval season | rounds | mean Δ captured@${report.k} | 1 se | clears 2se |`,
  );
  lines.push('|---|---|---:|---:|---:|---|');
  for (const f of ran) {
    for (const [label, p] of Object.entries(f.paired)) {
      if (!p) {
        lines.push(
          `| ${label} | ${f.plan.evalSeason} | — | — | — | no pairing |`,
        );
        continue;
      }
      lines.push(
        `| ${label} | ${f.plan.evalSeason} | ${p.rounds} | ` +
          `${sign(p.meanDifference)}${pct(p.meanDifference)} | ${pct(p.standardError)} | ` +
          `${p.clearsNoise ? 'yes' : 'no'} |`,
      );
    }
  }
  lines.push('');

  lines.push('## Across folds');
  lines.push('');
  lines.push(
    'The mean of the fold means, with the standard error of the spread BETWEEN folds. Expect it to ' +
      "be wider than the within-fold pairing: rounds inside one season share that season's " +
      'weather, so pooling them understates the uncertainty of a claim about seasons not yet ' +
      'played. `reports/guards-009.md` says the same from the other end — one comparison came out ' +
      '−2.41, +2.34 and +0.97 across three seasons, a sign flip no within-season error predicted.',
  );
  lines.push('');
  lines.push(
    '| comparison | folds | mean of fold means | se across folds | clears 2se | per fold |',
  );
  lines.push('|---|---:|---:|---:|---|---|');
  for (const [label, a] of Object.entries(report.across)) {
    if (!a) {
      lines.push(`| ${label} | 0 | — | — | no fold produced a pairing | — |`);
      continue;
    }
    const perFold = a.perFold
      .map(
        (f) => `${f.season} ${sign(f.meanDifference)}${pct(f.meanDifference)}`,
      )
      .join(', ');
    lines.push(
      `| ${label} | ${a.folds} | ${sign(a.meanOfFoldMeans)}${pct(a.meanOfFoldMeans)} | ` +
        `${a.standardError === null ? '— (one fold)' : pct(a.standardError)} | ` +
        `${a.standardError === null ? 'undecidable on one fold' : a.clearsNoise ? 'yes' : 'no'} | ${perFold} |`,
    );
  }
  lines.push('');

  lines.push('## What this run says');
  lines.push('');
  for (const line of verdict(report)) {
    lines.push(line);
    lines.push('');
  }
  return lines.join('\n');
}

/** One paragraph per element, each reading the numbers it is about. */
export function verdict(report: RollingOriginReport): string[] {
  const out: string[] = [];
  const ran = report.folds.filter((f) => f.ran);
  const refused = report.folds.filter((f) => !f.ran);

  // Two confounds that a reader of the old folds must have in front of them, printed BEFORE the
  // comparisons rather than as a footnote under them. Neither is a property of the model.
  const oldFolds = ran.filter((f) => f.plan.evalSeason < FIRST_XG_SEASON);
  if (oldFolds.length > 0) {
    out.push(
      `**Read the folds before ${FIRST_XG_SEASON} with two confounds in front of them, and do not ` +
        `read them as a verdict on the model.** (1) Their training corpus has no expected goals — ` +
        `the column starts in ${FIRST_XG_SEASON} — so the attack half of the model is running on ` +
        `its fallbacks while \`form\`, which needs nothing but last week's points, is unaffected. ` +
        (report.imputedStarts
          ? `(2) Their start labels are imputed rather than recorded, and the seasons are pooled at `
          : `(2) The seasons are pooled at `) +
        `EQUAL weight with no recency decay, which this repository has already measured as the worse ` +
        `of the two options (\`fit.ts\`: nine seasons unweighted 1895, with a one-season half-life ` +
        `1959). A loss on these folds is a statement about a starved and unweighted fit, not about ` +
        `whether the minutes labels are any good.`,
    );
  }

  out.push(
    `${ran.length} of ${report.folds.length} planned folds ran. ` +
      (refused.length === 0
        ? 'Every planned fold had a training corpus that could fit every component of the model.'
        : `${refused.length} were refused: ${refused
            .map((f) => f.plan.evalSeason)
            .join(
              ', ',
            )}. Until the archive carries a start label for those seasons, the referee ` +
          `is ${ran.length}-fold for anything the minutes model touches, whatever it is for the ` +
          `rate components.`),
  );

  for (const [label, a] of Object.entries(report.across)) {
    if (!a) {
      out.push(
        `**${label}** — no fold produced a pairing, so there is nothing to read.`,
      );
      continue;
    }
    if (a.standardError === null) {
      out.push(
        `**${label}** — one fold, mean ${sign(a.meanOfFoldMeans)}${pct(a.meanOfFoldMeans)}. ` +
          `A spread over one season does not exist, so this is a point estimate with no scale — ` +
          `exactly the state every verdict in this repository was in before this harness.`,
      );
      continue;
    }
    const flips =
      new Set(a.perFold.map((f) => Math.sign(f.meanDifference))).size > 1;
    out.push(
      `**${label}** — ${sign(a.meanOfFoldMeans)}${pct(a.meanOfFoldMeans)} captured@${report.k} across ` +
        `${a.folds} folds, se ${pct(a.standardError)}. ${
          a.clearsNoise
            ? 'Clears twice the between-fold error.'
            : 'Does NOT clear twice the between-fold error, so this comparison is undecided at this fold count however the mean points.'
        }${
          flips
            ? ' The per-fold means do not agree on a sign, which is the thing a single holdout cannot show you.'
            : ' Every fold agrees on the sign.'
        }${
          a.folds < MIN_FOLDS_FOR_A_SPREAD
            ? ` **Read the clearance with the fold count in front of it: an error estimated from ` +
              `${a.folds} numbers is itself barely estimated, and two folds that happen to agree ` +
              `produce a small standard error whether or not the effect is real. This is a ` +
              `direction, not a decision.**`
            : ''
        }`,
    );
  }
  return out;
}
