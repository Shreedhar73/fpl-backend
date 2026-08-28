import { PositionCode } from '../fpl-sync/mappers';
import { Rules } from '../optimizer/rules';
import { Predictor, PredictionRow } from './harness';
import { FixedSquad } from './fixed-squads';
import { benchOrder, Lineup, scoreLineup, SquadMember } from './squad-scoring';

/**
 * Given fifteen players, who plays and who takes the armband — scored against what actually happened
 * (B-012 Phase 2).
 *
 * This is the first number in the project that is about a decision rather than a prediction, and it
 * isolates exactly one decision: every predictor is handed the same fifteen (`fixed-squads.ts`), so
 * the only thing that differs is the XI, the bench order and the captain.
 *
 * **A player with no row is two different things, and conflating them is a leak.** Measured on the
 * archive, 2026-08-27: only rounds 31 and 34 of 2025-26 carry fewer than twenty clubs, so a *club*
 * with no rows really did have no fixture. A *player* with no row is another matter — 690 players
 * have a round-1 row and 820 have one by round 29, because squads are registered and re-registered
 * through the season. So absence encodes "was not selected" as often as "had no fixture", and "was
 * not selected" is not knowable before a deadline.
 *
 * The rule that follows:
 *
 *  - **The club had no fixture** — a blank, and the fixture list is public well before the deadline.
 *    Predicting 0 for them is legitimate foresight, and benching them is what a manager would do.
 *  - **The club played and the player did not** — dropped, injured, or an unused substitute. That is
 *    hindsight. Their **last known prediction is carried forward** so the lineup is chosen as it
 *    would have been on the day; they then score 0 and are substituted out like any other blank.
 *
 * Without the second rule the model quietly benches every player who was about to be dropped, which
 * is worth several points a season and looks exactly like a good minutes model.
 */

export interface RoundDecision {
  season: string;
  round: number;
  points: number;
  /** the realised points of the best possible XI from these fifteen — the ceiling for this round */
  ceiling: number;
  captainPoints: number;
  /** the best realised score among the players actually FIELDED, not among all fifteen */
  bestFieldedPoints: number;
  substitutions: number;
}

export interface DecisionSummary {
  squad: string;
  predictor: Predictor;
  rounds: number;
  totalPoints: number;
  /** share of the achievable XI points this predictor's selections actually took */
  xiEfficiency: number | null;
  /** mean gap between the best fielded score and the captain's, in points per round */
  captainRegret: number | null;
}

export function member(row: PredictionRow): SquadMember {
  return {
    playerCode: row.playerCode,
    webName: row.webName,
    position: row.position as PositionCode,
    actual: row.actual,
    minutes: row.minutes,
  };
}

/** A squad member who had no fixture this round: present, scoring nothing, substitutable. */
export function blank(row: PredictionRow): SquadMember {
  return {
    playerCode: row.playerCode,
    webName: row.webName,
    position: row.position as PositionCode,
    actual: 0,
    minutes: 0,
  };
}

/**
 * The best legal XI by a predictor's numbers, plus the bench in order and the armband.
 *
 * Enumerates legal formations exactly, the way `pickBestXi` does for the optimiser — the number of
 * legal formations is small enough that there is no reason to approximate. Kept here rather than
 * reusing `pickBestXi` directly because that one ranks `Candidate`s by horizon EP and this one ranks
 * squad members by one round's prediction, with a bench order that has to come back out.
 */
export interface SquadSlot {
  row: PredictionRow | null;
  base: PredictionRow;
  /**
   * What the predictor last said about this player, for a round where they have no row **and their
   * club did play**. Null when the club genuinely blanked, where predicting 0 is legitimate.
   */
  carried?: { points: number; pPlay: number } | null;
}

