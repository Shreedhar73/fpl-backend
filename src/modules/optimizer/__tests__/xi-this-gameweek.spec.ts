import { Rules } from '../rules';
import { Candidate, pickBestXi } from '../ilp';
import { arrangeSquad } from '../optimizer.service';

/**
 * The eleven, the armband and the bench order are ONE-gameweek decisions (D-037 follow-up).
 *
 * The fifteen is bought for a run of fixtures and priced on horizon EP. But a bench player scores
 * only through an auto-sub THIS week and a captain doubles THIS week's fixture, so when candidates
 * carry `epNext` the XI machinery reads it — and when they do not, it reads `ep` exactly as before,
 * which is what keeps every committed measurement of `pickBestXi` intact.
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

function mk(
  id: string,
  position: Candidate['position'],
  ep: number,
  epNext?: number,
): Candidate {
  return {
    key: `p_${id}`,
    playerId: id,
    webName: id,
    position,
    teamId: `t${id}`,
    teamShortName: id.toUpperCase(),
    cost: 50,
    ep,
    epNext,
    pPlay: 0.9,
    appearances: 50,
  };
}

/** A fifteen where the horizon and the next gameweek disagree about two midfielders. */
const fifteen = (withNext: boolean): Candidate[] => {
  const n = (h: number, x: number) => (withNext ? x : undefined);
  return [
    mk('g1', 'GKP', 14, n(14, 3.5)),
    mk('g2', 'GKP', 12, n(12, 3.3)),
    mk('d1', 'DEF', 16, n(16, 4.5)),
    mk('d2', 'DEF', 15, n(15, 4.4)),
    mk('d3', 'DEF', 14, n(14, 3.8)),
    mk('d4', 'DEF', 13, n(13, 3.7)),
    mk('d5', 'DEF', 9, n(9, 2.6)),
    // The horizon armband and the this-week armband are different players.
    mk('mbeumo', 'MID', 20, n(20, 5.28)),
    mk('saka', 'MID', 19.4, n(19.4, 5.54)),
    mk('m3', 'MID', 18, n(18, 5.1)),
    mk('m4', 'MID', 15, n(15, 4.0)),
    // Horizon says start him; this week he barely has a fixture worth starting.
    mk('runofgames', 'MID', 17, n(17, 2.4)),
    mk('f1', 'FWD', 17, n(17, 4.6)),
    mk('f2', 'FWD', 17, n(17, 4.5)),
    // A forward with a poor run ahead but the best fixture this week.
    mk('oneweek', 'FWD', 9, n(9, 4.8)),
  ];
};

describe('the eleven and the armband are this gameweek\'s decision', () => {
  it('reads the horizon exactly as before when no candidate carries epNext', () => {
    const xi = pickBestXi(fifteen(false), rules);
    expect(xi.captainKey).toBe('p_mbeumo');
    expect(xi.starters.has('p_runofgames')).toBe(true);
    expect(xi.starters.has('p_oneweek')).toBe(false);
  });

  it('gives the armband to the best projection THIS week, not over the run', () => {
    const xi = pickBestXi(fifteen(true), rules);
    expect(xi.captainKey).toBe('p_saka');
    expect(xi.viceKey).toBe('p_mbeumo');
  });

  it('starts the player with the fixture this week over the one with the run', () => {
    const xi = pickBestXi(fifteen(true), rules);
    expect(xi.starters.has('p_oneweek')).toBe(true);
    expect(xi.starters.has('p_runofgames')).toBe(false);
  });

  it('orders the bench by this week too, and still pins the reserve keeper to slot 12', () => {
    const { squad } = arrangeSquad(fifteen(true), rules);
    const bench = squad
      .filter((p) => p.role === 'bench')
      .sort((a, b) => a.benchOrder! - b.benchOrder!);
    expect(bench[0].position).toBe('GKP');
    // runofgames (17 horizon, 2.4 next) sits behind d5 (9 horizon, 2.6 next) and the fourth
    // outfielder — a bench ordered on the horizon would have put him first.
    const outfield = bench.slice(1).map((p) => p.webName);
    expect(outfield.indexOf('runofgames')).toBeGreaterThan(
      outfield.indexOf('d5'),
    );
  });
});
