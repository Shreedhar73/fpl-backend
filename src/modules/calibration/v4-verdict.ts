import { DEFAULT_KS } from './ordering';
import { PredictionRow } from './harness';

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
}

/** RMSE per return category for each named predictor, over rows where every one produced a number. */
export function categoryRmse(
  rows: PredictionRow[],
  predictors: readonly ('model' | 'form' | 'priorSeason' | 'v4')[],
): CategoryRmse[] {
  const shared = rows.filter((r) =>
    predictors.every((p) => r.predicted[p] !== null),
  );
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
    return { category, n: inCat.length, rmse };
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
    return `${name} ${c.rmse.v4.toFixed(3)} vs ${c.rmse.model.toFixed(3)} (n=${c.n})`;
  };
  lines.push(
    `**High-return accuracy — improve Tickers and Haulers:** ${fmt('Tickers')}, ${fmt('Haulers')} — ` +
      `${highReturnMet ? '**met**' : '**not met**'}.`,
  );
  lines.push(
    `**Low-return accuracy — no material (>5%) degradation:** ${fmt('Zeros')}, ${fmt('Blanks')} — ` +
      `${lowReturnHeld ? '**held**' : '**not held**'}.`,
  );
  lines.push(
    met
      ? `**The bar is met on this run.** Adoption is still a decision recorded in ` +
          `\`docs/decisions.md\` with the serving blockers answered first — a total-points GBM has ` +
          `no explain blocks (D-019), no distributions (B-017) and no pPlay, and a model that ` +
          `cannot ship its reasoning does not ship, however it measures.`
      : `**The bar is not met on this run.** \`modelVersion\` does not move. The named next step is ` +
          `feature enrichment — the Understat/vaastav groups OpenFPL uses that the archive lacks ` +
          `(I/C/T split, xGChain, xGBuildup, key passes, team Deep and PPDA) — and the negative ` +
          `result stands in this report rather than being rerun until it passes.`,
  );
  return { orderingMet, highReturnMet, lowReturnHeld, met, lines };
}
