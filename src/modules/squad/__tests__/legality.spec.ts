import { Rules } from '../../optimizer/rules';
import {
  checkLegality,
  hasLegalFormation,
  ViolationCode,
  type LegalityPlayer,
} from '../legality';

/**
 * Squad legality, one violated constraint at a time — each squad breaks exactly one rule and must
 * be rejected for that reason and no other (fpl-testing-contract).
 *
 * Every limit is read from a `Rules` built from config here, never from a constant, and one test
 * changes the config to prove the checker follows it rather than a hardcoded 2/5/5/3.
 */

const RULES_JSON = {
  squad_squadsize: 15,
  squad_squadplay: 11,
  squad_total_spend: 1000,
  squad_team_limit: 3,
};
const POSITIONS_JSON = [
  { position: 'GKP', squadSelect: 2, squadMinPlay: 1, squadMaxPlay: 1 },
  { position: 'DEF', squadSelect: 5, squadMinPlay: 3, squadMaxPlay: 5 },
  { position: 'MID', squadSelect: 5, squadMinPlay: 2, squadMaxPlay: 5 },
  { position: 'FWD', squadSelect: 3, squadMinPlay: 1, squadMaxPlay: 3 },
];
const rules = new Rules(RULES_JSON, POSITIONS_JSON);

const SHAPE: LegalityPlayer['position'][] = [
  'GKP',
  'GKP',
  'DEF',
  'DEF',
  'DEF',
  'DEF',
  'DEF',
  'MID',
  'MID',
  'MID',
  'MID',
  'MID',
  'FWD',
  'FWD',
  'FWD',
];

/** A legal 15: 2/5/5/3, £66.0m total, at most 2 from any one club. */
function legalSquad(): LegalityPlayer[] {
  return SHAPE.map((position, i) => ({
    playerId: `p${i}`,
    webName: `Player ${i}`,
    position,
    teamId: `team${i % 8}`,
    teamShortName: `T${i % 8}`,
    nowCost: 44,
  }));
}

const codes = (squad: LegalityPlayer[], r = rules) =>
  checkLegality(squad, r).violations.map((v) => v.code);

describe('checkLegality — a legal squad', () => {
  it('passes, with no violations and the counts filled in', () => {
    const result = checkLegality(legalSquad(), rules);
    expect(result.legal).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.totalCost).toBe(15 * 44);
    expect(result.bank).toBe(1000 - 15 * 44);
    expect(result.positionCounts).toEqual({ GKP: 2, DEF: 5, MID: 5, FWD: 3 });
    expect(Math.max(...Object.values(result.clubCounts))).toBeLessThanOrEqual(
      3,
    );
  });
});

