import { PositionCode } from '../fpl-sync/mappers';
import { DEFCON_THRESHOLD } from '../projections/points';

/**
 * What a fixture collision actually does, measured (B-028).
 *
 * **The question nobody asked.** B-011 charges a squad for owning one of our attackers against one of
 * our defensive players in the same match, on the argument that the squad is then "betting against
 * itself". That has been argued three times and measured once — a lambda sweep asking whether the
 * penalty earns points, which answered no. What the penalty is *about* has never been measured at
 * all.
 *
 * **Two things are worth being precise about before reading any number below.**
 *
 *  1. **A correlation cannot make a linear objective wrong in expectation.** `E[A + D] = E[A] + E[D]`
 *     however A and D covary. So the collision penalty is not, and never was, a correction to
 *     expected points — it can only be a statement about VARIANCE. Every argument for it phrased as
 *     "the projections are honest marginally and the squad is still wrong" is really an argument
 *     about the shape of the distribution, not its mean.
 *  2. **Negative covariance reduces the variance of a portfolio.** `Var(A + D) = Var(A) + Var(D) +
 *     2·Cov(A, D)`. If our attacker and their defender genuinely work against each other, holding both
 *     is a HEDGE — it narrows the range of outcomes. Whether that is good depends on what a manager
 *     is chasing, and it is the opposite of the usual reading of B-011.
 *
 * So the useful measurements are the covariance, what it does to the pair's variance, and — because
 * the 2025/26 defensive-contribution category may have changed the mechanism entirely — the same
 * numbers split by season.
 */

/** One archived player-fixture, as much of it as this analysis reads. */
export interface ArchiveRow {
  season: string;
  round: number;
  fixture: number;
  playerCode: number;
  webName: string;
  position: PositionCode;
  teamCode: number | null;
  opponentTeamCode: number | null;
  minutes: number;
  totalPoints: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  bonus: number;
  defensiveContribution: number | null;
  clearancesBlocksInterceptions: number | null;
  tackles: number | null;
  recoveries: number | null;
}

/**
 * Did this row reach the defensive-contribution threshold?
 *
 * **`defensiveContribution` is a COUNT of qualifying actions, not points and not a flag** — the
 * importer asserts that against the components on every archive row (`archive.service.ts`). Read as
 * a flag it awards 2 points to anyone who made one tackle, which is 3,000 of 3,026 defender-matches
 * in 2025-26 rather than the 816 that actually qualified. The threshold comes from
 * `DEFCON_THRESHOLD`, the same constant the points engine uses, rather than a literal here.
 */
export function reachedDefconThreshold(row: ArchiveRow): boolean {
  const threshold = DEFCON_THRESHOLD[row.position];
  if (!threshold) return false;
  return (row.defensiveContribution ?? 0) >= threshold;
}

/** Attacking and defensive sides of a collision, as `policy.ts` defines them. */
const ATTACKING: PositionCode[] = ['FWD', 'MID'];
const DEFENSIVE: PositionCode[] = ['DEF', 'GKP'];

export interface Summary {
  n: number;
  mean: number;
  variance: number;
  sd: number;
}

export function summarise(xs: number[]): Summary {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, variance: 0, sd: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  // Sample variance. With n in the tens of thousands the correction is irrelevant to the answer and
  // relevant to whether a reader can reproduce the number from the same rows.
  const variance =
    n < 2 ? 0 : xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  return { n, mean, variance, sd: Math.sqrt(variance) };
}

export interface PairStats {
  n: number;
  meanAttacker: number;
  meanDefender: number;
  covariance: number;
  correlation: number;
  /**
   * Standard error of the correlation, `sqrt((1 − r²) / (n − 2))`.
   *
   * Present because this project has read a mean over 38 rounds as a result before. A correlation of
   * −0.02 over 40,000 pairs and a correlation of −0.02 over 40 are different findings.
   */
  correlationSe: number;
  /** Var(A) + Var(D) — what the variance of the pair would be if they were independent */
  independentVariance: number;
  /** Var(A + D) — what it actually is */
  jointVariance: number;
}

