import { PositionCode } from '../fpl-sync/mappers';
import {
  Candidate,
  Concentration,
  NO_CONCENTRATION,
  SquadObjective,
} from '../optimizer/ilp';
import { BENCH_WEIGHT } from '../optimizer/policy';
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
 *   maximise  Σ ep_i (y_i + c_i)  +  benchWeight · Σ ep_i (x_i − y_i)
 *             −  λ Σ d_ij  −  hitCost · h
 *   s.t.      Σ x_i = 15,  Σ y_i = 11,  Σ c_i = 1,  y_i ≤ x_i,  c_i ≤ y_i
 *             position quotas on x, formation bounds on y,  ≤ 3 per club
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
 * ## One objective with the recommendation, since B-024
 *
 * This program used to maximise `Σ ep · x` over all fifteen while the squad recommendation maximised
 * the eleven, the bench at a discount and the armband. The two could prefer different players for the
 * same money, and a user saw both halves on one screen. The `y` and `c` families here are the same
 * families `buildLp` emits, in the same shape, so the two differ only where they must: this budget
 * row prices a kept player at his sell value, and this objective carries the hit.
 *
 * The defensive-concentration charge could not be carried before that, for a structural reason rather
 * than an oversight — it keys off `y`, and this program had no `y`. Adding the charge before the
 * eleven would have been meaningless, which is why B-024 fixed the order.
 *
 * ## What it does not do
 *
 * No chips: a chip is unspendable once used, so it is a season-level decision and the model
 * recommends a window rather than committing one (`chips.ts`).
 */

/** Points charged per transfer beyond the free ones. A rule, not a policy knob. */
export const HIT_COST = 4;

/**
 * How many HITS a plan may take, beyond the free transfers the manager holds (#97).
 *
 * Two, which is −8 — the depth `plan-gameweek` says the comparison runs to ("no transfer, one
 * transfer, and each hit up to −8"). The cap used to be a flat three moves, and the flat number made
 * the reachable HIT depth a function of the bank: with one free transfer, −8 was three moves and
 * allowed; with two banked it was four and silently unreachable. The question being asked did not
 * change, only the manager's bank, which is the wrong thing for it to depend on.
 *
 * **The old bound was not a solve-time bound, measured before it was changed.** 15 owned against a
 * 600-player market, HiGHS: 131 ms at a cap of two, 151 at three, 152 at four, 142 at five, 138 at
 * six, 136 at eight. Flat. What moved was the objective — 65.22, 68.57, 71.78, 74.70, 74.70, 74.70:
 * it improves to the fifth move and then **stops on its own**, because past the free transfers each
 * move must clear four points and the marginal one does not. The count was excluding plans the
 * objective was already rejecting, and a few it was not.
 *
 * The old comment argued three moves because "beyond about three a transfer plan is a wildcard by
 * another name". That holds for HITS and not for free transfers: the bank caps at five, and a
 * manager spending five free transfers is playing ordinary FPL, not a chip.
 *
 * **Both constants live here rather than in `transfers.service.ts`, where they were.** A harness that
 * walks this planner over a season has to use the numbers the planner is served with, and importing
 * them from the service means importing the service — its repository, its Prisma client and its Nest
 * decorators — into a backtest. Copying them instead is how a harness ends up measuring a planner
 * nobody is served.
 */
export const MAX_HITS = 2;

/**
 * The move cap for a manager holding `freeTransfers`, which is what callers pass as `maxTransfers`.
 *
 * A function rather than a constant because the honest bound is "everything free, plus the hits the
 * question asks about", and only the first half is a property of the manager.
 */
