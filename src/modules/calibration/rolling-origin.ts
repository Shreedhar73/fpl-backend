import { HistoryRow } from '../projections/features';

/**
 * The rolling-origin referee (B-040, plan 027 task 1).
 *
 * **Why this exists at all.** Every accuracy claim in this repository has been read off one held-out
 * season, 2025-26, and that season is spent: `tools/fit-v4/fit.py` records "the next TEST reading is
 * the last", and B-037 retired the archive holdout after four architectures had been selected against
 * it. A refit measured on it again is a reading the register already forbids.
 *
 * Ten seasons make a better referee possible than the one that was burned. For each evaluation season
 * *s*: fit on every season strictly before *s*, predict *s*, score it. Several evaluation seasons
 * instead of one, and the number that buys is the **spread across folds** — a mean difference with a
 * standard error over independent seasons. One holdout can produce a difference; it cannot produce a
 * standard error over seasons, so every argument taken on it has been a point estimate with no scale.
 *
 * **Three rules are structural here, not stylistic.**
 *
 * 1. **Every arm is refitted per fold, the incumbent included.** The served parameters were fitted on
 *    2023-24 + 2024-25; scoring them against the 2024-25 fold hands the incumbent its own training
 *    season and the fold reports a win it did not earn. `runFold` takes a fitter, never parameters.
 * 2. **Fold coverage is per component, not a flat count of seasons.** The archive is not rectangular:
 *    `starts` exists only from 2023-24, expected goals only from 2022-23, the defensive-contribution
 *    category only in 2025-26. A fold whose training seasons carry no start label cannot fit the
 *    minutes model — and `fitLogisticK` returns its fallback curve on an empty sample without
 *    complaining, so that fold would emit a perfectly plausible number from a model that was never
 *    fitted. That is the `checks-that-cannot-fail` shape with a whole season of numbers behind it.
 *    `capabilityOf` measures what a fold can fit and `planFolds` marks the rest unusable BY NAME.
 * 3. **Nested selection.** Inside fold *s*, hyperparameters are chosen on *s−1* and nothing else, and
 *    *s* is scored once. A window length or a decay chosen on the fold it is then scored on is
 *    selection on test wearing a different word.
 */

/** A component of the model, and whether a fold's training corpus can actually fit it. */
export type Component = 'minutes' | 'rates' | 'strength' | 'defcon';

/**
 * What a training corpus can speak to, measured from the rows rather than assumed from the seasons.
 *
 * Measured from rows and not from a season list on purpose: a season whose import half-failed, or a
 * column dropped upstream, changes what is fittable without changing which seasons are present. The
 * counts are carried so the report can say *how thin* rather than only *whether*.
 */
export interface FoldCapability {
  trainRows: number;
  /** rows carrying a real start label — the sample the start and sub curves are regressions on */
  startLabelRows: number;
  /** rows carrying expected goals */
  xgRows: number;
  /** rows carrying the defensive-contribution category */
  defconRows: number;
  /** seasons represented in the training corpus, in order */
  seasons: string[];
  fittable: Record<Component, boolean>;
}

/**
 * The floor under a fittable component.
 *
 * Not a statistical bound — a tripwire. The failure this guards is a corpus with ZERO rows for a
 * component, where the fitter's fallback stands in and the fold looks healthy. A few hundred rows is
 * already a bad fit, and the report says how many there were; no rows at all is a different claim
 * being made, and that one is refused.
 */
export const MIN_COMPONENT_ROWS = 1;

export function capabilityOf(train: HistoryRow[]): FoldCapability {
  let startLabelRows = 0;
  let xgRows = 0;
  let defconRows = 0;
  const seasons = new Set<string>();
  for (const r of train) {
    seasons.add(r.season);
    if (r.starts !== null) startLabelRows += 1;
    if (r.expectedGoals !== null) xgRows += 1;
    if (r.defensiveContribution !== null) defconRows += 1;
  }
  return {
    trainRows: train.length,
    startLabelRows,
    xgRows,
    defconRows,
    seasons: [...seasons].sort(),
    fittable: {
      minutes: startLabelRows >= MIN_COMPONENT_ROWS,
      // Rates, clean sheets and the strength model read minutes, goals, assists and conceded, which
      // every season of the archive carries. They are fittable wherever there are rows at all.
      rates: train.length >= MIN_COMPONENT_ROWS,
      strength: train.length >= MIN_COMPONENT_ROWS,
      defcon: defconRows >= MIN_COMPONENT_ROWS,
    },
  };
}