export function pairStats(pairs: [number, number][]): PairStats {
  const a = summarise(pairs.map((p) => p[0]));
  const d = summarise(pairs.map((p) => p[1]));
  const n = pairs.length;
  const covariance =
    n < 2
      ? 0
      : pairs.reduce((s, [x, y]) => s + (x - a.mean) * (y - d.mean), 0) /
        (n - 1);
  const denom = a.sd * d.sd;
  const correlation = denom === 0 ? 0 : covariance / denom;
  return {
    n,
    meanAttacker: a.mean,
    meanDefender: d.mean,
    covariance,
    correlation,
    correlationSe:
      n > 2 ? Math.sqrt((1 - correlation ** 2) / (n - 2)) : Number.NaN,
    independentVariance: a.variance + d.variance,
    jointVariance: a.variance + d.variance + 2 * covariance,
  };
}

/**
 * A group of rows keyed by fixture, so both sides of a match are in hand at once.
 *
 * The archive has no fixtures table — it stores per-player rows — so a fixture is recovered from the
 * `(season, fixture)` key that every row in it shares. A double gameweek is two fixtures and needs no
 * special case; a player with no row simply is not in one.
 */
export function byFixture(rows: ArchiveRow[]): Map<string, ArchiveRow[]> {
  const out = new Map<string, ArchiveRow[]>();
  for (const r of rows) {
    if (r.teamCode === null || r.opponentTeamCode === null) continue;
    const key = `${r.season}|${r.fixture}`;
    const list = out.get(key);
    if (list) list.push(r);
    else out.set(key, [r]);
  }
  return out;
}

export interface CollisionPair {
  season: string;
  attacker: ArchiveRow;
  defender: ArchiveRow;
}

/**
 * Every (our attacker, their defensive player) pair the archive contains, both directions.
 *
 * **Only players who actually featured.** A row with 0 minutes is a player who did not play, and
 * pairing him would measure the correlation between two absences. That is a real thing a squad
 * suffers, but it is not what B-011 is about, and including it would drag every correlation toward
 * whatever "both blanked" looks like.
 */
export function collisionPairs(rows: ArchiveRow[]): CollisionPair[] {
  const out: CollisionPair[] = [];
  for (const group of byFixture(rows).values()) {
    const played = group.filter((r) => r.minutes > 0);
    const teams = [...new Set(played.map((r) => r.teamCode))];
    if (teams.length !== 2) continue;
    for (const team of teams) {
      const attackers = played.filter(
        (r) => r.teamCode === team && ATTACKING.includes(r.position),
      );
      const defenders = played.filter(
        (r) => r.teamCode !== team && DEFENSIVE.includes(r.position),
      );
      for (const attacker of attackers) {
        for (const defender of defenders) {
          out.push({ season: attacker.season, attacker, defender });
        }
      }
    }
  }
  return out;
}

export interface ConditionalSplit {
  /** what the defensive player scored when the opposing attacker returned a goal or an assist */
  whenAttackerReturned: Summary;
  /** and when he did not */
  whenAttackerBlanked: Summary;
  /** the difference, and the standard error of the difference — a gap inside it is not a finding */
  difference: number;
  differenceSe: number;
}

export function conditionalOnReturn(pairs: CollisionPair[]): ConditionalSplit {
  const returned: number[] = [];
  const blanked: number[] = [];
  for (const p of pairs) {
    const isReturn = p.attacker.goalsScored > 0 || p.attacker.assists > 0;
    (isReturn ? returned : blanked).push(p.defender.totalPoints);
  }
  const a = summarise(returned);
  const b = summarise(blanked);
  const se =
    a.n > 1 && b.n > 1
      ? Math.sqrt(a.variance / a.n + b.variance / b.n)
      : Number.NaN;
  return {
    whenAttackerReturned: a,
    whenAttackerBlanked: b,
    difference: a.mean - b.mean,
    differenceSe: se,
  };
}

/**
 * What a defensive player's points are actually made of, by season.
 *
 * The whole B-027/B-028 question in one table. If a defender's points are mostly the clean sheet,
 * B-011's premise holds and owning the other side really is betting both ways. If they are mostly
 * appearance, defensive contribution and his own attacking returns, the clean sheet is a minority
 * stake and the penalty is priced against something small.
 *
 * Attribution is by EVENT rather than by fitted coefficient, so it is arithmetic a reader can check:
 * a clean sheet is worth 4 to a DEF or GKP, defensive contribution 2, an appearance 1 or 2, a goal 6
 * or 4, an assist 3. The remainder — cards, saves, own goals, penalties, and the concession penalty —
 * is reported rather than hidden, and it is what makes the columns sum to the total.
 */
