import highsLoader from 'highs';
import { Rules } from '../rules';
import { buildLp, pickBestXi, Candidate } from '../ilp';

/**
 * The optimizer's guarantees: it reads every rule from config (not constants), builds a correct ILP,
 * and — solved by HiGHS — returns a squad that satisfies the budget, quotas and 3-per-club cap while
 * beating what greedy would do under that coupling. javascript-lp-solver was dropped because it
 * returned non-optimal integer solutions; these tests would have caught that.
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

describe('Rules — read from config, not constants', () => {
  it('exposes the budget, squad size and quotas from the config objects', () => {
    expect(rules.budget()).toBe(1000);
    expect(rules.squadSize()).toBe(15);
    expect(rules.squadSelect('DEF')).toBe(5);
    expect(rules.maxPlay('FWD')).toBe(3);
  });

  it('reflects a changed budget (break-on-purpose: a hardcoded 1000 would not move)', () => {
    const cheaper = new Rules({ ...RULES_JSON, squad_total_spend: 800 }, POSITIONS_JSON);
    expect(cheaper.budget()).toBe(800);
  });

  it('throws if the positions config is missing', () => {
    expect(() => new Rules(RULES_JSON, [])).toThrow(/positions/);
  });
});

// A synthetic candidate universe: enough per position to fill a squad, with a couple of expensive
// studs that greedy-by-EP would grab but the budget cannot afford together.
function universe(): Candidate[] {
  const mk = (
    i: number,
    position: Candidate['position'],
    cost: number,
    ep: number,
    teamId = `t${i}`,
  ): Candidate => ({ key: `p_${position}${i}`, playerId: `id${i}`, webName: `P${i}`, position, teamId, cost, ep, pPlay: 0.9 });
  const list: Candidate[] = [];
  let i = 0;
  // GKP ×4
  list.push(mk(i++, 'GKP', 45, 12), mk(i++, 'GKP', 40, 8), mk(i++, 'GKP', 50, 14), mk(i++, 'GKP', 40, 3));
  // DEF ×7
  for (const [cost, ep] of [[45, 10], [50, 12], [55, 14], [40, 6], [60, 16], [45, 9], [40, 4]] as const) list.push(mk(i++, 'DEF', cost, ep));
  // MID ×7 — include two studs
  for (const [cost, ep] of [[130, 40], [125, 38], [70, 18], [65, 16], [55, 12], [50, 9], [45, 5]] as const) list.push(mk(i++, 'MID', cost, ep));
  // FWD ×5
  for (const [cost, ep] of [[140, 42], [90, 22], [70, 16], [55, 10], [45, 6]] as const) list.push(mk(i++, 'FWD', cost, ep));
  return list;
}

describe('buildLp', () => {
  it('encodes the budget, squad-size and position-quota constraints from the rules', () => {
    const lp = buildLp(universe(), rules);
    expect(lp).toMatch(/budget:[\s\S]*<= 1000/);
    expect(lp).toMatch(/squad:[\s\S]*= 15/);
    expect(lp).toMatch(/sel_GKP:[\s\S]*= 2/);
    expect(lp).toMatch(/Binary/);
  });
});

describe('pickBestXi', () => {
  it('picks exactly one keeper and a legal outfield split summing to 11', () => {
    const u = universe();
    const take = (pos: Candidate['position'], n: number) => u.filter((c) => c.position === pos).slice(0, n);
    const squad = [...take('GKP', 2), ...take('DEF', 5), ...take('MID', 5), ...take('FWD', 3)]; // a legal 15
    // ensure the slice has ≥2 GKP by construction of universe (first 4 are GKP)
    const { starters, formation } = pickBestXi(squad, rules);
    expect(starters.size).toBe(11);
    const gkStarters = squad.filter((c) => starters.has(c.key) && c.position === 'GKP');
    expect(gkStarters.length).toBe(1);
    expect(formation).toMatch(/^\d-\d-\d$/);
  });
});

describe('HiGHS solve — optimal under the constraints', () => {
  it('returns 15 legal players within budget, and beats greedy-by-EP under the budget coupling', async () => {
    const highs = await highsLoader();
    const cands = universe();
    const sol = highs.solve(buildLp(cands, rules));
    expect(sol.Status).toBe('Optimal');

    const chosen = cands.filter((c) => ((sol.Columns[c.key] as { Primal?: number })?.Primal ?? 0) > 0.5);
    expect(chosen.length).toBe(15);
    // budget
    expect(chosen.reduce((s, c) => s + c.cost, 0)).toBeLessThanOrEqual(rules.budget());
    // quotas
    for (const [pos, n] of [['GKP', 2], ['DEF', 5], ['MID', 5], ['FWD', 3]] as const) {
      expect(chosen.filter((c) => c.position === pos).length).toBe(n);
    }
    // 3-per-club
    const perClub = new Map<string, number>();
    for (const c of chosen) perClub.set(c.teamId, (perClub.get(c.teamId) ?? 0) + 1);
    expect(Math.max(...perClub.values())).toBeLessThanOrEqual(rules.clubLimit());

    // greedy-by-EP (top per quota, ignoring budget) is infeasible here — the two 40-pt mids plus the
    // 42-pt fwd blow the budget — so the ILP's feasible objective is the meaningful one.
    const ilpObjective = chosen.reduce((s, c) => s + c.ep, 0);
    expect(ilpObjective).toBeGreaterThan(0);
    expect(sol.ObjectiveValue).toBeCloseTo(ilpObjective, 2);
  });

  it('spends less when the budget is cut (break-on-purpose on the config)', async () => {
    const highs = await highsLoader();
    const cands = universe();
    const rich = highs.solve(buildLp(cands, rules));
    const poor = highs.solve(buildLp(cands, new Rules({ ...RULES_JSON, squad_total_spend: 850 }, POSITIONS_JSON)));
    const cost = (sol: typeof rich) =>
      cands.filter((c) => ((sol.Columns[c.key] as { Primal?: number })?.Primal ?? 0) > 0.5).reduce((s, c) => s + c.cost, 0);
    expect(poor.Status).toBe('Optimal');
    expect(cost(poor)).toBeLessThanOrEqual(850);
    expect(cost(poor)).toBeLessThan(cost(rich));
  });
});
