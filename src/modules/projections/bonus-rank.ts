/**
 * Bonus as a rank inside the fixture, which is what the rule actually is (B-041, plan 028 task 4).
 *
 * **The error this replaces, measured before it was built.** FPL awards 3, 2 and 1 bonus points to
 * the three highest BPS scores **in a match** — six points, every match, always. The incumbent term
 * is a clipped linear function of a player's OWN bps per 90, so it knows nothing about the other
 * twenty-one players. Scoring realised BPS through it, per fixture:
 *
 *     season     model bonus per fixture   actual   min    max
 *     2023-24    8.72                      6.40     3.72   16.56
 *     2024-25    8.15                      6.32     3.96   15.12
 *     2025-26    8.55                      6.36     4.83   12.98
 *
 * A third too much on average — and, worse than the level, wrong in a way a constant cannot fix: the
 * over-payment lands in the high-BPS matches, which are the matches full of the premium players a
 * recommendation is made of. Two teammates who both play well are both paid full bonus here, when in
 * reality they take it from each other.
 *
 * **The model.** Plackett–Luce over the players in the fixture: each player carries a weight, the
 * first award goes to one of them in proportion to weight, the second is drawn from what remains,
 * and the third from what remains after that. It is the standard rank model for exactly this shape,
 * and it has the property the diagnostic above is about — **the three probabilities sum to one
 * apiece, so a fixture pays exactly 6 bonus points by construction**, whatever the players in it.
 *
 * The weight is `P(play) × exp(E[BPS | played] / τ)`. τ is the one free parameter: large τ flattens
 * the field toward a lottery, small τ hands the bonus to whoever has the highest projected BPS with
 * near-certainty. It is chosen on validation like every other parameter here, never assumed.
 */

/** 3 + 2 + 1. Every fixture, always — the invariant the whole module exists to hold. */
export const BONUS_POINTS_PER_FIXTURE = 6;

export interface BonusCandidate {
  /** whatever identifies the player to the caller — a code, a row key */
  key: number;
  /** P(featuring at all); a player who does not play cannot take a bonus point */
  pPlay: number;
  /** E[BPS | played] — the model's own expectation, not a realised value */
  expectedBps: number;
}

export interface BonusRanks {
  /** P(this player takes the 3 points), P(the 2), P(the 1) */
  first: number;
  second: number;
  third: number;
  /** 3·first + 2·second + third — the expected bonus POINTS before the scoring table's multiplier */
  expected: number;
  /** first + second + third, which is P(any bonus) exactly rather than through an identity */
  any: number;
}

/**
 * How many players may be considered for an award.
 *
 * The exact third-place probability is a sum over ordered pairs of the two players above it, so the
 * work is cubic in the number of candidates — and an archive fixture carries every named player,
 * unused substitutes included, which is fifty to sixty rows and not the twenty-two who played.
 *
 * **Both the cap and the renormalisation below were forced by a measurement.** At twelve the total
 * came to 5.08 of the six points; at forty, run over 1,140 real fixtures, it came to 5.691 — the
 * guard in the harness caught it. The tail is not negligible because the weights are not extreme: at
 * a temperature around ten the whole field spans a factor of five or six, so a great deal of
 * third-place mass genuinely sits outside any workable cap.
 *
 * So the cap keeps the work quadratic-ish and **each award is renormalised across the candidates**,
 * which redistributes the tail proportionally rather than dropping it. That is a real assumption —
 * it says a player outside the top twenty-five by weight never takes bonus, and hands his share to
 * the ones who might — and `truncatedMass` reports how much weight it applied to.
 */
export const BONUS_CANDIDATE_CAP = 25;

export interface FixtureBonus {
  ranks: Map<number, BonusRanks>;
  /** share of the fixture's total weight that was outside the candidate cap */
  truncatedMass: number;
  /** Σ over players of `expected` — 6 exactly when nothing was truncated, and the check that it is */
  totalExpected: number;
}

/**
 * Rank probabilities for one fixture's players.
 *
 * Returns an empty map for a fixture with no weight at all (every player certain not to play), which
 * is a real state in a backtest — a row whose whole team is missing from the archive — and not an
 * error.
 */
export function fixtureBonus(
  players: readonly BonusCandidate[],
  tau: number,
): FixtureBonus {
  const weights = players.map((p) => ({
    key: p.key,
    w:
      Math.max(0, Math.min(1, p.pPlay)) *
      Math.exp(Math.max(0, p.expectedBps) / Math.max(1e-6, tau)),
  }));
  const total = weights.reduce((t, x) => t + x.w, 0);
  const ranks = new Map<number, BonusRanks>();
  if (!(total > 0) || !Number.isFinite(total)) {
    return { ranks, truncatedMass: 0, totalExpected: 0 };
  }

  const ordered = [...weights].sort((a, b) => b.w - a.w || a.key - b.key);
  const candidates = ordered.slice(0, BONUS_CANDIDATE_CAP);
  const truncated = ordered.slice(BONUS_CANDIDATE_CAP);
  const truncatedMass = truncated.reduce((t, x) => t + x.w, 0) / total;

  const raw: { key: number; first: number; second: number; third: number }[] =
    [];
  for (const me of candidates) {
    const first = me.w / total;

    // Second: somebody else took the first award, and this player leads what is left.
    let second = 0;
    for (const j of candidates) {
      if (j.key === me.key) continue;
      const remaining = total - j.w;
      if (remaining <= 0) continue;
      second += (j.w / total) * (me.w / remaining);
    }

    // Third: two others took the first two, in either order, and this player leads the rest.
    let third = 0;
    for (const j of candidates) {
      if (j.key === me.key) continue;
      const afterJ = total - j.w;
      if (afterJ <= 0) continue;
      for (const k of candidates) {
        if (k.key === me.key || k.key === j.key) continue;
        const afterK = afterJ - k.w;
        if (afterK <= 0) continue;
        third += (j.w / total) * (k.w / afterJ) * (me.w / afterK);
      }
    }

    raw.push({ key: me.key, first, second, third });
  }

  // Each award is given out exactly once, so each column sums to one across the field. Renormalising
  // over the candidates is what turns the truncated tail into a redistribution rather than a
  // shortfall — and it is what makes `totalExpected === 6` a property of this function instead of a
  // hope about the cap.
  const columnSum = (pick: (r: (typeof raw)[number]) => number): number =>
    raw.reduce((t, r) => t + pick(r), 0);
  const sums = {
    first: columnSum((r) => r.first),
    second: columnSum((r) => r.second),
    third: columnSum((r) => r.third),
  };
  const norm = (value: number, sum: number) => (sum > 0 ? value / sum : 0);

  let totalExpected = 0;
  for (const r of raw) {
    const first = norm(r.first, sums.first);
    const second = norm(r.second, sums.second);
    const third = norm(r.third, sums.third);
    const expected = 3 * first + 2 * second + third;
    totalExpected += expected;
    ranks.set(r.key, {
      first,
      second,
      third,
      expected,
      any: first + second + third,
    });
  }

  return { ranks, truncatedMass, totalExpected };
}
