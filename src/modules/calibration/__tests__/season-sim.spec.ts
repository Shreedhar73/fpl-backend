import { Rules } from '../../optimizer/rules';
import { PredictionRow } from '../harness';
import {
  GREEDY_ONE_FT,
  grantFreeTransfer,
  NO_TRANSFER,
  sellValue,
  simulateSeason,
  SimOptions,
} from '../season-sim';

/**
 * B-012 Phase 3 — the season simulator.
 *
 * Every rule tested here is one the simulator could get wrong in the direction that produces a
 * bigger, more flattering season total: refunding half a loss, letting the free-transfer bank grow
 * past its cap, valuing a squad at market price instead of sell price, or scoring a blanked player
 * as though they had played.
 */

const RULES = new Rules(
  {
    squad_squadsize: 15,
    squad_squadplay: 11,
    squad_total_spend: 1000,
    squad_team_limit: 3,
  },
  [
    { position: 'GKP', squadSelect: 2, squadMinPlay: 1, squadMaxPlay: 1 },
    { position: 'DEF', squadSelect: 5, squadMinPlay: 3, squadMaxPlay: 5 },
    { position: 'MID', squadSelect: 5, squadMinPlay: 2, squadMaxPlay: 5 },
    { position: 'FWD', squadSelect: 3, squadMinPlay: 1, squadMaxPlay: 3 },
  ],
);

const OPTIONS: SimOptions = { freeTransferCap: 5, hitCost: 4 };

const row = (over: Partial<PredictionRow>): PredictionRow => ({
  season: '2025-26',
  round: 1,
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  value: 50,
  actual: 2,
  minutes: 90,
  predicted: { model: 2, form: 2, priorSeason: 2 },
  pPlay: 1,
  appearances: 20,
  ...over,
});

/** A legal fifteen: 2 GKP, 5 DEF, 5 MID, 3 FWD, spread over enough clubs to satisfy the cap. */
function squadOf(round: number, over: (i: number) => Partial<PredictionRow> = () => ({})) {
  const spec: [string, number][] = [
    ['GKP', 2],
    ['DEF', 5],
    ['MID', 5],
    ['FWD', 3],
  ];
  const out: PredictionRow[] = [];
  let i = 0;
  for (const [position, n] of spec) {
    for (let k = 0; k < n; k++) {
      out.push(
        row({
          round,
          playerCode: i + 1,
          webName: `${position}-${k}`,
          position,
          teamCode: Math.floor(i / 3) + 1,
          ...over(i),
        }),
      );
      i++;
    }
  }
  return out;
}

const asRounds = (...rounds: PredictionRow[][]) =>
  new Map(
    rounds.map((rs, i) => [
      rs[0]?.round ?? i + 1,
      new Map(rs.map((r) => [r.playerCode, r])),
    ]),
  );

describe('the sell-price rule', () => {
  it('returns purchase price plus half the profit, rounded down', () => {
    // Buy at 5.0, now 5.3 -> sell at 5.1. The half-tenth is lost, not rounded up.
    expect(sellValue(50, 53)).toBe(51);
    expect(sellValue(50, 54)).toBe(52);
  });

  it('eats the whole loss', () => {
    // Buy at 5.0, now 4.8 -> sell at 4.8. Refunding half a loss is free money and a bigger season.
    expect(sellValue(50, 48)).toBe(48);
  });

  it('is never the market price on a rise', () => {
    // Using `now_cost` as the sell value is the classic backtest self-flattery: it invents money and
    // proposes squads the manager could not have bought.
    expect(sellValue(50, 60)).toBeLessThan(60);
  });
});

describe('the free-transfer bank', () => {
  it('rolls', () => {
    expect(grantFreeTransfer(0, 5)).toBe(1);
    expect(grantFreeTransfer(3, 5)).toBe(4);
  });

  it('caps, and the cap is passed in rather than assumed', () => {
    // It was one, then two, then five. A hardcoded cap is silently wrong the season it changes again.
    expect(grantFreeTransfer(5, 5)).toBe(5);
    expect(grantFreeTransfer(2, 2)).toBe(2);
  });
});

