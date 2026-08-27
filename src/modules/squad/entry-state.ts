import type {
  RawEntryChip,
  RawEntryHistory,
  RawEntryTransfer,
} from '../../infra/fpl/fpl.types';

/**
 * The three pieces of a manager's state that FPL keeps private and the public API does not name:
 * **what each player cost them, how many free transfers they hold, and which chips they have left.**
 *
 * All three exist in `my-team/{id}/`, which is 403 without authentication, and we never authenticate
 * (D-013). None of them is a lost cause: each is a *derived* fact that the public record supports, and
 * this file derives it.
 *
 * The rule that shapes every function here is D-014's: **a null is loud where a wrong number is
 * quiet.** So each reconstruction reports its own source, and where the record cannot support an
 * answer it returns null rather than the nearest plausible number. A purchase price silently replaced
 * by today's market price would make the transfer planner confidently overstate a budget, and nothing
 * downstream would look wrong.
 */

/** Where a purchase price came from, carried beside it so a consumer can tell exact from inferred. */
export type PurchasePriceSource =
  /** an `element_in_cost` from the manager's own transfer log — exact */
  | 'transfer-log'
  /** the player's price in the gameweek this manager started — exact for an initial-squad pick */
  | 'starting-gameweek-price'
  /** neither is available */
  | 'unknown';

export interface PurchasePrice {
  /** tenths of a million, or null when the record cannot support one */
  price: number | null;
  source: PurchasePriceSource;
}

/**
 * What each currently-owned player cost this manager.
 *
 * Two sources, in this order, and the order matters:
 *
 * 1. **The transfer log**, newest first. A player transferred in more than once is worth what they
 *    cost the LAST time — an earlier price belongs to a spell that has already been sold.
 * 2. **Their price in the manager's starting gameweek.** FPL's per-gameweek `value` is the player's
 *    price in that gameweek, so for a pick that has been held since the beginning this is exactly
 *    what was paid. It is deliberately NOT `player_price_history`, whose earliest row in this
 *    database is 2026-08-26 — after the GW1 deadline, so it would substitute today's price for the
 *    one actually paid, in a field whose entire purpose is that the two differ.
 *
 * @param ownedFplIds the elements currently in the squad
 * @param transfers `entry/{id}/transfers/`, in any order — this function sorts
 * @param startingPrices element id → price in the manager's starting gameweek
 */
export function reconstructPurchasePrices(
  ownedFplIds: number[],
  transfers: RawEntryTransfer[],
  startingPrices: Map<number, number>,
): Map<number, PurchasePrice> {
  // Newest first, so the first transfer seen for an element is the one that bought the current spell.
  const newestFirst = [...transfers].sort((a, b) => b.event - a.event);
  const boughtFor = new Map<number, number>();
  for (const t of newestFirst) {
    if (!boughtFor.has(t.element_in))
      boughtFor.set(t.element_in, t.element_in_cost);
  }

  const out = new Map<number, PurchasePrice>();
  for (const element of ownedFplIds) {
    const fromLog = boughtFor.get(element);
    if (fromLog !== undefined) {
      out.set(element, { price: fromLog, source: 'transfer-log' });
      continue;
    }
    const atStart = startingPrices.get(element);
    if (atStart !== undefined) {
      out.set(element, { price: atStart, source: 'starting-gameweek-price' });
      continue;
    }
    out.set(element, { price: null, source: 'unknown' });
  }
  return out;
}

/**
 * The sell-price rule: **purchase price plus half the rise, rounded down** to £0.1m. A fall is eaten
 * whole — you sell at the lower price and keep none of the loss back.
 *
 * `fpl-domain-rules`: `rules.element_sell_at_purchase_price` is false and `rules.transfers_sell_on_fee`
 * is 0.5. Buy at 75, price rises to 78, sell for **76** and not 78. Getting this wrong makes the
 * optimizer overstate the budget and propose squads the manager cannot afford — which is the single
 * most common way a planner flatters itself.
 *
 * Duplicated in spirit by `calibration/season-sim.ts#sellValue`, which the simulator uses over
 * archive rows. They are the same rule and are kept in step by the same test values.
 */
export function sellValueOf(
  purchasePrice: number | null,
  marketPrice: number,
): number | null {
  if (purchasePrice === null) return null;
  if (marketPrice <= purchasePrice) return marketPrice;
  return purchasePrice + Math.floor((marketPrice - purchasePrice) / 2);
}

export interface EntryState {
  /** free transfers available for the NEXT deadline */
  freeTransfers: number;
  /** chip names already used, lowercase as FPL spells them */
  chipsUsed: string[];
  /** the gameweek the reconstruction walked up to, so a caller can check it is the current one */
  throughGameweek: number | null;
  /**
   * True when the replay had every gameweek from the manager's first. A gap means the count is a
   * lower bound rather than a number, and it says so instead of pretending.
   */
  complete: boolean;
}

/**
 * Free transfers and used chips, replayed from `entry/{id}/history/`.
 *
 * FPL grants **one free transfer per gameweek**, banked up to a cap — `rules.max_extra_free_transfers`
 * is 4, so the bank tops out at 5 available. The cap is passed in rather than assumed, because it has
 * been 1 and 2 in living memory and a rule that has changed will change again (`fpl-domain-rules`).
 *
 * The replay: start the manager's first gameweek with one, and for each gameweek subtract what they
 * spent and grant one more, capped. A wildcard or free hit gameweek is not special-cased — FPL does
 * not charge those transfers against the bank, and `event_transfers` counts them, so a chip gameweek
 * is skipped rather than subtracted.
 */
export function reconstructEntryState(
  history: RawEntryHistory,
  freeTransferCap: number,
): EntryState {
  const rounds = [...history.current].sort((a, b) => a.event - b.event);
  const chipsUsed = history.chips.map((c: RawEntryChip) =>
    c.name.toLowerCase(),
  );
  const chipEvents = new Set(
    history.chips
      .filter((c) => ['wildcard', 'freehit'].includes(c.name.toLowerCase()))
      .map((c) => c.event),
  );

  if (rounds.length === 0) {
    // A manager who has played no gameweek holds their first free transfer and nothing else.
    return {
      freeTransfers: 1,
      chipsUsed,
      throughGameweek: null,
      complete: true,
    };
  }

  let free = 1;
  for (const round of rounds) {
    if (!chipEvents.has(round.event)) {
      free = Math.max(0, free - round.event_transfers);
    }
    free = Math.min(free + 1, freeTransferCap);
  }

  const first = rounds[0].event;
  const last = rounds[rounds.length - 1].event;
  return {
    freeTransfers: free,
    chipsUsed,
    throughGameweek: last,
    complete: rounds.length === last - first + 1,
  };
}
