import { buildLp, Candidate, SquadObjective } from '../../optimizer/ilp';
import { Rules } from '../../optimizer/rules';
import { PositionCode } from '../../fpl-sync/mappers';
import {
  ARMS,
  assertInstrumentMoved,
  assertObjectiveReachesSolver,
  INSTRUMENT_CHECK,
  meanOverlap,
  OBJECTIVE_CHECK,
} from '../objective-ab.service';
import { SeasonResult, SimRound } from '../season-sim';

const rules = {
  squadSize: () => 15,
  xiSize: () => 11,
  budget: () => 1000,
  clubLimit: () => 3,
  squadSelect: (p: PositionCode) => ({ GKP: 2, DEF: 5, MID: 5, FWD: 3 })[p],
  minPlay: (p: PositionCode) => ({ GKP: 1, DEF: 3, MID: 2, FWD: 1 })[p],
  maxPlay: (p: PositionCode) => ({ GKP: 1, DEF: 5, MID: 5, FWD: 3 })[p],
} as unknown as Rules;

const pool = (): Candidate[] => {
  const out: Candidate[] = [];
  let i = 0;
  for (const [pos, n] of [
    ['GKP', 6],
    ['DEF', 12],
    ['MID', 12],
    ['FWD', 8],
  ] as [PositionCode, number][]) {
    for (let k = 0; k < n; k++, i++) {
      out.push({
        key: `p_${i}`,
        playerId: String(i),
        webName: `P${i}`,
        position: pos,
        teamId: `t${i % 8}`,
        teamShortName: `T${i % 8}`,
        cost: 40 + ((i * 7) % 60),
        ep: 1 + ((i * 13) % 50) / 10,
        pPlay: 0.9,
        appearances: 20,
      });
    }
  }
  return out;
};

const lp = (objective: SquadObjective) =>
  buildLp(pool(), rules, undefined, 0.7, objective);
const objectiveRow = (s: string) => s.split('\n')[1];

describe('the all-fifteen-equal arm is a real arm', () => {
  it('emits a different objective row', () => {
    expect(objectiveRow(lp('all-fifteen-equal'))).not.toEqual(
      objectiveRow(lp('xi-bench-captain')),
    );
  });

  it('prices every one of the fifteen at its full EP, and nothing else', () => {
    const row = objectiveRow(lp('all-fifteen-equal'));
    expect(row).not.toMatch(/\by_/);
    expect(row).not.toMatch(/\bk_/);
    expect(row).not.toMatch(/\bd_/);
    // 0.7 x EP is what the served objective puts on x; this arm must put the whole EP there.
    expect(row).toContain('1.0000 p_0');
  });

  it('changes ONLY the objective — the feasible set is identical', () => {
    const cut = (s: string) => s.slice(s.indexOf('Subject To'));
    expect(cut(lp('all-fifteen-equal'))).toEqual(cut(lp('xi-bench-captain')));
  });

  it('still emits the XI and armband columns, so a solution stays readable', () => {
    const s = lp('all-fifteen-equal');
    expect(s).toContain(' xi: ');
    expect(s).toContain(' captain: ');
  });

  it('defaults to what the product serves', () => {
    expect(buildLp(pool(), rules, undefined, 0.7)).toEqual(
      lp('xi-bench-captain'),
    );
  });
});

describe('the arms', () => {
  it('start from the objective that was replaced, because everything is paired against it', () => {
    expect(ARMS[0].objective).toBe('all-fifteen-equal');
  });

  it('carry exactly one positive control, and it is not a candidate objective', () => {
    const checks = ARMS.filter((a) => a.label === INSTRUMENT_CHECK);
    expect(checks).toHaveLength(1);
    expect(checks[0].benchWeight).toBe(0);
    expect(checks[0].objective).toBe('xi-bench-captain');
    expect(checks[0].note).toContain('Not a candidate');
  });

  it('carry a negative control on the objective the baseline uses', () => {
    const checks = ARMS.filter((a) => a.label === OBJECTIVE_CHECK);
    expect(checks).toHaveLength(1);
    // It must differ from the baseline ONLY in a knob its objective does not read, or it proves
    // nothing about the objective flag.
    expect(checks[0].objective).toBe(ARMS[0].objective);
    expect(checks[0].benchWeight).not.toBe(ARMS[0].benchWeight);
    expect(checks[0].concentrationLambda).toBe(ARMS[0].concentrationLambda);
  });
});

describe('assertObjectiveReachesSolver', () => {
  it('passes when the negative control returned the baseline exactly', () => {
    expect(() =>
      assertObjectiveReachesSolver([3, 1, 2], [1, 2, 3]),
    ).not.toThrow();
  });

  // The red path: an objective flag that stopped reaching the solver turns this control into the
  // positive one, which buys a different fifteen.
  it('throws when the negative control drifted from the baseline', () => {
    expect(() => assertObjectiveReachesSolver([1, 2, 9], [1, 2, 3])).toThrow(
      /not reaching the solver/,
    );
  });

  it('throws on a squad of the wrong size even when every player is shared', () => {
    expect(() => assertObjectiveReachesSolver([1, 2], [1, 2, 3])).toThrow();
  });
});

describe('assertInstrumentMoved', () => {
  it('passes when the instrument arm bought a different fifteen', () => {
    expect(assertInstrumentMoved([1, 2, 3, 9], [1, 2, 3, 4])).toBe(3);
  });

  // The red path. Without this the guard is a comment.
  it('throws when the instrument arm bought the baseline’s fifteen', () => {
    expect(() => assertInstrumentMoved([1, 2, 3, 4], [1, 2, 3, 4])).toThrow(
      /not reaching the solver/,
    );
  });
});

describe('meanOverlap', () => {
  const season = (squads: number[][]): SeasonResult => ({
    predictor: 'model',
    policy: 'p',
    rounds: squads.map(
      (squad, i): SimRound => ({
        round: i + 1,
        points: 0,
        hitCost: 0,
        transfersMade: 0,
        freeTransfersAfter: 0,
        bank: 0,
        squadValue: 0,
        substitutions: 0,
        captainPoints: 0,
        squad,
      }),
    ),
    totalPoints: 0,
    totalHitCost: 0,
    totalTransfers: 0,
    finalTeamValue: 0,
  });
  const arm = (squads: number[][]) => ({
    arm: 'a',
    policy: 'p',
    result: season(squads),
    opening: squads[0],
  });

  it('is 1 when both arms held the same squad every round', () => {
    const a = arm([
      [1, 2, 3],
      [1, 2, 4],
    ]);
    expect(meanOverlap(a, a)).toBe(1);
  });

  it('is 0 when they never shared a player', () => {
    expect(meanOverlap(arm([[1, 2, 3]]), arm([[4, 5, 6]]))).toBe(0);
  });

  it('averages over rounds rather than pooling players', () => {
    // round 1: 3/3 shared, round 2: 0/3  ->  0.5
    const a = arm([
      [1, 2, 3],
      [1, 2, 3],
    ]);
    const b = arm([
      [1, 2, 3],
      [7, 8, 9],
    ]);
    expect(meanOverlap(a, b)).toBeCloseTo(0.5, 10);
  });

  it('ignores a round the other arm never walked', () => {
    expect(
      meanOverlap(
        arm([
          [1, 2, 3],
          [1, 2, 3],
        ]),
        arm([[1, 2, 3]]),
      ),
    ).toBe(1);
  });
});
