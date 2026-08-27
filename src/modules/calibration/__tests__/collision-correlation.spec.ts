import { PositionCode } from '../../fpl-sync/mappers';
import {
  ArchiveRow,
  collisionPairs,
  conditionalOnReturn,
  defconUnderPressure,
  defensiveComposition,
  pairStats,
  summarise,
  tripleStats,
} from '../collision-correlation';

/**
 * B-028 — the statistics behind the collision measurement.
 *
 * **Why this file is constructed data and not a fixture of real rows.** A correlation routine returns
 * a plausible-looking number for almost any input, including a wrong one: sign errors, an off-by-one
 * in the denominator and a mis-paired join all produce something between −1 and 1 that reads like a
 * measurement. So every test here feeds data whose answer is known in advance by hand, and several
 * assert the SIGN of a relationship that a mis-join would invert.
 */

const row = (over: Partial<ArchiveRow> = {}): ArchiveRow => ({
  season: '2025-26',
  round: 1,
  fixture: 1,
  playerCode: 1,
  webName: 'P',
  position: 'MID' as PositionCode,
  teamCode: 1,
  opponentTeamCode: 2,
  minutes: 90,
  totalPoints: 2,
  goalsScored: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 0,
  bonus: 0,
  defensiveContribution: null,
  clearancesBlocksInterceptions: null,
  tackles: null,
  recoveries: null,
  ...over,
});