describe('checkLegality — one broken rule at a time', () => {
  it('rejects a short squad for its size', () => {
    expect(codes(legalSquad().slice(0, 14))).toContain(
      ViolationCode.SQUAD_SIZE,
    );
  });

  it('rejects the wrong position quota, naming the position', () => {
    const squad = legalSquad();
    squad[13].position = 'MID'; // 6 MID, 2 FWD
    const result = checkLegality(squad, rules);
    expect(result.legal).toBe(false);
    const quota = result.violations.filter(
      (v) => v.code === ViolationCode.POSITION_QUOTA,
    );
    expect(quota).toHaveLength(2);
    expect(quota.map((v) => v.message).join(' ')).toMatch(/MID/);
    expect(quota.map((v) => v.message).join(' ')).toMatch(/FWD/);
  });

  it('rejects going over budget, and reports a negative bank', () => {
    const squad = legalSquad().map((p) => ({ ...p, nowCost: 100 }));
    const result = checkLegality(squad, rules);
    expect(result.violations.map((v) => v.code)).toContain(
      ViolationCode.BUDGET_EXCEEDED,
    );
    expect(result.bank).toBe(1000 - 1500);
  });

  it('allows spending exactly the budget — the limit is not off by one', () => {
    // 15 players at £6.6m is £99.0m; put the last £10.0m on one of them to hit £100.0m exactly.
    const squad = legalSquad().map((p) => ({ ...p, nowCost: 66 }));
    squad[0].nowCost = 66 + 10;
    const result = checkLegality(squad, rules);
    expect(result.totalCost).toBe(1000);
    expect(result.bank).toBe(0);
    expect(result.violations.map((v) => v.code)).not.toContain(
      ViolationCode.BUDGET_EXCEEDED,
    );
  });

  it('rejects a fourth player from one club, naming the club', () => {
    const squad = legalSquad();
    for (let i = 0; i < 4; i++) squad[i].teamShortName = 'ARS';
    const result = checkLegality(squad, rules);
    const club = result.violations.find(
      (v) => v.code === ViolationCode.CLUB_LIMIT,
    );
    expect(club).toBeDefined();
    expect(club!.message).toMatch(/ARS/);
  });

  it('allows exactly three from one club', () => {
    const squad = legalSquad();
    for (let i = 0; i < 3; i++) squad[i].teamShortName = 'ARS';
    expect(codes(squad)).not.toContain(ViolationCode.CLUB_LIMIT);
  });

  it('rejects the same player picked twice', () => {
    const squad = legalSquad();
    squad[5] = { ...squad[4] };
    expect(codes(squad)).toContain(ViolationCode.DUPLICATE_PLAYER);
  });

  it('reports every broken rule at once, not just the first', () => {
    const squad = legalSquad()
      .slice(0, 14)
      .map((p) => ({ ...p, nowCost: 200, teamShortName: 'ARS' }));
    const found = new Set(codes(squad));
    expect(found.has(ViolationCode.SQUAD_SIZE)).toBe(true);
    expect(found.has(ViolationCode.BUDGET_EXCEEDED)).toBe(true);
    expect(found.has(ViolationCode.CLUB_LIMIT)).toBe(true);
    expect(found.has(ViolationCode.POSITION_QUOTA)).toBe(true);
  });
});

describe('checkLegality — limits come from config, not constants', () => {
  it('follows a changed budget (break-on-purpose: a hardcoded 1000 would not move)', () => {
    const poorer = new Rules(
      { ...RULES_JSON, squad_total_spend: 600 },
      POSITIONS_JSON,
    );
    // £66.0m is legal under £100.0m and illegal under £60.0m. Same squad, different verdict.
    const squad = legalSquad();
    expect(codes(squad)).not.toContain(ViolationCode.BUDGET_EXCEEDED);
    expect(codes(squad, poorer)).toContain(ViolationCode.BUDGET_EXCEEDED);
  });

  it('follows a changed club limit', () => {
    const stricter = new Rules(
      { ...RULES_JSON, squad_team_limit: 1 },
      POSITIONS_JSON,
    );
    expect(codes(legalSquad(), stricter)).toContain(ViolationCode.CLUB_LIMIT);
  });

  it('follows a changed position quota', () => {
    const fourDefenders = new Rules(RULES_JSON, [
      ...POSITIONS_JSON.filter((p) => p.position !== 'DEF'),
      { position: 'DEF', squadSelect: 4, squadMinPlay: 3, squadMaxPlay: 5 },
    ]);
    expect(codes(legalSquad(), fourDefenders)).toContain(
      ViolationCode.POSITION_QUOTA,
    );
  });
});

describe('hasLegalFormation', () => {
  it('accepts the standard 2/5/5/3 squad', () => {
    expect(hasLegalFormation({ GKP: 2, DEF: 5, MID: 5, FWD: 3 }, rules)).toBe(
      true,
    );
  });

  it('rejects a squad that cannot field the minimum defenders', () => {
    // 2 DEF cannot satisfy a minimum of 3 in the XI, whatever else is picked.
    expect(hasLegalFormation({ GKP: 2, DEF: 2, MID: 8, FWD: 3 }, rules)).toBe(
      false,
    );
  });

  it('rejects a squad with no goalkeeper to play', () => {
    expect(hasLegalFormation({ GKP: 0, DEF: 7, MID: 5, FWD: 3 }, rules)).toBe(
      false,
    );
  });

  it('adds NO_LEGAL_FORMATION only when the quotas themselves are satisfiable', () => {
    // With the quotas already broken, the formation complaint would only repeat them.
    const squad = legalSquad();
    squad[2].position = 'MID';
    expect(codes(squad)).not.toContain(ViolationCode.NO_LEGAL_FORMATION);
  });
});
