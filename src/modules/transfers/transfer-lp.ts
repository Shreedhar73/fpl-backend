import { PositionCode } from '../fpl-sync/mappers';
import { Candidate, Collisions, NO_COLLISIONS } from '../optimizer/ilp';
import { POSITIONS, Rules } from '../optimizer/rules';

/**
 * The transfer decision as an integer program (B-008).
 *
 * The squad optimizer answers "what is the best legal fifteen from nothing". This answers a different
 * and harder question: **what is the best legal fifteen reachable from the one you already own**, given
 * that leaving a player costs you the difference between his sell value and his market price, that
 * you may only make so many moves for free, and that every move beyond that costs four points.
 *
 * ## The hit is inside the objective, and that is the whole design
 *
 * A planner that decides transfers first and then asks "can I afford the hit" is answering the wrong
 * question in the wrong order. The question is always **"is this player worth more than four points
 * over the horizon"**, so the −4 belongs in the objective where the solver can trade it off:
 *
 * ```
 *   maximise  Σ ep_i · x_i  −  hitCost · h
 *   s.t.      Σ x_i = 15,  position quotas,  ≤ 3 per club
 *             Σ cost_i · x_i  ≤  bank + Σ_{owned, sold} sellValue_i
 *             h  ≥  (owned not kept)  −  freeTransfers
 *             h  ≥  0
 * ```
 *
 * `h` is continuous rather than binary: the objective drives it to its lower bound, so it lands on
 * exactly `max(0, transfers − free)` without the solver having to branch on it.
 *
 * ## The budget row is where a planner usually lies to itself
 *
 * Money comes back at **sell value**, not market price — purchase price plus half the rise, rounded
 * down. Writing the budget in market prices invents money and produces squads the manager could not
 * have bought. It is written here as: everything you keep or buy must fit inside the bank plus what
 * you get for what you sell. Algebraically, with `k_i = 1` for an owned player kept,
 *
 * ```
 *   Σ_{bought} cost_i  ≤  bank + Σ_{sold} sell_i
 *   ⇔ Σ_{i ∉ owned} cost_i · x_i  +  Σ_{i ∈ owned} sell_i · x_i  ≤  bank + Σ_{i ∈ owned} sell_i
 * ```
 *
 * — a keep "costs" its own sell value, because keeping it is declining that money. That form is one
 * linear row and needs no separate buy/sell variables.
 *
 * ## What it does not do
 *
 * No chips: a chip is unspendable once used, so it is a season-level decision and the model
 * recommends a window rather than committing one (`chips.ts`). No collision penalty by default — the
 * caller passes one if it wants the same guard the squad solve uses, and the API does, so a plan and
 * a recommendation are judged by one objective.
 */

export interface OwnedCandidate extends Candidate {
  /**
   * What this player sells for, in tenths. **Null when it could not be reconstructed**, and the
   * caller must decide what that means rather than this file quietly substituting `cost`.
   */
  sellValue: number | null;
}

export interface TransferLpInput {
  /** the fifteen currently held */
  owned: OwnedCandidate[];
  /** everyone else who could be bought */
  market: Candidate[];
  rules: Rules;
  /** tenths of a million in the bank */
  bank: number;
  freeTransfers: number;
  /** points charged per transfer beyond the free ones */
  hitCost: number;
  collisions?: Collisions;
  /** cap on transfers considered at once; keeps the LP small and the advice human-sized */
  maxTransfers: number;
}

/**
 * Build the LP.
 *
 * Both sides of the universe are emitted as binaries over one variable set — an owned player and a
 * market player differ only in their budget coefficient and in whether leaving them counts as a
 * transfer. Modelling "sell" and "buy" as separate variables would double the variable count and
 * introduce a consistency constraint that can be got wrong.
 */
