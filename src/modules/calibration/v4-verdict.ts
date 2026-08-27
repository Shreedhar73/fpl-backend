import { DEFAULT_KS } from './ordering';
import { PredictionRow } from './harness';
import { pairedDifference, RoundDecision } from './xi-decision';

/**
 * B-036 — the v4 bar, evaluated exactly as it was committed to the register BEFORE the first
 * training run. A bar written after the numbers exist is written to pass; this module exists so the
 * verdict is a function of that pre-committed bar and nothing else.
 *
 * The return categories are OpenFPL's own framing, adopted because rank is won in the top two:
 *   Zeros    did not play (0 minutes)
 *   Blanks   played, at most 2 points
 *   Tickers  3 or 4 points
 *   Haulers  5 or more
 */
export const RETURN_CATEGORIES = ['Zeros', 'Blanks', 'Tickers', 'Haulers'] as const;
export type ReturnCategory = (typeof RETURN_CATEGORIES)[number];

export function returnCategory(row: {
  minutes: number;
  actual: number;
}): ReturnCategory {
  if (row.minutes === 0) return 'Zeros';
  if (row.actual <= 2) return 'Blanks';
  if (row.actual <= 4) return 'Tickers';
  return 'Haulers';
}

export interface CategoryRmse {
  category: ReturnCategory;
  n: number;
  rmse: Record<string, number>;
  /**
   * The candidate−incumbent difference in per-row squared error, paired by round (B-030's rule
   * applied to this verdict: a bare RMSE difference is not a result). Present only when the
   * predictors include both 'v4' and 'model' and at least two rounds carry rows in the category.
   */
  paired?: {
    rounds: number;
    meanSeDifference: number;
    standardError: number;
    clearsNoise: boolean;
  };
}

/** RMSE per return category for each named predictor, over rows where every one produced a number. */
export function categoryRmse(
  rows: PredictionRow[],
  predictors: readonly ('model' | 'form' | 'priorSeason' | 'v4')[],
): CategoryRmse[] {
  const shared = rows.filter((r) =>
    predictors.every((p) => r.predicted[p] !== null),
  );
  const wantsPairing =
    predictors.includes('v4') && predictors.includes('model');
  return RETURN_CATEGORIES.map((category) => {
    const inCat = shared.filter((r) => returnCategory(r) === category);
    const rmse: Record<string, number> = {};
    for (const p of predictors) {
      const se = inCat.reduce(
        (s, r) => s + ((r.predicted[p] as number) - r.actual) ** 2,
        0,
      );
      rmse[p] = inCat.length ? Math.sqrt(se / inCat.length) : NaN;
    }
    const out: CategoryRmse = { category, n: inCat.length, rmse };
    if (wantsPairing) {
      // Per ROUND, then paired: each round's mean squared error under v4 minus under the incumbent.
      // Pairing by round is what cancels the round-to-round variance that dominates raw totals —
      // the same construction every season comparison in this report uses.
      const perRound = new Map<number, { v4: number[]; model: number[] }>();
      for (const r of inCat) {
        let at = perRound.get(r.round);
        if (!at) perRound.set(r.round, (at = { v4: [], model: [] }));
        at.v4.push(((r.predicted.v4 as number) - r.actual) ** 2);
        at.model.push(((r.predicted.model as number) - r.actual) ** 2);
      }
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const asDecisions = (pick: 'v4' | 'model'): RoundDecision[] =>
        [...perRound.entries()].map(([round, se]) => ({
          season: 'test',
          round,
          points: mean(se[pick]),
          ceiling: 0,
          captainPoints: 0,
          bestFieldedPoints: 0,
          substitutions: 0,
        }));
      const d = pairedDifference(asDecisions('v4'), asDecisions('model'));
      if (d) {
        out.paired = {
          rounds: d.rounds,
          meanSeDifference: d.meanDifference,
          standardError: d.standardError,
          clearsNoise: d.clearsNoise,
        };
      }
    }
    return out;
  });
}

export interface V4BarInput {
  /** points captured @k for v4 and for the incumbent, same rounds, same population */
  captured: { k: number; v4: number | null; model: number | null }[];
  categories: CategoryRmse[];
}

