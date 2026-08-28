import { PositionCode } from '../fpl-sync/mappers';
import {
  buildLp,
  Candidate,
  Concentration,
  defencePairs,
  LpSolution,
  NO_CONCENTRATION,
  pairsWithin,
  pickBestXi,
  readSolution,
} from '../optimizer/ilp';
import { Rules } from '../optimizer/rules';
import { Predictor, PredictionRow } from './harness';
import { benchOrder, scoreLineup, SquadMember } from './squad-scoring';
import {
  blank,
  ceilingFor,
  member,
  playingTeams,
  slotFor,
  SquadSlot,
} from './xi-decision';

/**
 * The replay harness (B-025): walk an archived season and score **the eleven the solver itself
 * chose**, round by round, against what actually happened.
 *
 * **Why this exists, and what every other harness in this repo cannot see.** `pnpm decision-quality`
 * and `pnpm optimize:bench-sweep` both walk a season, and both re-choose the lineup every round with
 * `chooseLineup` — by predicted points, from realised availability, with no notion of the objective
 * at all. So they can price a squad, and they are blind to the LP's `y` and `k` columns. Two knobs
 * that only act through those columns — the bench weight's `(1 − w)` coefficient on the XI, and
 * B-011's collision penalty once B-023 moved it onto the XI — were therefore tuned and defended on
 * measurements that structurally could not observe them. B-023's own note says so; B-025 exists
 * because the gap outlived the note.
 *
 * **The design, and what each choice buys:**
 *
 *  - **The LP's own columns, never a re-derivation.** `readSolution` reads `y` and `k` and validates
 *    them. There is deliberately NO fallback to `pickBestXi` when a solve is unreadable: the
 *    enumeration is a second implementation of the same argmax, so falling back to it would silently
 *    restore exactly the blindness this file exists to remove, and the season total would still look
 *    fine.
 *  - **No transfers.** The opening fifteen is held to the last round, so every difference between two
 *    arms is the objective and not a transfer policy reacting to it. The season simulator's own
 *    `no-transfer` column is the same idea; this adds the XI to it.
 *  - **A fresh solve every round, over the fifteen already owned.** The squad variables are pinned by
 *    construction (fifteen candidates, `Σ x = 15`), so the solve is purely "who starts and who wears
 *    the armband, under this objective, given this round's projections and this round's fixtures".
 *    Costs are the PURCHASE prices, which is what keeps the budget row satisfiable in every later
 *    round — the squad is held, not re-bought.
 *  - **Observables, not a named charge.** The rounds carry pairs held, pairs started and the
 *    projected points forgone in the XI. What the objective *charges* for those is
 *    the thing under test and changes between arms; a harness that recomputed the charge would have
 *    to be edited alongside the change it is meant to judge, and would then agree with it by
 *    construction.
 *
 * The leak rules are `xi-decision`'s, unchanged and reused rather than reimplemented: a player with
 * no row whose club played is carried forward at his last known projection (being dropped is not
 * knowable before a deadline), and a player whose club had no fixture is a blank (the fixture list is
 * public).
 */

/** How a round's LP was solved. Injected so the spec can drive the harness without a WASM solver. */
export type LpSolver = (lp: string) => LpSolution;

export interface ReplayOptions {
  /** what this arm is called in the report */
  label: string;
  benchWeight: number;
  /** the defensive-concentration charge (B-029); 0 for an unpenalised arm */
  concentrationLambda: number;
}

/**
 * A starter the LP left out in favour of a lower-projecting player in the same position.
 *
 * This is the shape of the GW2 complaint that opened B-025 — Wieffer 17.22 and De Cuyper 16.34
 * benched behind Ballard 15.20 and Lacroix 15.06 — and the harness has to be able to state it, or it
 * cannot show the behaviour it was built to judge.
 */
export interface ForgoneSwap {
  position: PositionCode;
  benched: string;
  benchedEp: number;
  started: string;
  startedEp: number;
}

export interface ReplayRound {
  season: string;
  round: number;
  /** realised points of the LP's eleven, after auto-substitutions and the armband */
  points: number;
  /** realised points of the best XI these fifteen could have fielded, armband included */
  ceiling: number;
  /** the LP's formation, "DEF-MID-FWD" */
  formation: string;
  captainPoints: number;
  bestFieldedPoints: number;
  substitutions: number;
  /** same-club defensive pairs the squad HOLDS this round */
  heldPairs: number;
  /** of those, the ones the LP also started on both sides — the charged ones */
  startedPairs: number;
  /** projected points the LP's XI and armband give up against the best the fifteen could field */
  epForgone: number;
  /** the XI half of `epForgone`, worst swap first; empty with a non-zero total means the armband */
  forgone: ForgoneSwap[];
}