export function chooseLineup(
  squad: SquadSlot[],
  predictor: Predictor,
  rules: Rules,
): Lineup {
  const scored = squad.map((s) => ({
    member: s.row ? member(s.row) : blank(s.base),
    // No row and no carried value means the club had no fixture — a blank, knowable from the public
    // fixture list before the deadline, so ranking them last is foresight rather than hindsight.
    // A carried value means the club DID play and this player did not, which is not knowable, so the
    // lineup is chosen on what the predictor last said about them.
    predictedPoints: s.row
      ? (s.row.predicted[predictor] ?? 0)
      : (s.carried?.points ?? 0),
    pPlay: s.row ? s.row.pPlay : (s.carried?.pPlay ?? 0),
  }));

  // `playerCode` breaks the tie (B-039). Without it two players on the same projection resolve to
  // input order, which was not deterministic — and which of them starts changes the week's points.
  const byPos = (p: PositionCode) =>
    scored
      .filter((s) => s.member.position === p)
      .sort(
        (a, b) =>
          b.predictedPoints - a.predictedPoints ||
          a.member.playerCode - b.member.playerCode,
      );

  const gk = byPos('GKP');
  const def = byPos('DEF');
  const mid = byPos('MID');
  const fwd = byPos('FWD');

  let best: { picked: typeof scored; total: number } | null = null;
  for (
    let d = rules.minPlay('DEF');
    d <= Math.min(rules.maxPlay('DEF'), def.length);
    d++
  ) {
    for (
      let m = rules.minPlay('MID');
      m <= Math.min(rules.maxPlay('MID'), mid.length);
      m++
    ) {
      const f = rules.xiSize() - 1 - d - m;
      if (
        f < rules.minPlay('FWD') ||
        f > Math.min(rules.maxPlay('FWD'), fwd.length)
      )
        continue;
      if (gk.length < 1) continue;
      const picked = [
        ...gk.slice(0, 1),
        ...def.slice(0, d),
        ...mid.slice(0, m),
        ...fwd.slice(0, f),
      ];
      const total = picked.reduce((s, x) => s + x.predictedPoints, 0);
      if (!best || total > best.total) best = { picked, total };
    }
  }
  if (!best) {
    // Say WHICH shape failed. "No legal XI" is true of an empty squad, a squad of ten, and a squad
    // with two goalkeepers and no defenders, and the three have nothing to do with each other.
    const shape = `${gk.length} GKP / ${def.length} DEF / ${mid.length} MID / ${fwd.length} FWD`;
    throw new Error(
      `no legal XI from this squad — it holds ${scored.length} players (${shape}), and the rules ` +
        `need 1 GKP plus ${rules.minPlay('DEF')}-${rules.maxPlay('DEF')} DEF, ` +
        `${rules.minPlay('MID')}-${rules.maxPlay('MID')} MID, ` +
        `${rules.minPlay('FWD')}-${rules.maxPlay('FWD')} FWD in an XI of ${rules.xiSize()}`,
    );
  }

  const starters = best.picked;
  const startingCodes = new Set(starters.map((s) => s.member.playerCode));
  const benched = scored.filter((s) => !startingCodes.has(s.member.playerCode));

  // The bench goalkeeper takes slot 1 by rule; the outfield bench is ordered by pPlay x predicted.
  const benchGk = benched.filter((s) => s.member.position === 'GKP');
  const benchOutfield = benchOrder(
    benched.filter((s) => s.member.position !== 'GKP'),
    (s) => s.member.playerCode,
  );

  // Tie-broken on `playerCode` (B-039): the armband is doubled, so a tie resolved by input order
  // is the single largest thing a non-deterministic row order can move in one week.
  const captainPick = [...starters].sort(
    (a, b) =>
      b.predictedPoints - a.predictedPoints ||
      a.member.playerCode - b.member.playerCode,
  );

  return {
    starters: starters.map((s) => s.member),
    bench: [...benchGk, ...benchOutfield].map((s) => s.member),
    captain: captainPick[0].member.playerCode,
    vice: (captainPick[1] ?? captainPick[0]).member.playerCode,
  };
}

/**
 * The realised points of the best XI these fifteen could have fielded, **with the best armband on
 * it** — the round's ceiling.
 *
 * The captain has to be in here. A scored round doubles someone, so a ceiling that does not is not a
 * ceiling: efficiency came out above 100% for every squad and every predictor on the first run,
 * which is the tell. The ceiling is the perfect decision, and the perfect decision includes captaining
 * the highest scorer in the XI.
 */
export function ceilingFor(members: SquadMember[], rules: Rules): number {
  const byPos = (p: PositionCode) =>
    members
      .filter((m) => m.position === p)
      .sort((a, b) => b.actual - a.actual || a.playerCode - b.playerCode);
  const gk = byPos('GKP');
  const def = byPos('DEF');
  const mid = byPos('MID');
  const fwd = byPos('FWD');
  let best = 0;
  for (
    let d = rules.minPlay('DEF');
    d <= Math.min(rules.maxPlay('DEF'), def.length);
    d++
  ) {
    for (
      let m = rules.minPlay('MID');
      m <= Math.min(rules.maxPlay('MID'), mid.length);
      m++
    ) {
      const f = rules.xiSize() - 1 - d - m;
      if (
        f < rules.minPlay('FWD') ||
        f > Math.min(rules.maxPlay('FWD'), fwd.length)
      )
        continue;
      if (gk.length < 1) continue;
      const xi = [
        gk[0],
        ...def.slice(0, d),
        ...mid.slice(0, m),
        ...fwd.slice(0, f),
      ];
      const base = xi.reduce((s, x) => s + x.actual, 0);
      // The best captain in that XI, doubled — but only if they featured. A perfect manager cannot
      // double a player who registered no minutes either.
      const bestCaptain = Math.max(
        0,
        ...xi.filter((x) => x.minutes > 0).map((x) => x.actual),
      );
      const total = base + bestCaptain;
      if (total > best) best = total;
    }
  }
  return best;
}

