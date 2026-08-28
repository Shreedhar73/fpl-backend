import { PositionCode } from '../../fpl-sync/mappers';
import { Rules } from '../../optimizer/rules';
import { benchOrder, Lineup, scoreLineup, SquadMember } from '../squad-scoring';

/**
 * B-012 Phase 2 — the FPL rules that decide what a squad actually scored.
 *
 * Every rule here is one a simulator could get wrong in the direction that flatters the model:
 * subbing a player who merely scored badly, doubling a vice who was not entitled to the armband,
 * letting a substitution break the formation. Each gets a test, and the sabotage runs at the bottom
 * of the file's history record show each going red when inverted.
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

let nextCode = 1;
const player = (
  position: PositionCode,
  over: Partial<SquadMember> = {},
): SquadMember => ({
  playerCode: nextCode++,
  webName: `${position}${nextCode}`,
  position,
  actual: 2,
  minutes: 90,
  ...over,
});

/** A legal 3-5-2 with a four-player bench, everything playing and scoring 2. */
function lineup(over: Partial<Lineup> = {}): Lineup {
  nextCode = 1;
  const starters = [
    player('GKP'),
    player('DEF'),
    player('DEF'),
    player('DEF'),
    player('MID'),
    player('MID'),
    player('MID'),
    player('MID'),
    player('MID'),
    player('FWD'),
    player('FWD'),
  ];
  const bench = [
    player('GKP'),
    player('DEF'),
    player('FWD'),
    player('MID'),
  ];
  return {
    starters,
    bench,
    captain: starters[9].playerCode,
    vice: starters[10].playerCode,
    ...over,
  };
}

describe('auto-substitution', () => {
  it('replaces a starter who registered 0 minutes', () => {
    const l = lineup();
    l.starters[10] = { ...l.starters[10], minutes: 0, actual: 0 };
    const s = scoreLineup(l, RULES);
    expect(s.substitutions).toHaveLength(1);
    expect(s.fielded).toHaveLength(11);
    expect(s.fielded.some((m) => m.playerCode === l.starters[10].playerCode)).toBe(false);
  });

  it('does NOT replace a starter who played and scored badly', () => {
    // The rule most often got wrong. A 1-point cameo stays on the field; substituting it would
    // invent points the squad never had.
    const l = lineup();
    l.starters[10] = { ...l.starters[10], minutes: 7, actual: 1 };
    expect(scoreLineup(l, RULES).substitutions).toHaveLength(0);
  });

  it('tries the bench in order', () => {
    const l = lineup();
    l.starters[10] = { ...l.starters[10], minutes: 0, actual: 0 };
    const s = scoreLineup(l, RULES);
    // Bench slot 1 is the goalkeeper and cannot replace a forward in a 3-5-2 without breaking the
    // formation, so the first legal candidate is bench slot 2 — the defender.
    expect(s.substitutions[0].on.position).toBe('DEF');
  });

  it('skips a substitution that would break the formation and tries the next', () => {
    // A 3-5-2 losing a defender cannot go to 2 at the back. The bench defender is the only legal
    // replacement; if he had not played, the swap must be skipped entirely rather than forced.
    const l = lineup();
    l.starters[1] = { ...l.starters[1], minutes: 0, actual: 0 };
    l.bench[1] = { ...l.bench[1], minutes: 0, actual: 0 };
    const s = scoreLineup(l, RULES);
    expect(s.substitutions).toHaveLength(0);
    expect(s.fielded).toHaveLength(11);
  });

  it('lets the bench goalkeeper replace the starting goalkeeper and nothing else', () => {
    const l = lineup();
    l.starters[0] = { ...l.starters[0], minutes: 0, actual: 0 };
    const s = scoreLineup(l, RULES);
    expect(s.substitutions).toHaveLength(1);
    expect(s.substitutions[0].on.position).toBe('GKP');
  });

  it('does not bring on a bench player who also did not play', () => {
    const l = lineup();
    l.starters[10] = { ...l.starters[10], minutes: 0, actual: 0 };
    for (const i of [0, 1, 2, 3]) {
      l.bench[i] = { ...l.bench[i], minutes: 0, actual: 0 };
    }
    expect(scoreLineup(l, RULES).substitutions).toHaveLength(0);
  });
});

describe('the armband', () => {
  it('doubles the captain when the captain played', () => {
    const l = lineup();
    l.starters[9] = { ...l.starters[9], actual: 10 };
    l.captain = l.starters[9].playerCode;
    const s = scoreLineup(l, RULES);
    expect(s.doubled).toBe(l.captain);
    // 10 other players on 2, the captain on 10, doubled.
    expect(s.points).toBe(10 * 2 + 2 * 10);
  });

  it('hands the armband to the vice when the captain played 0 minutes', () => {
    const l = lineup();
    l.starters[9] = { ...l.starters[9], minutes: 0, actual: 0 };
    l.captain = l.starters[9].playerCode;
    l.vice = l.starters[10].playerCode;
    const s = scoreLineup(l, RULES);
    expect(s.doubled).toBe(l.vice);
  });

  it('doubles NOBODY when the captain and the vice both blanked', () => {
    // A real branch, not a defensive default. A squad that loses both scores no double at all, and a
    // simulator that quietly promotes the third-highest scorer is inventing points.
    const l = lineup();
    l.starters[9] = { ...l.starters[9], minutes: 0, actual: 0 };
    l.starters[10] = { ...l.starters[10], minutes: 0, actual: 0 };
    l.captain = l.starters[9].playerCode;
    l.vice = l.starters[10].playerCode;
    const s = scoreLineup(l, RULES);
    expect(s.doubled).toBeNull();
  });
});

describe('bench order', () => {
  it('ranks by pPlay times predicted points, not by predicted points alone', () => {
    // A bench player only scores if someone ahead of them blanks, so the projection is discounted by
    // the chance of appearing at all: 8 x 0.30 = 2.40 against 3 x 0.98 = 2.94. The naive ordering
    // puts the 8 first; this one does not.
    const bench = [
      { predictedPoints: 8, pPlay: 0.3, name: 'rotation risk', code: 1 },
      { predictedPoints: 3, pPlay: 0.98, name: 'nailed', code: 2 },
    ];
    expect(benchOrder(bench, (x) => x.code)[0].name).toBe('nailed');
    // and the ordering it disagrees with, stated so the test shows a flip rather than an assertion
    expect([...bench].sort((a, b) => b.predictedPoints - a.predictedPoints)[0].name).toBe(
      'rotation risk',
    );
  });

  it('falls back to predicted points for a baseline that has no pPlay', () => {
    // `form` and last season's points-per-90 are scalars with no appearance probability. Handing
    // them the model's would be lending a baseline a piece of the model and then beating it.
    const ordered = benchOrder(
      [
        { predictedPoints: 3, pPlay: null, name: 'lower', code: 1 },
        { predictedPoints: 8, pPlay: null, name: 'higher', code: 2 },
      ],
      (x) => x.code,
    );
    expect(ordered[0].name).toBe('higher');
  });
});