export function maxTransfersFor(
  freeTransfers: number,
  hits = MAX_HITS,
): number {
  return Math.max(1, Math.floor(freeTransfers)) + hits;
}

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
  /** cap on transfers considered at once; keeps the LP small and the advice human-sized */
  maxTransfers: number;
  /**
   * What a bench place is worth (B-024). Defaults to what the recommendation is solved with.
   *
   * Until B-024 this program had no eleven at all: it maximised `Σ EP · x` over the fifteen while the
   * recommendation maximised `Σ EP(y + c) + benchWeight · Σ EP(x − y)`. The two could prefer
   * different players for the same money, and a user saw both halves on one screen.
   */
  benchWeight?: number;
  /**
   * The defensive-concentration charge (B-029), on the eleven this program now chooses.
   *
   * It could not be carried before B-024 for a structural reason rather than an oversight: the rule
   * keys off `y`, and this program had no `y`. Adding the charge before adding the eleven would have
   * been meaningless, which is why B-024 fixed the order.
   */
  concentration?: Concentration;
  /**
   * Which objective to maximise. **A measurement knob, never a serving one** — see `SquadObjective`.
   *
   * `all-fifteen-equal` reproduces the objective this program had before B-024: `Σ EP · x`, no
   * eleven priced, no armband, no concentration. It exists so B-024's change can be paired against
   * what it replaced on one season rather than compared across two report runs, which is the only
   * comparison tight enough to resolve it.
   */
  objective?: SquadObjective;
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
  const benchWeight = input.benchWeight ?? BENCH_WEIGHT;
  const concentration = input.concentration ?? NO_CONCENTRATION;
  const all = [...owned, ...market];
  const ownedKeys = new Set(owned.map((c) => c.key));
  const xi = (c: Candidate) => `y_${c.key}`;
  const cap = (c: Candidate) => `k_${c.key}`;
  // Only the pairs both of whose players are in THIS program. A `d` row naming a player who is not
  // creates a free variable with a zero objective and a constraint that can never bind — the same
  // trap `buildLp` names, and this program's universe is a different set from that one's.
  const inLp = new Set(all.map((c) => c.key));
  const pairs =
    concentration.lambda === 0
      ? []
      : concentration.pairs.filter(
          (p) => inLp.has(p.a.key) && inLp.has(p.b.key),
        );

  const sellOf = (c: OwnedCandidate): number => c.sellValue ?? c.cost;
  const budgetCoef = (c: Candidate): number =>
    ownedKeys.has(c.key) ? sellOf(c as OwnedCandidate) : c.cost;
  const proceedsIfAllSold = owned.reduce((s, c) => s + sellOf(c), 0);

  const inPos = (pos: PositionCode) => all.filter((c) => c.position === pos);
  const clubs = [...new Set(all.map((c) => c.teamId))];
  const inClub = (teamId: string) => all.filter((c) => c.teamId === teamId);

  const join = (parts: string[]) => parts.join(' +\n  ');
  const lines: string[] = [];

  lines.push('Maximize');
  // Every term after the first carries an explicit sign. An LP objective written as a bare list of
  // coefficients with no operators between them is not a parse error in every solver — it is a
  // DIFFERENT objective in some, which is the worst of both.
  // The SAME objective the recommendation is solved under (B-024), plus the hit this program alone
  // carries. `Σ EP(y + c) + benchWeight · Σ EP(x − y) − λ Σ d − hitCost · h`, written with the `x`
  // and `y` coefficients already collected so the file stays one linear row per variable.
  const terms: { coef: number; name: string }[] =
    (input.objective ?? 'xi-bench-captain') === 'all-fifteen-equal'
      ? [
          ...all.map((c) => ({ coef: c.ep, name: c.key })),
          { coef: -hitCost, name: 'h' },
        ]
      : [
          ...all.map((c) => ({ coef: benchWeight * c.ep, name: c.key })),
          ...all.map((c) => ({ coef: (1 - benchWeight) * c.ep, name: xi(c) })),
          ...all.map((c) => ({ coef: c.ep, name: cap(c) })),
          ...pairs.map((_, i) => ({
            coef: -concentration.lambda,
            name: `d_${i}`,
          })),
          { coef: -hitCost, name: 'h' },
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

  // --- The eleven and the armband (B-024). Identical in shape to `buildLp`'s, deliberately: the two
  // programs should differ only where they must — this one's budget prices a kept player at his sell
  // value and carries the hit.
  lines.push(` xi: ${join(all.map((c) => xi(c)))} = ${rules.xiSize()}`);
  lines.push(` captain: ${join(all.map((c) => cap(c)))} = 1`);
  for (const pos of POSITIONS) {
    const inThis = inPos(pos).map((c) => xi(c));
    if (inThis.length === 0) continue;
    lines.push(` play_min_${pos}: ${join(inThis)} >= ${rules.minPlay(pos)}`);
    lines.push(` play_max_${pos}: ${join(inThis)} <= ${rules.maxPlay(pos)}`);
  }
  for (const c2 of all) {
    lines.push(` own_${c2.key}: ${xi(c2)} - ${c2.key} <= 0`);
    lines.push(` armband_${c2.key}: ${cap(c2)} - ${xi(c2)} <= 0`);
  }
  // On `y`, because benching genuinely answers this charge — a benched player scores nothing and
  // carries no variance. See `buildLp`; the reasoning is the same rule, not a second one.
  pairs.forEach((p, i) => {
    lines.push(` conc_${i}: ${xi(p.a)} + ${xi(p.b)} - d_${i} <= 1`);
  });

  // **No penalty rows at all since B-029, and that is a real divergence rather than a tidy-up.** This
  // LP carried B-011's collision rows on `x`; B-028 measured that rule to be pricing a hedge and it
  // was retired. Its replacement — the defensive-concentration charge — keys off `y`, and this
  // program has no `y`: it chooses a fifteen and never an eleven. So the transfer planner now
  // optimises raw horizon EP less the hit, while the recommendation also prices the bench, the
  // armband and the concentration. That gap is B-024's, and it got wider here, not narrower.
  lines.push('Bounds');
  lines.push(' h >= 0');
  // `d` stays continuous and out of `Binary`: the `-lambda` objective pushes it to its lower bound,
  // so it lands on 0 unless its row forces it up.
  for (let i = 0; i < pairs.length; i++) lines.push(` d_${i} >= 0`);

  lines.push('Binary');
  lines.push(
    '  ' +
      [
        ...all.map((c) => c.key),
        ...all.map((c) => xi(c)),
        ...all.map((c) => cap(c)),
      ].join('\n  '),
  );
  lines.push('End');
  return lines.join('\n');
}