export interface V4BarVerdict {
  orderingMet: boolean;
  highReturnMet: boolean;
  lowReturnHeld: boolean;
  met: boolean;
  lines: string[];
}

/**
 * The bar, as committed: (1) beat the incumbent on points captured at EVERY k; (2) improve Tickers
 * and Haulers RMSE; (3) without materially degrading Zeros/Blanks — "materially" fixed here as more
 * than 5% relative, stated in the output rather than buried.
 */
export function v4Bar(input: V4BarInput): V4BarVerdict {
  const capturedWins = input.captured.filter(
    (c) => c.v4 !== null && c.model !== null && c.v4 > c.model,
  );
  const orderingMet =
    capturedWins.length === input.captured.length &&
    input.captured.length === DEFAULT_KS.length;

  const cat = (name: string) =>
    input.categories.find((c) => c.category === name);
  const better = (name: string) => {
    const c = cat(name);
    return c ? c.rmse.v4 < c.rmse.model : false;
  };
  const degraded = (name: string) => {
    const c = cat(name);
    return c ? c.rmse.v4 > c.rmse.model * 1.05 : true;
  };
  const highReturnMet = better('Tickers') && better('Haulers');
  const lowReturnHeld = !degraded('Zeros') && !degraded('Blanks');
  const met = orderingMet && highReturnMet && lowReturnHeld;

  const pct = (x: number | null) =>
    x === null ? '—' : `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(
    `**Ordering — beat the incumbent on points captured at every k:** ` +
      input.captured
        .map((c) => `@${c.k} ${pct(c.v4)} vs ${pct(c.model)}`)
        .join(', ') +
      ` — ${orderingMet ? '**met**' : `**not met** (${capturedWins.length} of ${input.captured.length} k)`}.`,
  );
  const fmt = (name: string) => {
    const c = cat(name)!;
    const noise = c.paired
      ? c.paired.clearsNoise
        ? ', clears its paired noise'
        : ', inside its paired noise'
      : '';
    return `${name} ${c.rmse.v4.toFixed(3)} vs ${c.rmse.model.toFixed(3)} (n=${c.n}${noise})`;
  };
  lines.push(
    `**High-return accuracy — improve Tickers and Haulers:** ${fmt('Tickers')}, ${fmt('Haulers')} — ` +
      `${highReturnMet ? '**met**' : '**not met**'}.`,
  );
  lines.push(
    `**Low-return accuracy — no material (>5%) degradation:** ${fmt('Zeros')}, ${fmt('Blanks')} — ` +
      `${lowReturnHeld ? '**held**' : '**not held**'}.`,
  );
  const highReturnUnresolved =
    !highReturnMet &&
    !['Tickers', 'Haulers'].some((name) => {
      const c = cat(name);
      return c?.paired?.clearsNoise && c.rmse.v4 > c.rmse.model;
    });
  if (highReturnUnresolved) {
    lines.push(
      `**The deciding leg is unresolved at this sample, and the report says so rather than ` +
        `treating the miss as measured.** Neither high-return regression clears its own paired ` +
        `noise, so "v4 sizes a haul worse" is not established — only "not established to be ` +
        `better", which is what the pre-committed bar requires. The bar verdict stands; what would ` +
        `change it is a real improvement, not a quieter miss.`,
    );
  }
  lines.push(
    met
      ? `**The bar is met on this run.** Adoption is still a decision recorded in ` +
          `\`docs/decisions.md\` with the serving blockers answered first — a total-points GBM has ` +
          `no explain blocks (D-019), no distributions (B-017) and no pPlay, and a model that ` +
          `cannot ship its reasoning does not ship, however it measures.`
      : `**The bar is not met on this run.** \`modelVersion\` does not move, and the negative ` +
          `result stands in this report rather than being rerun until it passes. The I/C/T split ` +
          `is already in the feature set (plan 023); the remaining OpenFPL groups are blocked at ` +
          `the source — vaastav's understat player files stop before the test season, and ` +
          `understat.com now serves a JS shell with no embedded data (probed 2026-08-27). The ` +
          `candidates left are model-shaped, not feature-shaped: a distribution-aware objective, ` +
          `or v4 as a residual on the incumbent's decomposition — both recorded in B-037.`,
  );
  return { orderingMet, highReturnMet, lowReturnHeld, met, lines };
}