/**
 * Where the defensive-contribution parameters came from for a fold, which is never nothing and is
 * not always clean.
 *
 * - `prior-seasons` — a training season carried the category. The honest case.
 * - `within-season`  — no earlier season has it, so it is fitted on the early rounds of the
 *   evaluation season itself and the fold's evaluation window is cut to the rounds after, exactly as
 *   `CalibrationService` already does for the one season that has the category.
 * - `absent` — the category did not exist in this evaluation season either, so the term is priced at
 *   zero by that season's own scoring table and no parameter is read.
 */
export type DefconSource = 'prior-seasons' | 'within-season' | 'absent';

export interface FoldPlan {
  evalSeason: string;
  /** every season strictly before the evaluation season, in order */
  trainSeasons: string[];
  /** the season hyperparameters may be chosen on — always the last training season, never `evalSeason` */
  validateSeason: string | null;
  /** rounds of the training corpus's validation season reserved for selection */
  validateFromRound: number;
  defcon: DefconSource;
  /** the first round of `evalSeason` that is scored — above 1 only when defcon is fitted within it */
  evalFromRound: number;
  capability: FoldCapability;
  /** empty when the fold is usable for a full-model arm; each entry names one reason it is not */
  blockers: string[];
}

/** The components a full points projection needs before its numbers mean anything. */
const FULL_MODEL_COMPONENTS: Component[] = ['minutes', 'rates', 'strength'];

/**
 * The training window a fold may use.
 *
 * `Infinity` — every earlier season (the default, and what "rolling origin" ordinarily means).
 * A finite *n* keeps only the *n* seasons immediately before the evaluation season, which is how
 * plan 027 task 4 turns "do the old seasons help?" into a measurement instead of an argument.
 */
export interface FoldOptions {
  trainWindow?: number;
  /** rounds of the validation season reserved for shape parameters (mirrors `VALIDATE_FROM_ROUND`) */
  validateFromRound?: number;
  /** first round scored when the defensive-contribution term is fitted inside the evaluation season */
  defconEvalFromRound?: number;
  /** rounds of the evaluation season the defcon fit may read, when it must read them at all */
  defconFitRound?: number;
  defconValidateMaxRound?: number;
  /** how many earlier seasons a fold needs before it is planned at all */
  minTrainSeasons?: number;
}

const DEFAULTS = {
  trainWindow: Infinity,
  validateFromRound: 20,
  defconEvalFromRound: 20,
  defconFitRound: 12,
  defconValidateMaxRound: 19,
  minTrainSeasons: 1,
};

/**
 * Plan one fold per evaluation season, from the rows themselves.
 *
 * Takes rows and not a season list so the plan is a function of what the database actually holds: a
 * season absent from the archive produces no fold rather than a fold with an empty training corpus,
 * and a season present but thin is planned and then marked by its capability.
 */
export function planFolds(
  rows: HistoryRow[],
  options: FoldOptions = {},
): FoldPlan[] {
  const opts = { ...DEFAULTS, ...options };
  const bySeason = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const list = bySeason.get(r.season);
    if (list) list.push(r);
    else bySeason.set(r.season, [r]);
  }
  const seasons = [...bySeason.keys()].sort();

  const plans: FoldPlan[] = [];
  for (const [i, evalSeason] of seasons.entries()) {
    const earlier = seasons.slice(0, i);
    if (earlier.length < opts.minTrainSeasons) continue;
    const trainSeasons = Number.isFinite(opts.trainWindow)
      ? earlier.slice(Math.max(0, earlier.length - opts.trainWindow))
      : earlier;

    const train = trainSeasons.flatMap((s) => bySeason.get(s) ?? []);
    const capability = capabilityOf(train);

    // The evaluation season's own category, which decides whether the defcon parameters can come
    // from the past at all.
    const evalHasDefcon = (bySeason.get(evalSeason) ?? []).some(
      (r) => r.defensiveContribution !== null,
    );
    const defcon: DefconSource = capability.fittable.defcon
      ? 'prior-seasons'
      : evalHasDefcon
        ? 'within-season'
        : 'absent';

    const blockers: string[] = [];
    for (const component of FULL_MODEL_COMPONENTS) {
      if (!capability.fittable[component]) {
        blockers.push(
          component === 'minutes'
            ? `no start labels in ${trainSeasons.join(', ') || 'an empty training corpus'} — ` +
                `the minutes curves would fall back to their unfitted defaults and the fold would ` +
                `report a number from a model that was never fitted`
            : `no rows to fit ${component} on`,
        );
      }
    }

    plans.push({
      evalSeason,
      trainSeasons,
      validateSeason: trainSeasons.at(-1) ?? null,
      validateFromRound: opts.validateFromRound,
      defcon,
      evalFromRound: defcon === 'within-season' ? opts.defconEvalFromRound : 1,
      capability,
      blockers,
    });
  }
  return plans;
}