describe('summarise and pairStats reproduce hand arithmetic', () => {
  it('computes mean and sample variance', () => {
    const s = summarise([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBeCloseTo(5, 6);
    // Sample variance (n − 1): 32 / 7.
    expect(s.variance).toBeCloseTo(32 / 7, 6);
  });

  it('returns exactly -1 for a perfectly opposed pair, and +1 for a perfectly aligned one', () => {
    const opposed: [number, number][] = [
      [1, 4],
      [2, 3],
      [3, 2],
      [4, 1],
    ];
    expect(pairStats(opposed).correlation).toBeCloseTo(-1, 6);
    const aligned: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ];
    expect(pairStats(aligned).correlation).toBeCloseTo(1, 6);
  });

  it('shows a perfect hedge collapsing the joint variance to zero', () => {
    // The whole conceptual point of the exercise, in four rows: two holdings that move exactly
    // opposite have a CONSTANT sum. If this ever reported a joint variance above the independent
    // one, the sign of the covariance term would be wrong.
    const opposed: [number, number][] = [
      [1, 4],
      [2, 3],
      [3, 2],
      [4, 1],
    ];
    const s = pairStats(opposed);
    expect(s.jointVariance).toBeCloseTo(0, 6);
    expect(s.independentVariance).toBeGreaterThan(0);
  });

  it('reports a correlation of 0 rather than NaN when one side never varies', () => {
    // A defender who scores 2 every week is a real thing in this data, and a 0/0 here would
    // propagate NaN through every pooled number downstream.
    const flat: [number, number][] = [
      [1, 2],
      [5, 2],
      [9, 2],
    ];
    expect(pairStats(flat).correlation).toBe(0);
  });
});

describe('collisionPairs joins the two sides of one fixture', () => {
  const fixture: ArchiveRow[] = [
    row({ playerCode: 1, position: 'FWD', teamCode: 1, opponentTeamCode: 2 }),
    row({ playerCode: 2, position: 'MID', teamCode: 1, opponentTeamCode: 2 }),
    row({ playerCode: 3, position: 'DEF', teamCode: 2, opponentTeamCode: 1 }),
    row({ playerCode: 4, position: 'GKP', teamCode: 2, opponentTeamCode: 1 }),
    // A defender on the SAME side as the attackers. Pairing him would be measuring a team with
    // itself, which correlates positively and would swamp the result.
    row({ playerCode: 5, position: 'DEF', teamCode: 1, opponentTeamCode: 2 }),
  ];

  it('pairs each attacker with each OPPOSING defensive player, in both directions', () => {
    const pairs = collisionPairs(fixture);
    // 2 attackers of team 1 against 2 defensive players of team 2, plus team 2's own attackers
    // against team 1's defence — of which there are none here.
    expect(pairs).toHaveLength(4);
    for (const p of pairs) {
      expect(p.attacker.teamCode).not.toBe(p.defender.teamCode);
    }
    expect(
      pairs.some((p) => p.defender.playerCode === 5),
    ).toBe(false);
  });

  it('never pairs across fixtures', () => {
    const other = fixture.map((r) => ({ ...r, fixture: 2, playerCode: r.playerCode + 10 }));
    const pairs = collisionPairs([...fixture, ...other]);
    expect(pairs).toHaveLength(8);
    for (const p of pairs) {
      expect(p.attacker.fixture).toBe(p.defender.fixture);
    }
  });

  it('drops players who did not feature', () => {
    const withAbsentee = fixture.map((r) =>
      r.playerCode === 3 ? { ...r, minutes: 0 } : r,
    );
    // The absent defender takes his two pairs with him.
    expect(collisionPairs(withAbsentee)).toHaveLength(2);
  });
});

describe('conditionalOnReturn splits on what the attacker did', () => {
  it('separates the defender scores by whether the attacker returned', () => {
    const rows: ArchiveRow[] = [
      row({ playerCode: 1, position: 'FWD', teamCode: 1, goalsScored: 1 }),
      row({
        playerCode: 2,
        position: 'DEF',
        teamCode: 2,
        opponentTeamCode: 1,
        totalPoints: 1,
        goalsConceded: 1,
      }),
      row({ playerCode: 3, fixture: 2, position: 'FWD', teamCode: 1 }),
      row({
        playerCode: 4,
        fixture: 2,
        position: 'DEF',
        teamCode: 2,
        opponentTeamCode: 1,
        totalPoints: 6,
        cleanSheets: 1,
      }),
    ];
    const split = conditionalOnReturn(collisionPairs(rows));
    expect(split.whenAttackerReturned.mean).toBeCloseTo(1, 6);
    expect(split.whenAttackerBlanked.mean).toBeCloseTo(6, 6);
    expect(split.difference).toBeCloseTo(-5, 6);
  });

  it('counts an assist as a return, not only a goal', () => {
    const rows: ArchiveRow[] = [
      row({ playerCode: 1, position: 'MID', teamCode: 1, assists: 1 }),
      row({
        playerCode: 2,
        position: 'DEF',
        teamCode: 2,
        opponentTeamCode: 1,
        totalPoints: 1,
      }),
    ];
    const split = conditionalOnReturn(collisionPairs(rows));
    expect(split.whenAttackerReturned.n).toBe(1);
    expect(split.whenAttackerBlanked.n).toBe(0);
  });
});

describe('defensiveComposition attributes a defender’s points by event', () => {
  it('reconciles: the columns plus the remainder equal the mean total', () => {
    const rows: ArchiveRow[] = [
      row({
        position: 'DEF',
        minutes: 90,
        cleanSheets: 1,
        // 12 qualifying actions clears the defender threshold of 10; a count of 1 would not, and
        // reading the column as a flag is exactly the bug this number guards against.
        defensiveContribution: 12,
        totalPoints: 8,
        bonus: 0,
      }),
      row({
        playerCode: 2,
        position: 'DEF',
        minutes: 90,
        goalsConceded: 2,
        totalPoints: 1,
      }),
    ];
    const c = defensiveComposition(rows, '2025-26');
    expect(c.n).toBe(2);
    // (2 + 4 + 2) and (2 − 1): mean 4.5.
    expect(c.meanTotal).toBeCloseTo(4.5, 6);
    expect(c.appearance).toBeCloseTo(2, 6);
    expect(c.cleanSheet).toBeCloseTo(2, 6);
    expect(c.defensiveContribution).toBeCloseTo(1, 6);
    expect(
      c.appearance +
        c.cleanSheet +
        c.defensiveContribution +
        c.goals +
        c.assists +
        c.bonus +
        c.remainder,
    ).toBeCloseTo(c.meanTotal, 6);
  });

  it('does NOT treat the action COUNT as a flag — one tackle is not two points', () => {
    // The bug this guards: `defensive_contribution` is a count, and read as a flag it pays 2 points
    // to 3,000 of 3,026 defender-matches in 2025-26 instead of the 816 that qualified. That inflates
    // the defcon share of a defender's points to ~50% and drives the reconciliation remainder to
    // -1.6, which is the tell.
    const rows: ArchiveRow[] = [
      row({ position: 'DEF', minutes: 90, defensiveContribution: 1, totalPoints: 2 }),
      row({ playerCode: 2, position: 'DEF', minutes: 90, defensiveContribution: 9, totalPoints: 2 }),
      row({ playerCode: 3, position: 'DEF', minutes: 90, defensiveContribution: 10, totalPoints: 4 }),
    ];
    const c = defensiveComposition(rows, '2025-26');
    // Exactly one of the three qualified: 2 points over three rows.
    expect(c.defensiveContribution).toBeCloseTo(2 / 3, 6);
  });

  it('reports a zero defcon share for a season where the category did not exist', () => {
    const rows: ArchiveRow[] = [
      row({
        season: '2023-24',
        position: 'DEF',
        minutes: 90,
        cleanSheets: 1,
        totalPoints: 6,
        defensiveContribution: null,
      }),
    ];
    const c = defensiveComposition(rows, '2023-24');
    expect(c.defensiveContribution).toBe(0);
    expect(c.defconShare).toBe(0);
    expect(c.cleanSheetShare).toBeCloseTo(4 / 6, 6);
  });
});

describe('defconUnderPressure buckets by what the defence conceded', () => {
  it('shows defensive work rising with pressure when the data says so', () => {
    // Constructed so the ANSWER IS KNOWN: clean sheets do little work, conceding does more. A join
    // that read the wrong side of the fixture would invert this.
    const rows: ArchiveRow[] = [
      // Below the defender threshold of 10 qualifying actions...
      ...[4, 5, 6].map((actions, i) =>
        row({
          playerCode: 100 + i,
          position: 'DEF',
          minutes: 90,
          goalsConceded: 0,
          cleanSheets: 1,
          defensiveContribution: actions,
        }),
      ),
      // ...and above it.
      ...[11, 12, 13].map((actions, i) =>
        row({
          playerCode: 200 + i,
          position: 'DEF',
          minutes: 90,
          goalsConceded: 2,
          defensiveContribution: actions,
        }),
      ),
    ];
    const buckets = defconUnderPressure(rows, '2025-26');
    expect(buckets.map((b) => b.conceded)).toEqual([0, 2]);
    expect(buckets[0].meanActions).toBeCloseTo(5, 6);
    expect(buckets[1].meanActions).toBeCloseTo(12, 6);
    expect(buckets[0].defconRate).toBe(0);
    expect(buckets[1].defconRate).toBe(1);
  });

  it('skips seasons with no defensive-contribution columns rather than reporting zeros', () => {
    const rows: ArchiveRow[] = [
      row({
        season: '2023-24',
        position: 'DEF',
        minutes: 90,
        defensiveContribution: null,
      }),
    ];
    expect(defconUnderPressure(rows, '2023-24')).toEqual([]);
  });
});

describe('tripleStats prices the shape the live squad has', () => {
  it('separates the two collision covariances from the defenders’ covariance with each other', () => {
    // Two fixtures. The attacker and the defenders move opposite; the two defenders move together,
    // because they share a clean sheet. Both facts must show up with the right sign.
    const build = (
      fixture: number,
      attackerPts: number,
      defPts: number,
    ): ArchiveRow[] => [
      row({ fixture, playerCode: fixture * 10 + 1, position: 'FWD', teamCode: 1, totalPoints: attackerPts }),
      row({ fixture, playerCode: fixture * 10 + 2, position: 'DEF', teamCode: 2, opponentTeamCode: 1, totalPoints: defPts }),
      row({ fixture, playerCode: fixture * 10 + 3, position: 'DEF', teamCode: 2, opponentTeamCode: 1, totalPoints: defPts }),
    ];
    const rows = [...build(1, 10, 1), ...build(2, 2, 6)];
    const t = tripleStats(rows);
    expect(t.n).toBe(2);
    expect(t.collisionCovariance).toBeLessThan(0);
    expect(t.defencePairCovariance).toBeGreaterThan(0);
  });

  it('ignores a fixture with only one defender — a triple needs three players', () => {
    const rows: ArchiveRow[] = [
      row({ position: 'FWD', teamCode: 1 }),
      row({ playerCode: 2, position: 'DEF', teamCode: 2, opponentTeamCode: 1 }),
    ];
    expect(tripleStats(rows).n).toBe(0);
  });
});
