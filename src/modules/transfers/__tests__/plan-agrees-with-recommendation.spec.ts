import highsLoader from 'highs';
import { PositionCode } from '../../fpl-sync/mappers';
import {
  buildLp,
  Candidate,
  defencePairs,
  LpSolution,
  readSolution,
} from '../../optimizer/ilp';
import { BENCH_WEIGHT, DEFENCE_CONCENTRATION_LAMBDA } from '../../optimizer/policy';
import { Rules } from '../../optimizer/rules';
import { buildTransferLp, OwnedCandidate } from '../transfer-lp';

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

/** A legal fifteen with distinct EPs, so the optimum is unique and a tie cannot decide the test. */
const fifteen = (): OwnedCandidate[] => {
  const spec: [PositionCode, number][] = [
    ['GKP', 2],
    ['DEF', 5],
    ['MID', 5],
    ['FWD', 3],
  ];
  const out: OwnedCandidate[] = [];
  let i = 0;
  for (const [position, n] of spec) {
    for (let k = 0; k < n; k++, i++) {
      out.push({
        key: `p_${i}`,
        playerId: String(i),
        webName: `${position}-${k}`,
        position,
        // Three per club, and the first two DEF share one so a concentration pair exists at all.
        teamId: `t${Math.floor(i / 3)}`,
        teamShortName: `T${Math.floor(i / 3)}`,
        cost: 45,
        ep: 1 + i * 0.37,
        pPlay: 0.9,
        appearances: 20,
        sellValue: 45,
      });
    }
  }
  return out;
};

/**
 * The bar B-024 has carried since it was written, and the first thing that checks it.
 *
 * > The plan and the recommendation, run on the same squad, agree about who should start and who
 * > should wear the armband.
 *
 * Until B-024 they could not: `buildTransferLp` maximised `Σ EP · x` over all fifteen and had no
 * eleven at all, while `buildLp` priced the eleven, a discounted bench and the armband. A user saw
 * both halves on one screen.
 *
 * Pinned with the transfer budget frozen — no moves allowed — so the two programs face the identical
 * fifteen and the comparison is about the objective and nothing else.
 */
describe('the plan and the recommendation agree on the XI and the armband', () => {
  let solve: (lp: string) => ReturnType<
    Awaited<ReturnType<typeof highsLoader>>['solve']
  >;
  beforeAll(async () => {
    const highs = await highsLoader();
    solve = (lp) => highs.solve(lp);
  });

  const read = (lp: string, all: Candidate[]) => {
    const s = solve(lp) as LpSolution;
    expect(s.Status).toBe('Optimal');
    const on = (name: string) => (s.Columns[name]?.Primal ?? 0) > 0.5;
    return {
      xi: all
        .filter((c) => on(`y_${c.key}`))
        .map((c) => c.key)
        .sort(),
      captain: all.filter((c) => on(`k_${c.key}`)).map((c) => c.key),
    };
  };

  const compare = (concentrationLambda: number) => {
    const owned = fifteen();
    const concentration = {
      pairs: defencePairs(owned),
      lambda: concentrationLambda,
    };
    const plan = read(
      buildTransferLp({
        owned,
        market: [],
        rules: RULES,
        bank: 0,
        freeTransfers: 0,
        hitCost: 4,
        maxTransfers: 0,
        benchWeight: BENCH_WEIGHT,
        concentration,
      }),
      owned,
    );
    const recommendation = readSolution(
      owned,
      solve(buildLp(owned, RULES, concentration, BENCH_WEIGHT)),
      RULES,
    );
    return {
      plan,
      recommendation: {
        xi: [...recommendation.xi].sort(),
        captain: [recommendation.captainKey],
      },
    };
  };

  it('picks the same eleven', () => {
    const { plan, recommendation } = compare(DEFENCE_CONCENTRATION_LAMBDA);
    expect(plan.xi).toEqual(recommendation.xi);
  });

  it('picks the same captain', () => {
    const { plan, recommendation } = compare(DEFENCE_CONCENTRATION_LAMBDA);
    expect(plan.captain).toEqual(recommendation.captain);
  });

  it('agrees with no concentration charge either', () => {
    const { plan, recommendation } = compare(0);
    expect(plan.xi).toEqual(recommendation.xi);
    expect(plan.captain).toEqual(recommendation.captain);
  });

  // The charge has to be able to bite, or the two tests above agree about nothing.
  it('has a concentration pair to charge in the first place', () => {
    expect(defencePairs(fifteen()).length).toBeGreaterThan(0);
  });
});
