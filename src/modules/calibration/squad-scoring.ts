import { PositionCode } from '../fpl-sync/mappers';
import { Rules } from '../optimizer/rules';

/**
 * Scoring a squad the way FPL scores one: an XI, an ordered bench, a captain, a vice, and the
 * automatic substitutions that happen after the last whistle (B-012 Phase 2, reused unchanged by the
 * season simulator in Phase 3).
 *
 * **Pure, and written once.** Every rule below is a rule a simulator could get subtly wrong in the
 * direction that flatters the model — subbing a player who scored badly, doubling a vice who was not
 * entitled to the armband, letting a substitution break the formation. Implementing them twice, once
 * here and once in the simulator, is how the two versions drift and only one of them is tested.
 *
 * The rules, from `fpl-domain-rules` and the product charter §1.3:
 *
 *  - A starter who registers **0 minutes** is replaced. A starter who plays and scores badly is NOT.
 *  - Bench players are tried **in order**, and only if the formation stays legal after the swap.
 *  - The bench goalkeeper occupies slot 1 and only ever replaces the starting goalkeeper.
 *  - The captain scores double. If the captain played 0 minutes the **vice** doubles instead.
 *    **If both played 0 minutes, nobody is doubled.**
 */

export interface SquadMember {
  playerCode: number;
  webName: string;
  position: PositionCode;
  /** what they actually scored this round; a player with no fixture scores 0 */
  actual: number;
  /** realised minutes — the ONLY thing that triggers a substitution */
  minutes: number;
}

export interface Lineup {
  /** exactly `rules.xiSize()` members */
  starters: SquadMember[];
  /** ordered; the goalkeeper, if any, is tried only for the goalkeeper slot */
  bench: SquadMember[];
  captain: number;
  vice: number;
}

export interface SquadScore {
  points: number;
  /** who ended up on the field after substitutions */
  fielded: SquadMember[];
  substitutions: { off: SquadMember; on: SquadMember }[];
  /** whose score was doubled, or null when both the captain and vice blanked */
  doubled: number | null;
}

function legalFormation(xi: SquadMember[], rules: Rules): boolean {
  if (xi.length !== rules.xiSize()) return false;
  const count = (p: PositionCode) => xi.filter((m) => m.position === p).length;
  for (const p of ['GKP', 'DEF', 'MID', 'FWD'] as PositionCode[]) {
    const n = count(p);
    if (n < rules.minPlay(p) || n > rules.maxPlay(p)) return false;
  }
  return true;
}

export function scoreLineup(lineup: Lineup, rules: Rules): SquadScore {
  const fielded = [...lineup.starters];
  const substitutions: { off: SquadMember; on: SquadMember }[] = [];
  const used = new Set<number>();

  // Only 0 minutes triggers a substitution. A 1-point cameo does not, however badly it went — that
  // is the rule most often got wrong, and getting it wrong invents points a real squad never had.
  const blanked = fielded.filter((m) => m.minutes === 0);

  for (const off of blanked) {
    for (const on of lineup.bench) {
      if (used.has(on.playerCode)) continue;
      // A bench player who did not play cannot come on either.
      if (on.minutes === 0) continue;
      // The bench goalkeeper replaces only the starting goalkeeper, and only a goalkeeper replaces
      // one — enforced by the formation check below, but stated because it is a rule, not a
      // consequence.
      const candidate = fielded.map((m) =>
        m.playerCode === off.playerCode ? on : m,
      );
      if (!legalFormation(candidate, rules)) continue;
      fielded.splice(
        fielded.findIndex((m) => m.playerCode === off.playerCode),
        1,
        on,
      );
      used.add(on.playerCode);
      substitutions.push({ off, on });
      break;
    }
  }

  const played = (code: number) =>
    lineup.starters.find((m) => m.playerCode === code)?.minutes ?? 0;

  // The armband: the captain if they featured, otherwise the vice, otherwise nobody. "Otherwise
  // nobody" is a real branch — a squad whose captain and vice both blank scores no double at all.
  let doubled: number | null = null;
  if (played(lineup.captain) > 0) doubled = lineup.captain;
  else if (played(lineup.vice) > 0) doubled = lineup.vice;

  let points = fielded.reduce((s, m) => s + m.actual, 0);
  if (doubled !== null) {
    const extra = fielded.find((m) => m.playerCode === doubled);
    // The doubled player must be on the field to be doubled. A captain who blanked was substituted
    // out, and the branch above already handed the armband on.
    if (extra) points += extra.actual;
  }

  return { points, fielded, substitutions, doubled };
}

/**
 * Bench order: `pPlay × EP` for the model, plain predicted points for a baseline.
 *
 * A bench player only scores if someone ahead of them blanks, so an 8-point projection from a player
 * with a 40% chance of appearing is worth less on a bench than a 3-point projection from a nailed
 * one. Baselines get the plain ordering because `form` and last season's points-per-90 are scalars
 * with no notion of appearance probability — handing them ours would be lending a baseline a piece of
 * the model and then reporting that we beat it.
 */
export function benchOrder<T extends { predictedPoints: number; pPlay: number | null }>(
  bench: T[],
): T[] {
  return [...bench].sort(
    (a, b) =>
      b.predictedPoints * (b.pPlay ?? 1) - a.predictedPoints * (a.pPlay ?? 1),
  );
}