/** The rows a fold's fit may learn from, and the rows it may select shape parameters on. */
export interface FoldSplit {
  train: HistoryRow[];
  validate: HistoryRow[];
  defconTrain: HistoryRow[];
  defconValidate: HistoryRow[];
  evaluate: (row: HistoryRow) => boolean;
}

/**
 * Split the corpus for one fold.
 *
 * The invariant this function exists to hold: **no row of `evalSeason` reaches `train` or
 * `validate`**, and the single documented exception — the defensive-contribution rounds, when no
 * earlier season carries the category — reaches `defconTrain` alone and costs the fold the rounds it
 * read. `assertNoLeak` proves it rather than this comment claiming it.
 */
export function splitForFold(
  rows: HistoryRow[],
  plan: FoldPlan,
  options: FoldOptions = {},
): FoldSplit {
  const opts = { ...DEFAULTS, ...options };
  const inTrainSeasons = new Set(plan.trainSeasons);

  const train = rows.filter(
    (r) =>
      inTrainSeasons.has(r.season) &&
      (r.season !== plan.validateSeason || r.round < plan.validateFromRound),
  );
  const validate = rows.filter(
    (r) =>
      r.season === plan.validateSeason && r.round >= plan.validateFromRound,
  );

  const defconTrain =
    plan.defcon === 'prior-seasons'
      ? train.filter((r) => r.defensiveContribution !== null)
      : plan.defcon === 'within-season'
        ? rows.filter(
            (r) =>
              r.season === plan.evalSeason && r.round <= opts.defconFitRound,
          )
        : [];
  const defconValidate =
    plan.defcon === 'prior-seasons'
      ? validate.filter((r) => r.defensiveContribution !== null)
      : plan.defcon === 'within-season'
        ? rows.filter(
            (r) =>
              r.season === plan.evalSeason &&
              r.round > opts.defconFitRound &&
              r.round <= opts.defconValidateMaxRound,
          )
        : [];

  return {
    train,
    validate,
    defconTrain,
    defconValidate,
    evaluate: (row) =>
      row.season === plan.evalSeason && row.round >= plan.evalFromRound,
  };
}

/**
 * The leak check, as an assertion rather than a convention.
 *
 * Task 2's first sabotage is to add the evaluation season to its own training set; this is what has
 * to fire when it does. It reads the rows that were actually handed to the fit, so a future refactor
 * that widens `splitForFold` cannot quietly re-open the hole — the numbers would still be produced,
 * and only this throws.
 *
 * The defcon exception is admitted by name and bounded twice: those rows may only be the early rounds
 * of the evaluation season, and only when the plan says the category exists nowhere earlier. A fold
 * that reads them is a fold whose evaluation window starts after them.
 */
export function assertNoLeak(plan: FoldPlan, split: FoldSplit): void {
  const offenders = (rows: HistoryRow[]) =>
    rows.filter((r) => r.season === plan.evalSeason).length;

  const inTrain = offenders(split.train);
  if (inTrain > 0) {
    throw new Error(
      `rolling-origin fold ${plan.evalSeason}: ${inTrain} rows of the evaluation season reached ` +
        `the training set. Fitting on the season being scored is the leak this harness exists to ` +
        `make impossible, and every number the fold produced is void.`,
    );
  }
  const inValidate = offenders(split.validate);
  if (inValidate > 0) {
    throw new Error(
      `rolling-origin fold ${plan.evalSeason}: ${inValidate} rows of the evaluation season reached ` +
        `the validation set. Shape parameters chosen on the fold they are scored on is selection ` +
        `on test.`,
    );
  }
  if (plan.defcon !== 'within-season') {
    const inDefcon =
      offenders(split.defconTrain) + offenders(split.defconValidate);
    if (inDefcon > 0) {
      throw new Error(
        `rolling-origin fold ${plan.evalSeason}: ${inDefcon} rows of the evaluation season reached ` +
          `the defensive-contribution fit, which this fold did not need — its category came from ` +
          `${plan.defcon}.`,
      );
    }
  }
  const evaluated = split.evaluate;
  if (plan.defcon === 'within-season') {
    const readByFit = new Set(
      [...split.defconTrain, ...split.defconValidate]
        .filter((r) => r.season === plan.evalSeason)
        .map((r) => r.round),
    );
    for (const round of readByFit) {
      if (evaluated({ season: plan.evalSeason, round } as HistoryRow)) {
        throw new Error(
          `rolling-origin fold ${plan.evalSeason}: round ${round} was read by the ` +
            `defensive-contribution fit AND is inside the scored window. The whole point of ` +
            `cutting the window is that those rounds are paid for, not scored.`,
        );
      }
    }
  }
}