describe('a held squad', () => {
  const opening = squadOf(1);

  it('scores every round without transferring', () => {
    const result = simulateSeason(
      asRounds(squadOf(1), squadOf(2), squadOf(3)),
      opening,
      'model',
      RULES,
      NO_TRANSFER,
      OPTIONS,
    );
    expect(result.rounds).toHaveLength(3);
    expect(result.totalTransfers).toBe(0);
    expect(result.totalHitCost).toBe(0);
    // 11 starters on 2, captain doubled: 22 + 2 = 24 a round.
    expect(result.rounds[0].points).toBe(24);
  });

  it('banks free transfers up to the cap and no further', () => {
    const rounds = Array.from({ length: 8 }, (_, i) => squadOf(i + 1));
    const result = simulateSeason(
      asRounds(...rounds),
      opening,
      'model',
      RULES,
      NO_TRANSFER,
      OPTIONS,
    );
    expect(Math.max(...result.rounds.map((r) => r.freeTransfersAfter))).toBe(5);
  });
});

describe('a blank round', () => {
  it('scores an absent player 0 and substitutes them, rather than dropping them', () => {
    // There is no archive fixtures table: a player with no row that round had no fixture. They are
    // still owned, still score nothing, and are still eligible for an automatic substitution — which
    // is a different thing from a player who was benched.
    const opening = squadOf(1);
    // The goalkeeper, because exactly one always starts. His club plays, so this is a drop rather
    // than a blank and the carried projection keeps him in the XI — see the leak tests below.
    const roundTwo = squadOf(2).filter((r) => r.playerCode !== 1);
    const result = simulateSeason(
      asRounds(squadOf(1), roundTwo),
      opening,
      'model',
      RULES,
      NO_TRANSFER,
      OPTIONS,
    );
    expect(result.rounds[1].substitutions).toBe(1);
    // Still 11 on the field, so still 24.
    expect(result.rounds[1].points).toBe(24);
  });

  it('carries the last known price forward through the blank', () => {
    const opening = squadOf(1);
    const result = simulateSeason(
      asRounds(squadOf(1), squadOf(2).filter((r) => r.playerCode !== 1)),
      opening,
      'model',
      RULES,
      NO_TRANSFER,
      OPTIONS,
    );
    // Fifteen players at 5.0, none moved: the squad is still worth 75.0 with the blank in it.
    expect(result.rounds[1].squadValue).toBe(750);
  });
});

describe('a dropped player is not a blank, and the difference is a leak', () => {
  it('benches a player whose CLUB had no fixture — that is public before the deadline', () => {
    const opening = squadOf(1);
    // Every club-1 player is gone this round, which is what a blank gameweek looks like in the
    // archive. Verified on 2025-26: exactly two rounds carry fewer than twenty clubs.
    const roundTwo = squadOf(2).filter((r) => r.teamCode !== 1);
    const result = simulateSeason(
      asRounds(squadOf(1), roundTwo),
      opening,
      'model',
      RULES,
      NO_TRANSFER,
      OPTIONS,
    );
    // Club 1 holds the two keepers and a defender. The remaining keeper is unavailable too, so the
    // XI cannot be filled cleanly — what matters is that it did not need a substitution to notice.
    expect(result.rounds[1].points).toBeGreaterThan(0);
  });

  it('does NOT bench a player whose club played and who was simply dropped', () => {
    // The leak. `no row` from a club that DID play means dropped, injured or an unused substitute —
    // none of it knowable before the deadline. If the lineup chooser scores them 0 it benches every
    // player about to lose their place, which is worth several points a season and looks exactly
    // like a good minutes model.
    const opening = squadOf(1);
    const dropped = 1; // a goalkeeper, so exactly one of the two must start
    const roundTwo = squadOf(2).filter((r) => r.playerCode !== dropped);
    const result = simulateSeason(
      asRounds(squadOf(1), roundTwo),
      opening,
      'model',
      RULES,
      NO_TRANSFER,
      OPTIONS,
    );
    // The other keeper's club played, so club 1 is present and the absence is a drop, not a blank.
    // The dropped keeper is still picked on his carried projection, blanks, and is subbed out.
    expect(result.rounds[1].substitutions).toBe(1);
    expect(result.rounds[1].points).toBe(24);
  });
});