export interface PointsComposition {
  season: string;
  n: number;
  meanTotal: number;
  appearance: number;
  cleanSheet: number;
  defensiveContribution: number;
  goals: number;
  assists: number;
  bonus: number;
  /** everything else, including the negative terms — reported so the columns reconcile */
  remainder: number;
  /** share of a defensive player's points that comes from the clean sheet */
  cleanSheetShare: number;
  /** and from defensive contribution, which did not exist before 2025-26 */
  defconShare: number;
}

export function defensiveComposition(
  rows: ArchiveRow[],
  season: string,
): PointsComposition {
  const here = rows.filter(
    (r) =>
      r.season === season && DEFENSIVE.includes(r.position) && r.minutes > 0,
  );
  const n = here.length || 1;
  const per = (f: (r: ArchiveRow) => number) =>
    here.reduce((s, r) => s + f(r), 0) / n;

  const appearance = per((r) => (r.minutes >= 60 ? 2 : 1));
  const cleanSheet = per((r) => (r.cleanSheets > 0 ? 4 : 0));
  const defcon = per((r) => (reachedDefconThreshold(r) ? 2 : 0));
  // A goalkeeper scoring is worth more, and rare enough that the distinction changes nothing here;
  // GKP and DEF are both 6 in the 2025/26 table, so one number is correct rather than convenient.
  const goals = per((r) => r.goalsScored * 6);
  const assists = per((r) => r.assists * 3);
  const bonus = per((r) => r.bonus);
  const meanTotal = per((r) => r.totalPoints);

  return {
    season,
    n: here.length,
    meanTotal,
    appearance,
    cleanSheet,
    defensiveContribution: defcon,
    goals,
    assists,
    bonus,
    remainder:
      meanTotal - appearance - cleanSheet - defcon - goals - assists - bonus,
    cleanSheetShare: meanTotal === 0 ? 0 : cleanSheet / meanTotal,
    defconShare: meanTotal === 0 ? 0 : defcon / meanTotal,
  };
}

/**
 * Does a defender's defensive work rise when the opponent attacks more?
 *
 * The claim B-027 leaned on and did not check. If it holds, the defensive-contribution category
 * points a defender's earnings PARTLY THE SAME WAY as the opposing attacker's — more pressure, more
 * clearances, blocks and interceptions — and B-011's premise is weaker than when it was written,
 * because a defender is no longer paid mostly for the outcome the attacker is trying to prevent.
 *
 * Pressure is measured as goals conceded by the defender's own team in that fixture, which is the
 * only opponent-attacking signal the archive carries for every row. Buckets rather than a single
 * correlation, because the relationship has no reason to be linear and a correlation coefficient
 * would hide a hump.
 *
 * The actions counted are `defensive_contribution` — the qualifying count, clearances/blocks/
 * interceptions plus tackles for a defender — against `DEFCON_THRESHOLD`. Counting the CBIT column
 * alone would understate every row by its tackles and put the threshold in the wrong place.
 */
export interface PressureBucket {
  conceded: number;
  n: number;
  /** mean count of QUALIFYING defensive actions — for a defender, clearances/blocks/interceptions
   * plus tackles, which is what `defensive_contribution` counts */
  meanActions: number;
  /** P(hit the defensive-contribution threshold) among these rows */
  defconRate: number;
  meanPoints: number;
  cleanSheetRate: number;
}

