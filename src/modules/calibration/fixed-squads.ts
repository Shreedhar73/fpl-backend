import highsLoader from 'highs';
import { PositionCode } from '../fpl-sync/mappers';
import { buildLp, Candidate } from '../optimizer/ilp';
import { BENCH_WEIGHT } from '../optimizer/policy';
import { Rules } from '../optimizer/rules';
import { PredictionRow } from './harness';

/**
 * The squads every model fields an XI from (B-012 Phase 2).
 *
 * **One set of squads, shared by every predictor, and that is the whole design.** If each model
 * picked its own fifteen, the XI comparison would be confounded by the squad comparison and neither
 * number would mean anything: a model could field a worse XI out of a better squad and look better.
 * Choosing the squads once, by a rule that reads no model, isolates the decision under test — given
 * these fifteen players, who plays, who sits, and who takes the armband.
 *
 * Two kinds of squad:
 *
 *  - **The template** — the crowd's squad, from `selectedBy`. It is what most managers actually
 *    owned, so an XI decision measured on it is measured on realistic players.
 *  - **Seeded random legal squads** — so the verdict does not rest on the quirks of one squad. The
 *    seed is recorded in the report; an unseeded random baseline is not a baseline.
 *
 * Both are **integer programs, not sorts.** The top fifteen by ownership is not a legal FPL squad:
 * it breaks the position quotas, the three-per-club cap and the budget, all at once. Reusing
 * `buildLp` gets every constraint for free and keeps one definition of "legal squad" in the repo.
 */

export interface FixedSquad {
  label: string;
  members: PredictionRow[];
}

/** A `PredictionRow` as a candidate for the squad ILP. `ep` carries whatever objective is in play. */
function candidate(row: PredictionRow, objective: number): Candidate {
  return {
    key: `p_${row.playerCode}`,
    playerId: String(row.playerCode),
    webName: row.webName,
    position: row.position as PositionCode,
    teamId: String(row.teamCode ?? 0),
    // The archive carries team CODES and no short names. A backtest never renders a payload, so a
    // stable stand-in is honest here in a way it would not be on a serving path.
    teamShortName: `T${row.teamCode ?? 0}`,
    cost: row.value,
    ep: objective,
    pPlay: row.pPlay,
    // Walk-local, from the harness — never `appearanceCounts()`, which reads current state and would
    // tell a round-1 squad how often each player would go on to feature (B-010, and the leak the
    // B-011 session flagged). `buildLp` does not read this field today; the floor is applied in
    // `prunePool`. It is carried honestly rather than stubbed, because a placeholder here becomes a
    // silent filter the day anyone applies the floor to these squads.
    appearances: row.appearances,
  };
}

async function solveSquad(
  candidates: Candidate[],
  rules: Rules,
): Promise<Set<string>> {
  const highs = await highsLoader();
  const solution = highs.solve(
    buildLp(candidates, rules, undefined, BENCH_WEIGHT),
  );
  const chosen = new Set<string>();
  for (const [key, col] of Object.entries(solution.Columns)) {
    if ((col as { Primal: number }).Primal > 0.5) chosen.add(key);
  }
  return chosen;
}

/**
 * The crowd's squad: the legal fifteen that maximises total ownership at the given round.
 *
 * Not the top fifteen by `selectedBy` — that set is illegal on three counts at once, which is
 * exactly why this is a solve. What comes back is the closest legal thing to what most managers held.
 */
export async function templateSquad(
  rows: PredictionRow[],
  ownership: Map<number, number>,
  rules: Rules,
): Promise<FixedSquad> {
  const candidates = rows
    .filter((r) => r.teamCode !== null)
    .map((r) => candidate(r, ownership.get(r.playerCode) ?? 0));
  const chosen = await solveSquad(candidates, rules);
  return {
    label: 'template (most-owned legal fifteen)',
    members: rows.filter((r) => chosen.has(`p_${r.playerCode}`)),
  };
}

/**
 * A legal squad drawn at random, by giving the solver a random objective.
 *
 * Random *weights* through the same ILP rather than a hand-rolled picker: a generator that picks
 * players one at a time has to re-derive legality and gets it subtly wrong at the budget boundary,
 * where a squad that cannot be completed has to be unwound. The solver already knows every rule.
 */
export async function randomLegalSquad(
  rows: PredictionRow[],
  rules: Rules,
  seed: number,
  index: number,
): Promise<FixedSquad> {
  // xorshift32, seeded — deterministic, replayable, and not `Math.random()`, which would make a
  // reported number impossible to reproduce.
  let state = seed + index * 7919;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state) / 2 ** 31;
  };
  const candidates = rows
    .filter((r) => r.teamCode !== null)
    .map((r) => candidate(r, next()));
  const chosen = await solveSquad(candidates, rules);
  return {
    label: `random #${index + 1} (seed ${seed})`,
    members: rows.filter((r) => chosen.has(`p_${r.playerCode}`)),
  };
}

/**
 * Every fixed squad for a season: the template plus `count` seeded random ones.
 *
 * Squads are chosen from the FIRST round of the season, at that round's prices, and then held for
 * the whole comparison. Re-choosing them each round would be a transfer policy, which is Phase 3's
 * job and B-008's after that.
 */
export async function fixedSquads(
  firstRoundRows: PredictionRow[],
  ownership: Map<number, number>,
  rules: Rules,
  seed: number,
  count: number,
): Promise<FixedSquad[]> {
  const squads = [await templateSquad(firstRoundRows, ownership, rules)];
  for (let i = 0; i < count; i++) {
    squads.push(await randomLegalSquad(firstRoundRows, rules, seed, i));
  }
  return squads;
}