export interface ReplayResult {
  label: string;
  predictor: Predictor;
  /** the knobs this arm was solved with — a report that names the constants instead would lie about
   * any run that overrode them */
  benchWeight: number;
  concentrationLambda: number;
  rounds: ReplayRound[];
  totalPoints: number;
  totalCeiling: number;
  /** share of the achievable XI points the LP's own selections took */
  xiEfficiency: number | null;
  /** rounds in which the squad held at least one same-club defensive pair */
  roundsOwningAPair: number;
  /** rounds in which the LP started both members of one — the charged case */
  roundsStartingAPair: number;
  /** projected points forgone over the season, and the rounds it happened in */
  totalEpForgone: number;
  roundsForgoingEp: number;
}

/** What the predictor says about a held player this round — his row, or what was last said of him. */
function projectionOf(
  slot: SquadSlot,
  predictor: Predictor,
): { ep: number; pPlay: number } {
  if (slot.row) {
    return {
      ep: slot.row.predicted[predictor] ?? 0,
      pPlay: slot.row.pPlay,
    };
  }
  return { ep: slot.carried?.points ?? 0, pPlay: slot.carried?.pPlay ?? 0 };
}

/**
 * The held fifteen as optimizer candidates, at their PURCHASE prices.
 *
 * Purchase rather than market price is what keeps the budget row satisfiable in round 38: the squad
 * was affordable when it was bought and is never re-bought here, so pricing it at what it costs today
 * would make a held squad illegal for reasons that have nothing to do with the objective under test.
 */
export function heldCandidates(
  slots: SquadSlot[],
  predictor: Predictor,
): Candidate[] {
  return slots.map((slot) => {
    const { ep, pPlay } = projectionOf(slot, predictor);
    const base = slot.base;
    if (base.teamCode === null) {
      // `openingSquad` filters these out before solving, so a held player without a club means the
      // squad was assembled by something else. Loud, because a null club silently becomes the string
      // "null" and every such player then collides with every other one.
      throw new Error(
        `held player ${base.webName} has no club code — the fifteen cannot be priced`,
      );
    }
    return {
      key: `p_${base.playerCode}`,
      playerId: String(base.playerCode),
      webName: base.webName,
      position: base.position as PositionCode,
      teamId: String(base.teamCode),
      teamShortName: `T${base.teamCode}`,
      cost: base.value,
      ep,
      pPlay,
      appearances: slot.row?.appearances ?? base.appearances,
    };
  });
}

/**
 * What the LP's eleven and armband give up in projected points against the best the same fifteen
 * could field.
 *
 * **The counterfactual is `pickBestXi` at a bench weight of zero**, which makes its objective
 * `Σ EP over the XI + EP of the captain` — raw projected points, the eleven a manager reading only
 * the projections would field. Passing the real bench weight here would score the counterfactual on
 * `(1 − w)·Σ EP + captain`, an expression that ranks elevens differently and is itself half of what
 * is under test; the comparison would then move whenever the knob did.
 *
 * **The armband is inside the total, and `swaps` itemises only the XI half.** A solve that starts the
 * right eleven and captains the wrong man has given up points too, and a metric blind to it would
 * report a squad as perfectly used while its largest single lever was misapplied. The two are
 * separable by reading `swaps`: an empty list against a non-zero total is an armband difference.
 */
export function epForgone(
  squad: Candidate[],
  rules: Rules,
  lpXi: Set<string>,
  lpCaptainKey: string,
): { total: number; swaps: ForgoneSwap[] } {
  const byKey = new Map(squad.map((c) => [c.key, c]));
  const best = pickBestXi(squad, rules, 0);

  const epOf = (keys: Set<string>, captainKey: string | undefined) => {
    let sum = 0;
    for (const key of keys) sum += byKey.get(key)?.ep ?? 0;
    return sum + (captainKey ? (byKey.get(captainKey)?.ep ?? 0) : 0);
  };
  const total = epOf(best.starters, best.captainKey) - epOf(lpXi, lpCaptainKey);

  // Which swaps make it up: per position, the benched players the LP passed over, against the
  // starters it took instead. Pairing best-benched with worst-started is what names the decision a
  // reader would query — "you sat a 17.2 defender for a 15.2 one".
  const swaps: ForgoneSwap[] = [];
  for (const position of ['GKP', 'DEF', 'MID', 'FWD'] as PositionCode[]) {
    const here = squad.filter((c) => c.position === position);
    const benched = here
      .filter((c) => !lpXi.has(c.key))
      .sort((a, b) => b.ep - a.ep);
    const started = here
      .filter((c) => lpXi.has(c.key))
      .sort((a, b) => a.ep - b.ep);
    for (let i = 0; i < Math.min(benched.length, started.length); i++) {
      if (benched[i].ep <= started[i].ep) break;
      swaps.push({
        position,
        benched: benched[i].webName,
        benchedEp: benched[i].ep,
        started: started[i].webName,
        startedEp: started[i].ep,
      });
    }
  }
  swaps.sort((a, b) => b.benchedEp - b.startedEp - (a.benchedEp - a.startedEp));
  return { total, swaps };
}