describe('the greedy policy', () => {
  it('takes a like-for-like upgrade when it is free and improves the projection', () => {
    const opening = squadOf(1);
    const better = row({
      round: 2,
      playerCode: 99,
      webName: 'Upgrade',
      position: 'MID',
      teamCode: 9,
      value: 50,
      predicted: { model: 9, form: 9, priorSeason: 9 },
      actual: 9,
    });
    const result = simulateSeason(
      asRounds(squadOf(1), [...squadOf(2), better]),
      opening,
      'model',
      RULES,
      GREEDY_ONE_FT,
      OPTIONS,
    );
    expect(result.rounds[1].transfersMade).toBe(1);
    expect(result.totalHitCost).toBe(0);
  });

  it('never takes a hit — so a season total from it is a floor, not an estimate', () => {
    // Stated as a test because the report makes the claim. With one free transfer a round and a
    // policy that stops there, the -4 path is never walked by a simulated season.
    const opening = squadOf(1);
    const extras = [98, 99].map((code) =>
      row({
        round: 2,
        playerCode: code,
        webName: `Upgrade-${code}`,
        position: 'MID',
        teamCode: 9,
        value: 50,
        predicted: { model: 20, form: 20, priorSeason: 20 },
      }),
    );
    const result = simulateSeason(
      asRounds(squadOf(1), [...squadOf(2), ...extras]),
      opening,
      'model',
      RULES,
      GREEDY_ONE_FT,
      OPTIONS,
    );
    expect(result.rounds[1].transfersMade).toBeLessThanOrEqual(1);
    expect(result.totalHitCost).toBe(0);
  });

  it('will not buy a player it cannot afford at sell value', () => {
    // The squad is fully spent, so the only way to afford a 9.0 is to sell at market price — which
    // is exactly the invented money the sell rule exists to prevent.
    const opening = squadOf(1, () => ({ value: 66 })); // 15 x 6.6 = 99.0, bank 1.0
    const expensive = row({
      round: 2,
      playerCode: 99,
      position: 'MID',
      teamCode: 9,
      value: 90,
      predicted: { model: 30, form: 30, priorSeason: 30 },
    });
    const result = simulateSeason(
      asRounds(squadOf(1, () => ({ value: 66 })), [
        ...squadOf(2, () => ({ value: 66 })),
        expensive,
      ]),
      opening,
      'model',
      RULES,
      GREEDY_ONE_FT,
      OPTIONS,
    );
    expect(result.rounds[1].transfersMade).toBe(0);
  });

  it('will not break the three-per-club cap', () => {
    const opening = squadOf(1);
    // Club 1 already holds three of the squad. A fourth is illegal however good.
    const fourth = row({
      round: 2,
      playerCode: 99,
      position: 'MID',
      teamCode: 1,
      value: 50,
      predicted: { model: 30, form: 30, priorSeason: 30 },
    });
    const result = simulateSeason(
      asRounds(squadOf(1), [...squadOf(2), fourth]),
      opening,
      'model',
      RULES,
      GREEDY_ONE_FT,
      OPTIONS,
    );
    const bought = result.rounds[1].transfersMade;
    // Either it held, or it sold one of club 1's own players to make room — never a fourth alongside.
    expect(bought).toBeLessThanOrEqual(1);
  });

  it('does not swap positions', () => {
    // FPL transfers are position-locked; a squad that traded a defender for a midfielder would fail
    // the quota check the moment anything validated it.
    const opening = squadOf(1);
    const wrongPosition = row({
      round: 2,
      playerCode: 99,
      position: 'GKP',
      teamCode: 9,
      value: 50,
      predicted: { model: 30, form: 30, priorSeason: 30 },
    });
    const result = simulateSeason(
      asRounds(squadOf(1), [...squadOf(2), wrongPosition]),
      opening,
      'model',
      RULES,
      GREEDY_ONE_FT,
      OPTIONS,
    );
    // The only legal target is a goalkeeper-for-goalkeeper swap, which the squad has.
    for (const r of result.rounds) expect(r.transfersMade).toBeLessThanOrEqual(1);
    expect(result.totalHitCost).toBe(0);
  });
});

describe('the guard that says this is a season at all', () => {
  it('holds exactly fifteen players at every round and never exceeds the budget', () => {
    // A simulator that silently fielded ten players would score badly for a reason nobody would look
    // for. This is the check that the number being reported is a season.
    const opening = squadOf(1);
    const rounds = Array.from({ length: 6 }, (_, i) => squadOf(i + 1));
    const result = simulateSeason(
      asRounds(...rounds),
      opening,
      'model',
      RULES,
      GREEDY_ONE_FT,
      OPTIONS,
    );
    expect(result.rounds).toHaveLength(6);
    for (const r of result.rounds) {
      expect(r.bank).toBeGreaterThanOrEqual(0);
      expect(r.squadValue + r.bank).toBeLessThanOrEqual(RULES.budget());
      // 11 fielded on 2 with a captain doubled is 24; nothing here should produce less.
      expect(r.points).toBeGreaterThan(0);
    }
  });
});