export function buildTransferLp(input: TransferLpInput): string {
  const { owned, market, rules, bank, freeTransfers, hitCost } = input;
  const collisions = input.collisions ?? NO_COLLISIONS;
  const all = [...owned, ...market];
  const ownedKeys = new Set(owned.map((c) => c.key));

  const sellOf = (c: OwnedCandidate): number => c.sellValue ?? c.cost;
  const budgetCoef = (c: Candidate): number =>
    ownedKeys.has(c.key) ? sellOf(c as OwnedCandidate) : c.cost;
  const proceedsIfAllSold = owned.reduce((s, c) => s + sellOf(c), 0);

  const inPos = (pos: PositionCode) => all.filter((c) => c.position === pos);
  const clubs = [...new Set(all.map((c) => c.teamId))];
  const inClub = (teamId: string) => all.filter((c) => c.teamId === teamId);

  const inLp = new Set(all.map((c) => c.key));
  const pairs =
    collisions.lambda === 0
      ? []
      : collisions.pairs.filter(
          (p) => inLp.has(p.attacker.key) && inLp.has(p.defender.key),
        );

  const join = (parts: string[]) => parts.join(' +\n  ');
  const lines: string[] = [];

  lines.push('Maximize');
  // Every term after the first carries an explicit sign. An LP objective written as a bare list of
  // coefficients with no operators between them is not a parse error in every solver — it is a
  // DIFFERENT objective in some, which is the worst of both.
  const terms: { coef: number; name: string }[] = [
    ...all.map((c) => ({ coef: c.ep, name: c.key })),
    { coef: -hitCost, name: 'h' },
    ...pairs.map((_, i) => ({ coef: -collisions.lambda, name: `z_${i}` })),
  ];
  lines.push(
    ' obj: ' +
      terms
        .map((t, i) => {
          const body = `${Math.abs(t.coef).toFixed(4)} ${t.name}`;
          if (i === 0) return t.coef < 0 ? `-${body}` : body;
          return `${t.coef < 0 ? '-' : '+'} ${body}`;
        })
        .join('\n  '),
  );

  lines.push('Subject To');
  lines.push(` squad: ${join(all.map((c) => c.key))} = ${rules.squadSize()}`);
  for (const pos of POSITIONS) {
    lines.push(
      ` sel_${pos}: ${join(inPos(pos).map((c) => c.key))} = ${rules.squadSelect(pos)}`,
    );
  }
  // See the class comment: a kept player "costs" his own sell value, because keeping him is declining
  // that money. One row, no buy/sell split.
  lines.push(
    ` budget: ${join(all.map((c) => `${budgetCoef(c)} ${c.key}`))} <= ${bank + proceedsIfAllSold}`,
  );
  for (const teamId of clubs) {
    lines.push(
      ` club_${teamId}: ${join(inClub(teamId).map((c) => c.key))} <= ${rules.clubLimit()}`,
    );
  }

  // Transfers made = owned players NOT kept = |owned| - Σ_{i owned} x_i.
  //   h >= transfers - free   ⇔   h + Σ_{i owned} x_i >= |owned| - free
  lines.push(
    ` hits: h + ${join(owned.map((c) => c.key))} >= ${owned.length - freeTransfers}`,
  );
  // A cap on how many moves may be considered at once. It is a readability bound as much as a
  // performance one — a nine-transfer plan is not advice, it is a wildcard, and this planner does not
  // hold a wildcard.
  //   transfers <= max   ⇔   Σ_{i owned} x_i >= |owned| - max
  lines.push(
    ` maxmoves: ${join(owned.map((c) => c.key))} >= ${Math.max(0, owned.length - input.maxTransfers)}`,
  );

  pairs.forEach((p, i) => {
    lines.push(
      ` conf_${i}: ${p.attacker.key} + ${p.defender.key} - z_${i} <= 1`,
    );
  });

  lines.push('Bounds');
  lines.push(' h >= 0');
  for (let i = 0; i < pairs.length; i++) lines.push(` z_${i} >= 0`);

  lines.push('Binary');
  lines.push('  ' + all.map((c) => c.key).join('\n  '));
  lines.push('End');
  return lines.join('\n');
}
