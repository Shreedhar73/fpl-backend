import type { Rules } from '../optimizer/rules';
import type { PositionCode } from '../fpl-sync/mappers';
import { POSITIONS } from '../optimizer/rules';

/**
 * Is this set of 15 a legal FPL squad? Pure, and it reports **every** broken rule rather than the
 * first, because a builder that fixes one violation only to be told about the next is the worst
 * kind of form.
 *
 * Every limit comes from `Rules`, which reads `scoring_config` — never a constant. FPL changed
 * goalkeeper scoring and added a whole scoring category within two seasons; a hardcoded 2/5/5/3 is
 * a silent wrong-answer machine the day the game changes (fpl-domain-rules, "the one rule about
 * rules").
 */

export interface LegalityPlayer {
  playerId: string;
  webName: string;
  position: PositionCode;
  teamId: string;
  teamShortName: string;
  nowCost: number;
}

export const ViolationCode = {
  SQUAD_SIZE: 'SQUAD_SIZE',
  POSITION_QUOTA: 'POSITION_QUOTA',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  CLUB_LIMIT: 'CLUB_LIMIT',
  DUPLICATE_PLAYER: 'DUPLICATE_PLAYER',
  NO_LEGAL_FORMATION: 'NO_LEGAL_FORMATION',
} as const;

export type ViolationCode = (typeof ViolationCode)[keyof typeof ViolationCode];

export interface Violation {
  code: ViolationCode;
  message: string;
}

export interface LegalityResult {
  legal: boolean;
  violations: Violation[];
  totalCost: number;
  /** budget − totalCost. Negative when over budget, which is itself a violation. */
  bank: number;
  positionCounts: Record<PositionCode, number>;
  clubCounts: Record<string, number>;
}

export function checkLegality(
  players: LegalityPlayer[],
  rules: Rules,
): LegalityResult {
  const violations: Violation[] = [];

  const totalCost = players.reduce((sum, p) => sum + p.nowCost, 0);
  const budget = rules.budget();
  const bank = budget - totalCost;

  const positionCounts = Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      players.filter((p) => p.position === pos).length,
    ]),
  ) as Record<PositionCode, number>;

  const clubCounts: Record<string, number> = {};
  for (const p of players) {
    clubCounts[p.teamShortName] = (clubCounts[p.teamShortName] ?? 0) + 1;
  }

  if (players.length !== rules.squadSize()) {
    violations.push({
      code: ViolationCode.SQUAD_SIZE,
      message: `A squad is ${rules.squadSize()} players; this one has ${players.length}.`,
    });
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const p of players) {
    if (seen.has(p.playerId)) duplicates.add(p.webName);
    seen.add(p.playerId);
  }
  if (duplicates.size > 0) {
    violations.push({
      code: ViolationCode.DUPLICATE_PLAYER,
      message: `You cannot pick the same player twice: ${[...duplicates].join(', ')}.`,
    });
  }

  for (const pos of POSITIONS) {
    const want = rules.squadSelect(pos);
    const have = positionCounts[pos];
    if (have !== want) {
      violations.push({
        code: ViolationCode.POSITION_QUOTA,
        message: `You need exactly ${want} ${pos}; you have ${have}.`,
      });
    }
  }

  if (totalCost > budget) {
    violations.push({
      code: ViolationCode.BUDGET_EXCEEDED,
      message: `That squad costs £${(totalCost / 10).toFixed(1)}m, which is £${(
        (totalCost - budget) /
        10
      ).toFixed(1)}m over the £${(budget / 10).toFixed(1)}m budget.`,
    });
  }

  const limit = rules.clubLimit();
  const overLimit = Object.entries(clubCounts).filter(([, n]) => n > limit);
  for (const [club, n] of overLimit) {
    violations.push({
      code: ViolationCode.CLUB_LIMIT,
      message: `At most ${limit} players from one club; you have ${n} from ${club}.`,
    });
  }

  // Only worth asking once the quotas hold — with the wrong counts the answer is always "no" and
  // it would just repeat what the quota violations already said.
  if (
    violations.every((v) => v.code !== ViolationCode.POSITION_QUOTA) &&
    !hasLegalFormation(positionCounts, rules)
  ) {
    violations.push({
      code: ViolationCode.NO_LEGAL_FORMATION,
      message: 'No legal starting XI can be made from those 15.',
    });
  }

  return {
    legal: violations.length === 0,
    violations,
    totalCost,
    bank,
    positionCounts,
    clubCounts,
  };
}

/**
 * Can an XI be picked from these position counts satisfying every min/max and summing to 11?
 * Enumerated rather than reasoned about: the legal formations are a small set, and enumerating
 * them is how the optimizer picks the XI too.
 */
export function hasLegalFormation(
  counts: Record<PositionCode, number>,
  rules: Rules,
): boolean {
  const xiSize = rules.xiSize();
  const ranges = POSITIONS.map((pos) => ({
    pos,
    min: rules.minPlay(pos),
    max: Math.min(rules.maxPlay(pos), counts[pos]),
  }));

  const walk = (i: number, remaining: number): boolean => {
    if (i === ranges.length) return remaining === 0;
    const { min, max } = ranges[i];
    for (let n = min; n <= max; n++) {
      if (n > remaining) break;
      if (walk(i + 1, remaining - n)) return true;
    }
    return false;
  };

  return walk(0, xiSize);
}