export function defconUnderPressure(
  rows: ArchiveRow[],
  season: string,
): PressureBucket[] {
  const here = rows.filter(
    (r) =>
      r.season === season &&
      r.position === 'DEF' &&
      r.minutes >= 60 &&
      r.defensiveContribution !== null,
  );
  const buckets = new Map<number, ArchiveRow[]>();
  for (const r of here) {
    // 3+ conceded is one bucket: beyond that the sample thins out and the buckets stop being
    // comparable, which is worse than reporting a wider one.
    const key = Math.min(r.goalsConceded, 3);
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([conceded, list]) => ({
      conceded,
      n: list.length,
      meanActions:
        list.reduce((s, r) => s + (r.defensiveContribution ?? 0), 0) /
        list.length,
      defconRate: list.filter(reachedDefconThreshold).length / list.length,
      meanPoints: list.reduce((s, r) => s + r.totalPoints, 0) / list.length,
      cleanSheetRate:
        list.filter((r) => r.cleanSheets > 0).length / list.length,
    }));
}

/**
 * The shape the live squad actually has: one attacker against TWO of the opposing defence.
 *
 * Reported separately because it is not twice the pair. `Var(A + D₁ + D₂)` carries the covariance
 * between the two defenders as well — they share a clean sheet, so they are strongly positively
 * correlated with each other — and that term is larger than either collision term. A rule that prices
 * the two collisions and ignores the defenders' correlation with each other is pricing the smaller
 * half of what it claims to be about.
 */
export interface TripleStats {
  n: number;
  meanTotal: number;
  jointVariance: number;
  independentVariance: number;
  /** cov(attacker, each defender), summed over the two collisions */
  collisionCovariance: number;
  /** cov(defender, defender) — the term the collision rule does not price */
  defencePairCovariance: number;
  /** Var(D₁ + D₂): what the two defenders alone carry */
  defencePairVariance: number;
  /** Var(A): what the attacker carries on his own */
  attackerVariance: number;
  /**
   * What adding THIS attacker costs in variance, against adding an uncorrelated one of the same size.
   *
   * `Var(D + A) − Var(D) = Var(A) + 2·Cov(A, D)`. An uncorrelated attacker adds `Var(A)`. So the
   * difference is `2·Cov(A, D)`, and it is negative exactly when the opposing attacker is the
   * SAFER addition — which is the opposite of what B-011 assumes.
   */
  marginalVarianceVersusUncorrelated: number;
}

export function tripleStats(rows: ArchiveRow[]): TripleStats {
  const totals: number[] = [];
  const parts: [number, number, number][] = [];
  for (const group of byFixture(rows).values()) {
    const played = group.filter((r) => r.minutes > 0);
    const teams = [...new Set(played.map((r) => r.teamCode))];
    if (teams.length !== 2) continue;
    for (const team of teams) {
      const attackers = played.filter(
        (r) => r.teamCode === team && ATTACKING.includes(r.position),
      );
      const defenders = played.filter(
        (r) => r.teamCode !== team && r.position === 'DEF',
      );
      if (attackers.length === 0 || defenders.length < 2) continue;
      // One triple per fixture-side, taking the two defenders with the most minutes: enumerating
      // every combination would weight fixtures by how many defenders happened to feature.
      const [d1, d2] = [...defenders].sort((a, b) => b.minutes - a.minutes);
      for (const a of attackers) {
        parts.push([a.totalPoints, d1.totalPoints, d2.totalPoints]);
        totals.push(a.totalPoints + d1.totalPoints + d2.totalPoints);
      }
    }
  }
  const a = summarise(parts.map((p) => p[0]));
  const d1 = summarise(parts.map((p) => p[1]));
  const d2 = summarise(parts.map((p) => p[2]));
  const cov = (i: number, j: number, mi: number, mj: number) =>
    parts.length < 2
      ? 0
      : parts.reduce((s, p) => s + (p[i] - mi) * (p[j] - mj), 0) /
        (parts.length - 1);

  const collision =
    cov(0, 1, a.mean, d1.mean) + cov(0, 2, a.mean, d2.mean);
  const defence = cov(1, 2, d1.mean, d2.mean);
  const joint = summarise(totals);
  const defencePair = summarise(parts.map((p) => p[1] + p[2]));
  return {
    n: parts.length,
    meanTotal: joint.mean,
    jointVariance: joint.variance,
    independentVariance: a.variance + d1.variance + d2.variance,
    collisionCovariance: collision,
    defencePairCovariance: defence,
    defencePairVariance: defencePair.variance,
    attackerVariance: a.variance,
    marginalVarianceVersusUncorrelated: 2 * collision,
  };
}