/**
 * Walk one archived season with a held fifteen, solving each round's XI with the real objective.
 *
 * `rowsByRound` is keyed by round and then by player code; a player absent from a round had no row,
 * which `slotFor` resolves into "blanked" or "dropped" by whether their club played.
 */
export function replaySeason(
  season: string,
  rowsByRound: Map<number, Map<number, PredictionRow>>,
  opening: PredictionRow[],
  predictor: Predictor,
  rules: Rules,
  solve: LpSolver,
  options: ReplayOptions,
): ReplayResult {
  const rounds: ReplayRound[] = [];
  const lastSeen = new Map<number, { points: number; pPlay: number }>();

  for (const [round, byCode] of [...rowsByRound.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const playing = playingTeams(byCode);
    const slots = opening.map((base) =>
      slotFor(base, byCode, playing, lastSeen),
    );
    // A round where not one of the fifteen has a row is a round this cannot score — the same rule
    // `decideOverSeason` applies, for the same reason.
    if (slots.every((s) => s.row === null)) continue;

    const candidates = heldCandidates(slots, predictor);
    const concentration: Concentration = {
      pairs: defencePairs(candidates),
      lambda: options.concentrationLambda,
    };

    const solved = readSolution(
      candidates,
      solve(buildLp(candidates, rules, concentration, options.benchWeight)),
      rules,
    );

    const memberOf = new Map<string, SquadMember>(
      slots.map((slot) => [
        `p_${slot.base.playerCode}`,
        slot.row ? member(slot.row) : blank(slot.base),
      ]),
    );
    const at = (key: string): SquadMember => {
      const found = memberOf.get(key);
      if (!found) throw new Error(`the solve returned an unknown player ${key}`);
      return found;
    };

    const starters = [...solved.xi].map(at);
    const benchedCandidates = candidates.filter((c) => !solved.xi.has(c.key));
    const benchGk = benchedCandidates.filter((c) => c.position === 'GKP');
    const benchOutfield = benchOrder(
      benchedCandidates
        .filter((c) => c.position !== 'GKP')
        .map((c) => ({
          key: c.key,
          predictedPoints: c.ep,
          pPlay: c.pPlay,
          code: Number(c.playerId),
        })),
      (c) => c.code,
    );
    const bench = [...benchGk.map((c) => c.key), ...benchOutfield.map((b) => b.key)].map(at);

    // The LP names a captain and no vice — there is no vice variable, because the armband is the only
    // multiplier the objective can see. The runner-up by projection takes it, which is what a manager
    // does and what `pickBestXi` already does with its own second-placed score.
    const viceKey = candidates
      .filter((c) => solved.xi.has(c.key) && c.key !== solved.captainKey)
      .sort((a, b) => b.ep - a.ep)[0]?.key;

    const scored = scoreLineup(
      {
        starters,
        bench,
        captain: at(solved.captainKey).playerCode,
        vice: at(viceKey ?? solved.captainKey).playerCode,
      },
      rules,
    );

    const ownedKeys = new Set(candidates.map((c) => c.key));
    const heldPairs = pairsWithin(ownedKeys, concentration.pairs);
    const startedPairs = pairsWithin(solved.xi, concentration.pairs);

    const forgone = epForgone(
      candidates,
      rules,
      solved.xi,
      solved.captainKey,
    );

    for (const slot of slots) {
      if (slot.row) {
        lastSeen.set(slot.row.playerCode, {
          points: slot.row.predicted[predictor] ?? 0,
          pPlay: slot.row.pPlay,
        });
      }
    }

    const captain = scored.fielded.find((m) => m.playerCode === scored.doubled);
    rounds.push({
      season,
      round,
      points: scored.points,
      ceiling: ceilingFor([...memberOf.values()], rules),
      formation: solved.formation,
      captainPoints: captain?.actual ?? 0,
      bestFieldedPoints: Math.max(...scored.fielded.map((m) => m.actual)),
      substitutions: scored.substitutions.length,
      heldPairs: heldPairs.length,
      startedPairs: startedPairs.length,
      epForgone: forgone.total,
      forgone: forgone.swaps,
    });
  }

  const totalPoints = rounds.reduce((s, r) => s + r.points, 0);
  const totalCeiling = rounds.reduce((s, r) => s + r.ceiling, 0);
  const totalEpForgone = rounds.reduce((s, r) => s + r.epForgone, 0);

  return {
    label: options.label,
    predictor,
    benchWeight: options.benchWeight,
    concentrationLambda: options.concentrationLambda,
    rounds,
    totalPoints,
    totalCeiling,
    xiEfficiency: totalCeiling > 0 ? totalPoints / totalCeiling : null,
    roundsOwningAPair: rounds.filter((r) => r.heldPairs > 0).length,
    roundsStartingAPair: rounds.filter((r) => r.startedPairs > 0).length,
    totalEpForgone,
    // A tenth of a point is below what any projection resolves; counting rounds at that level would
    // report floating-point noise as a decision.
    roundsForgoingEp: rounds.filter((r) => r.epForgone > 0.01).length,
  };
}