/**
 * A per-round quantity for one arm of one fold — whatever the caller is pairing on.
 *
 * Deliberately not points-of-season: this harness's verdict is D-033's paired per-round test, and the
 * quantity paired is chosen by the caller (points captured @11 for an ordering claim, realised points
 * for a squad claim). What is fixed here is the pairing, not the metric.
 */
export interface RoundValue {
  season: string;
  round: number;
  value: number;
}

export interface Paired {
  rounds: number;
  meanDifference: number;
  standardError: number;
  /** |mean| > 2 x standard error — the same crude bar `pairedDifference` uses, deliberately */
  clearsNoise: boolean;
}

/**
 * The paired per-round difference between two arms, D-033's verdict shape.
 *
 * Pairing by round is what makes a difference of a point or two legible at all: both arms faced the
 * same fixtures, the same blanks and the same hauls, so the round-to-round variance that dominates
 * two independent totals cancels. A round only one arm produced a number for is dropped from both
 * sides rather than counted as zero for the other.
 */
export function pairedByRound(a: RoundValue[], b: RoundValue[]): Paired | null {
  const key = (r: RoundValue) => `${r.season}|${r.round}`;
  const other = new Map(b.map((r) => [key(r), r.value]));
  const diffs: number[] = [];
  for (const r of a) {
    const v = other.get(key(r));
    if (v !== undefined) diffs.push(r.value - v);
  }
  if (diffs.length < 2) return null;
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  const variance =
    diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (diffs.length - 1);
  const se = Math.sqrt(variance / diffs.length);
  return {
    rounds: diffs.length,
    meanDifference: mean,
    standardError: se,
    clearsNoise: Math.abs(mean) > 2 * se,
  };
}

/**
 * The number the ten seasons actually buy: a mean over folds, with the standard error of the
 * BETWEEN-fold spread.
 *
 * Read this beside the pooled per-round pairing, never instead of it, and expect it to be the wider
 * of the two. Rounds inside one season share that season's weather — a rule change, a scoring tweak,
 * the shape of the fixture list — so pooling rounds across seasons understates the uncertainty of the
 * claim "this model is better", which is a claim about seasons we have not played yet. The
 * `guards-009` measurement this repository already carries says the same thing from the other end:
 * the same comparison came out −2.41, +2.34, +0.97 across three seasons, a sign flip that no
 * within-season standard error predicted.
 *
 * With one fold there is no spread and the standard error is `null`. That is the honest answer, and
 * it is exactly the state every verdict in this repository has been in until now.
 */
export interface AcrossFolds {
  folds: number;
  meanOfFoldMeans: number;
  /** null with fewer than two folds — a spread over one season does not exist */
  standardError: number | null;
  clearsNoise: boolean;
  /** every fold's own mean, so a verdict can never hide a sign flip inside an average */
  perFold: { season: string; meanDifference: number; rounds: number }[];
}

export function acrossFolds(
  results: { season: string; paired: Paired | null }[],
): AcrossFolds | null {
  const real = results.filter(
    (r): r is { season: string; paired: Paired } => r.paired !== null,
  );
  if (real.length === 0) return null;
  const means = real.map((r) => r.paired.meanDifference);
  const mean = means.reduce((s, x) => s + x, 0) / means.length;
  const se =
    means.length < 2
      ? null
      : Math.sqrt(
          means.reduce((s, x) => s + (x - mean) ** 2, 0) /
            (means.length - 1) /
            means.length,
        );
  return {
    folds: real.length,
    meanOfFoldMeans: mean,
    standardError: se,
    clearsNoise: se !== null && Math.abs(mean) > 2 * se,
    perFold: real.map((r) => ({
      season: r.season,
      meanDifference: r.paired.meanDifference,
      rounds: r.paired.rounds,
    })),
  };
}