/**
 * The clubs that had a fixture in a round, inferred from the rows themselves.
 *
 * There is no archive fixtures table. A club with no rows at all had no fixture — verified on
 * 2025-26, where exactly two rounds (31 and 34) carry fewer than twenty clubs and every other round
 * carries all twenty. The same inference at *player* level is unsafe and is why `SquadSlot.carried`
 * exists.
 */
export function playingTeams(byCode: Map<number, PredictionRow>): Set<number> {
  const teams = new Set<number>();
  for (const r of byCode.values())
    if (r.teamCode !== null) teams.add(r.teamCode);
  return teams;
}

/**
 * Build the slot for one owned player in one round, applying the blank-versus-dropped rule.
 *
 * `lastSeen` is the predictor's most recent word on each player, updated as the walk proceeds.
 */
export function slotFor(
  base: PredictionRow,
  byCode: Map<number, PredictionRow>,
  playing: Set<number>,
  lastSeen: Map<number, { points: number; pPlay: number }>,
): SquadSlot {
  const row = byCode.get(base.playerCode) ?? null;
  if (row) return { row, base, carried: null };
  const clubPlayed = base.teamCode !== null && playing.has(base.teamCode);
  return {
    row: null,
    base,
    carried: clubPlayed ? (lastSeen.get(base.playerCode) ?? null) : null,
  };
}

export function decideOverSeason(
  squad: FixedSquad,
  rowsByRound: Map<number, Map<number, PredictionRow>>,
  predictor: Predictor,
  rules: Rules,
  season: string,
): { rounds: RoundDecision[]; summary: DecisionSummary } {
  const rounds: RoundDecision[] = [];

  const lastSeen = new Map<number, { points: number; pPlay: number }>();

  for (const [round, byCode] of [...rowsByRound.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const playing = playingTeams(byCode);
    const present = squad.members.map((base) =>
      slotFor(base, byCode, playing, lastSeen),
    );
    // A squad whose every member is missing this round is a squad this comparison cannot score.
    if (present.every((p) => p.row === null)) continue;

    const lineup = chooseLineup(present, predictor, rules);
    const scored = scoreLineup(lineup, rules);
    const allMembers = present.map((p) =>
      p.row ? member(p.row) : blank(p.base),
    );
    const bestFielded = Math.max(...scored.fielded.map((m) => m.actual));
    const captain = scored.fielded.find((m) => m.playerCode === scored.doubled);

    for (const p of present) {
      if (p.row) {
        lastSeen.set(p.row.playerCode, {
          points: p.row.predicted[predictor] ?? 0,
          pPlay: p.row.pPlay,
        });
      }
    }

    rounds.push({
      season,
      round,
      points: scored.points,
      ceiling: ceilingFor(allMembers, rules),
      captainPoints: captain?.actual ?? 0,
      bestFieldedPoints: bestFielded,
      substitutions: scored.substitutions.length,
    });
  }

  const totalPoints = rounds.reduce((s, r) => s + r.points, 0);
  const ceiling = rounds.reduce((s, r) => s + r.ceiling, 0);
  const regrets = rounds.map((r) => r.bestFieldedPoints - r.captainPoints);

  return {
    rounds,
    summary: {
      squad: squad.label,
      predictor,
      rounds: rounds.length,
      totalPoints,
      // Efficiency, not raw points, so squads of different quality can be read side by side: the
      // question is how much of what THIS squad could have delivered the predictor's choices took.
      xiEfficiency: ceiling > 0 ? totalPoints / ceiling : null,
      captainRegret:
        regrets.length > 0
          ? regrets.reduce((s, x) => s + x, 0) / regrets.length
          : null,
    },
  };
}

/**
 * The paired difference between two predictors over the same squad and the same rounds.
 *
 * **A mean difference over 38 rounds is not a result on its own, and this is the guard against
 * reporting one as if it were.** Measured next door on the B-011 collision sweep (fpl-backend
 * `reports/guards-009.md`, 103 archived gameweeks): a paired per-round difference of +0.59 realised
 * points carried a standard deviation of 0.92, and the per-season sign flipped — −2.41, +2.34, +0.97
 * across three seasons of the same comparison. A season is 38 rounds; effects of a couple of points
 * per gameweek do not resolve in that many.
 *
 * So every difference this file reports comes with the standard error of the pairing and a plain
 * statement of whether it clears it. Pairing by round rather than comparing two independent means is
 * what makes even that possible: both predictors faced the same fixtures, the same blanks and the
 * same hauls, so the round-to-round variance that dominates the raw totals cancels.
 */
export interface PairedDifference {
  rounds: number;
  meanDifference: number;
  standardError: number;
  /** |mean| > 2 x standard error — the crudest possible bar, and it is deliberately crude */
  clearsNoise: boolean;
}

export function pairedDifference(
  a: RoundDecision[],
  b: RoundDecision[],
): PairedDifference | null {
  const byRound = new Map(b.map((r) => [`${r.season}|${r.round}`, r]));
  const diffs: number[] = [];
  for (const r of a) {
    const other = byRound.get(`${r.season}|${r.round}`);
    if (other) diffs.push(r.points - other.points);
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
