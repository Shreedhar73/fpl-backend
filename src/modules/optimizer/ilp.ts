import { PositionCode } from '../fpl-sync/mappers';
import { Rules, POSITIONS } from './rules';
import {
  BENCH_WEIGHT,
  DEFENCE_CONCENTRATION_LAMBDA,
  DEFENSIVE_POSITIONS,
} from './policy';

/**
 * Builds the squad-selection integer linear program as a CPLEX LP-format string for HiGHS — pure, no
 * solver import, so it is unit-testable on its own. This is a real ILP, not a greedy picker: greedy on
 * points-per-million is provably wrong under a budget plus a 3-per-club cap (`fpl-optimizer`).
 *
 * HiGHS, not javascript-lp-solver: the latter returns wrong (non-optimal) integer solutions even on a
 * three-variable problem — it picked a 21-point pair over the optimal 45-point one under a slack
 * budget. HiGHS (the Edinburgh solver, WASM) solves to optimality.
 *
 * One binary per candidate: `x` = in the 15. The XI, captain and bench are chosen from the 15
 * afterwards by exact enumeration (`pickBestXi`) — a tiny secondary problem kept out of the ILP.
 */
export interface Candidate {
  key: string; // LP variable name, e.g. "p_<playerId>" (alphanumeric — LP-safe)
  playerId: string;
  webName: string;
  position: PositionCode;
  teamId: string;
  /** e.g. "CHE". Carried so a payload never has to print `teamId`, which is a cuid. */
  teamShortName: string;
  cost: number; // tenths
  ep: number; // horizon expected points
  /**
   * NEXT-gameweek expected points, when the caller has them (D-037 follow-up, plan 029).
   *
   * The fifteen is a bet over the horizon and is priced on `ep`. The eleven, the armband and the
   * bench order are decisions about ONE gameweek — a bench player scores only through an auto-sub
   * this week, and a captain doubles this week's fixture — so `pickBestXi` and `arrangeSquad` read
   * this when it is present and `ep` when it is not. Measured on 2026-09-02's live solve: the
   * horizon armband went to a player 0.26 points a week behind the next-gameweek best. The decision
   * harness (`decision-quality`) has always chosen its XI per round on that round's projection; the
   * served product now does what was measured.
   */
  epNext?: number;
  pPlay: number;
  /** Premier League appearances (gameweek rows with minutes > 0), archive + this season — B-010. */
  appearances: number;
}

/**
 * Two of our own defensive players in the same defence (B-029).
 *
 * They share one clean sheet, exactly, which makes them the most concentrated holding a squad can
 * take: measured over three archived seasons their points covary **+5.58**, the largest correlated
 * term in a squad and the one nothing priced until now.
 *
 * **This replaced B-011's fixture collision**, which paired one of our attackers against one of our
 * defenders in the same match. B-028 measured that pairing at −0.195 correlation — real, but a HEDGE,
 * cutting the pair's variance by 19.5%. The reasoning is on `DEFENCE_CONCENTRATION_LAMBDA`.
 */
export interface DefencePair {
  /** the club both play for, as a human reads it — "BHA" */
  club: string;
  a: Candidate;
  b: Candidate;
}

/** Every pair of defensive players in a candidate set who play for the same club. */
export function defencePairs(candidates: Candidate[]): DefencePair[] {
  const defensive = new Set<string>(DEFENSIVE_POSITIONS);
  const byTeam = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (!defensive.has(c.position)) continue;
    const list = byTeam.get(c.teamId) ?? [];
    list.push(c);
    byTeam.set(c.teamId, list);
  }

  const pairs: DefencePair[] = [];
  for (const group of byTeam.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        pairs.push({ club: group[i].teamShortName, a: group[i], b: group[j] });
      }
    }
  }
  return pairs;
}

/** The penalty context a solve and an arrangement share, so the two can never disagree. */
export interface Concentration {
  pairs: DefencePair[];
  lambda: number;
}

export const NO_CONCENTRATION: Concentration = { pairs: [], lambda: 0 };

/** The pairs both of whose members are in a given set of candidate keys. */
export function pairsWithin(
  keys: Set<string>,
  pairs: DefencePair[],
): DefencePair[] {
  return pairs.filter((p) => keys.has(p.a.key) && keys.has(p.b.key));
}

/**
 * The quantity the ILP actually maximises over a 15: raw horizon EP less the collision penalty.
 *
 * Exported because `insights` compares a user's squad against the recommendation, and comparing a
 * penalised optimum against an unpenalised squad is what makes a legitimately negative gap look like
 * a bug (Phase 3 of the plan).
 *
 * **It charges nothing since B-029, and that is not an oversight.** The concentration penalty is
 * charged on the XI, and this function is handed a fifteen with no eleven chosen — there is no honest
 * way to price a starting decision that has not been made. What it returns is therefore raw horizon
 * EP, and it stays as a named function because `insights` compares a user's squad against the
 * recommendation and the day another squad-level charge appears it belongs here rather than in a
 * second implementation.
 */
export function penalisedSquadEp(squad: Candidate[]): number {
  return squad.reduce((s, c) => s + c.ep, 0);
}

/** Join additive terms as an LP expression, wrapping across lines but keeping the `+` at each break
 * (a linear expression may span lines only after an operator). */
function expr(parts: string[]): string {
  return parts.join(' +\n  ');
}

/** The same, for a signed sum — the objective, where the penalty terms are negative. */
function signedExpr(terms: { coef: number; name: string }[]): string {
  return terms
    .map((t, i) => {
      const sign = t.coef < 0 ? '-' : i === 0 ? '' : '+';
      const body = `${Math.abs(t.coef).toFixed(4)} ${t.name}`;
      return i === 0 ? `${sign}${body}` : `${sign} ${body}`;
    })
    .join('\n  ');
}

/**
 * The squad program (B-023).
 *
 * **What this used to be, and why it was wrong.** `buildLp` emitted one variable family — `x_p`, in
 * the fifteen — at coefficient `ep_p`, and maximised `Σ EP_p × x_p`. That is a quantity FPL never
 * pays out. A bench player scores only through an auto-substitution, and the captain's double, which
 * is the single largest lever in a gameweek, appeared in the objective nowhere. Both omissions push
 * the same way, away from premiums: a bench place valued at par means bench fodder is never fodder,
 * so the money that would buy the marginal premium goes into a fourth £5.0m defender; and a captain
 * worth nothing at selection time means the one slot that pays twice is bought at single price.
 * Measured on the live GW2 solve before this changed, the four bench players carried 22.8% of the
 * objective and 20% of the budget.
 *
 * **The program, as `fpl-optimizer` specifies it:**
 *
 * ```
 *   maximise  Σ EP_p (y_p + c_p)  +  benchWeight · Σ EP_p (x_p − y_p)  −  λ · Σ d
 *   s.t.      Σ x = 15,  squad quotas on x,  budget,  ≤ 3 per club
 *             y_p ≤ x_p,  Σ y = 11,  formation min/max on y
 *             c_p ≤ y_p,  Σ c = 1
 *             d_ij ≥ y_i + y_j − 1     two of our defensive players STARTING for the same club
 * ```
 *
 * Collected per variable, the coefficients are `benchWeight · ep` on `x`, `(1 − benchWeight) · ep`
 * on `y`, and `ep` on `c`. Selecting a player into the XI therefore *reduces* his bench value, which
 * is right: a player you start cannot auto-sub in.
 *
 * **The penalty is on defensive concentration, and B-029 replaced a fixture-collision rule with it.**
 * The old rule charged a squad for owning one of our attackers against one of our defenders in the
 * same match. B-028 measured that over 101,103 pairs: real (correlation −0.195) but a HEDGE, cutting
 * the pair's variance by 19.5%, while two defensive players of one club covary +5.58 and were charged
 * nothing at all. So the row prices what concentrates a squad rather than what spreads it.
 *
 * **It keys off `y`, and the contrast with what it replaced is the lesson.** B-011's charge belonged
 * on `x` because the bet was *buying* both sides, and B-023's attempt to key it to the XI was dodged
 * by benching. Concentration is the opposite case: a benched player scores nothing and carries no
 * variance, so benching genuinely answers this charge. Key a charge to the decision you want to
 * change.
 */
/**
 * Which objective the squad program maximises. **A measurement knob, never a serving one.**
 *
 * `xi-bench-captain` is what the product solves and what every caller gets by default:
 * `Σ EP(y + c) + benchWeight × Σ EP(x − y) − λ Σ d`, landed in B-023 and amended by B-029.
 *
 * `all-fifteen-equal` is the objective B-023 REPLACED — `Σ EP × x`, every one of the fifteen worth
 * the same, no armband priced and no concentration charged. It exists so the replacement can be
 * measured against what it replaced (B-031), which had never been done: between the commit that
 * adopted v3 and the commit that rewrote this objective, the model's own simulated fifteen went from
 * 26 points ahead of the crowd proxy to 47 behind, and nobody knew whether the rewrite was the cause.
 *
 * **The feasible set is identical under both.** Only the objective row changes: the `y` and `k`
 * columns and every constraint on them stay, so one program is solved two ways rather than two
 * programs being compared. Under `all-fifteen-equal` those columns carry a zero coefficient, which
 * means the solver has no opinion about the XI — exactly the pre-B-023 behaviour, where the eleven
 * was chosen afterwards and not by the LP. A caller that reads `xi` or `captainKey` off an
 * `all-fifteen-equal` solve is reading an arbitrary feasible answer, and must not.
 */
export type SquadObjective = 'xi-bench-captain' | 'all-fifteen-equal';

export function buildLp(
  candidates: Candidate[],
  rules: Rules,
  concentration: Concentration = NO_CONCENTRATION,
  /**
   * Defaults to the SERVED weight, not to 0.
   *
   * It defaulted to 0 while B-023 was landing, which meant every caller that forgot the argument
   * solved the pre-B-023 objective and got a plausible squad back — a bench valued at par, a captain
   * worth nothing at selection time, and no tell. The collision charge no longer depends on it
   * (B-026), so a forgotten argument is merely wrong rather than silently disarming, which is still
   * reason enough to default to what is served.
   */
  benchWeight = BENCH_WEIGHT,
  /** Defaults to what is served. See `SquadObjective` — the other value is for harnesses only. */
  objective: SquadObjective = 'xi-bench-captain',
): string {
  const clubs = [...new Set(candidates.map((c) => c.teamId))];
  const inPos = (pos: PositionCode) =>
    candidates.filter((c) => c.position === pos);
  const inClub = (teamId: string) =>
    candidates.filter((c) => c.teamId === teamId);

  // A name mentioned anywhere in an LP file is implicitly declared, so a `d` row naming a player who
  // is not in this LP would silently create a free variable with a zero objective and a constraint
  // that can never bind. Pairs may be built over a wider set than this solve (insights needs the ones
  // involving players a user holds); only the pairs the solver can act on are emitted here.
  const inLp = new Set(candidates.map((c) => c.key));
  const pairs =
    concentration.lambda === 0
      ? []
      : concentration.pairs.filter(
          (p) => inLp.has(p.a.key) && inLp.has(p.b.key),
        );

  const xi = (c: Candidate) => `y_${c.key}`;
  const cap = (c: Candidate) => `k_${c.key}`;

  const lines: string[] = [];
  lines.push('Maximize');
  lines.push(
    ' obj: ' +
      signedExpr(
        objective === 'all-fifteen-equal'
          ? candidates.map((c) => ({ coef: c.ep, name: c.key }))
          : [
              ...candidates.map((c) => ({
                coef: benchWeight * c.ep,
                name: c.key,
              })),
              ...candidates.map((c) => ({
                coef: (1 - benchWeight) * c.ep,
                name: xi(c),
              })),
              ...candidates.map((c) => ({ coef: c.ep, name: cap(c) })),
              ...pairs.map((_, i) => ({
                coef: -concentration.lambda,
                name: `d_${i}`,
              })),
            ],
      ),
  );

  lines.push('Subject To');
  lines.push(
    ` squad: ${expr(candidates.map((c) => c.key))} = ${rules.squadSize()}`,
  );
  for (const pos of POSITIONS) {
    lines.push(
      ` sel_${pos}: ${expr(inPos(pos).map((c) => c.key))} = ${rules.squadSelect(pos)}`,
    );
  }
  lines.push(
    ` budget: ${expr(candidates.map((c) => `${c.cost} ${c.key}`))} <= ${rules.budget()}`,
  );
  for (const teamId of clubs) {
    lines.push(
      ` club_${teamId}: ${expr(inClub(teamId).map((c) => c.key))} <= ${rules.clubLimit()}`,
    );
  }

  // --- The XI and the armband.
  lines.push(` xi: ${expr(candidates.map((c) => xi(c)))} = ${rules.xiSize()}`);
  lines.push(` captain: ${expr(candidates.map((c) => cap(c)))} = 1`);
  for (const pos of POSITIONS) {
    const inThis = inPos(pos).map((c) => xi(c));
    if (inThis.length === 0) continue;
    lines.push(` play_min_${pos}: ${expr(inThis)} >= ${rules.minPlay(pos)}`);
    lines.push(` play_max_${pos}: ${expr(inThis)} <= ${rules.maxPlay(pos)}`);
  }
  for (const c of candidates) {
    // You cannot start a player you do not own, or captain one you do not start.
    lines.push(` own_${c.key}: ${xi(c)} - ${c.key} <= 0`);
    lines.push(` armband_${c.key}: ${cap(c)} - ${xi(c)} <= 0`);
  }

  // One row per pair of our defensive players STARTING for the same club. On `y`, deliberately: a
  // benched player carries no variance, so benching is a legitimate answer to this charge — unlike
  // B-011's, which was about having bought both sides and belonged on `x`.
  //
  // d stays CONTINUOUS and out of the Binary section: the `-lambda` objective pushes it to its lower
  // bound, so it lands on 0 unless its row forces it up, and the LP relaxation of a binary is not
  // needed.
  pairs.forEach((p, i) => {
    lines.push(` conc_${i}: ${xi(p.a)} + ${xi(p.b)} - d_${i} <= 1`);
  });

  // Only when there is something to bound. An empty `Bounds` header followed straight by `Binary` is
  // not a section, it is a header the parser has to guess at — and a guess in an LP file becomes a
  // different program, silently.
  if (pairs.length > 0) {
    lines.push('Bounds');
    for (let i = 0; i < pairs.length; i++) lines.push(` d_${i} >= 0`);
  }

  lines.push('Binary');
  // Binary section lists variable names only — no '+' operators.
  lines.push(
    '  ' +
      [
        ...candidates.map((c) => c.key),
        ...candidates.map((c) => xi(c)),
        ...candidates.map((c) => cap(c)),
      ].join('\n  '),
  );
  lines.push('End');
  return lines.join('\n');
}

export interface XiResult {
  starters: Set<string>; // candidate keys
  formation: string; // "DEF-MID-FWD"
  captainKey: string | undefined;
  viceKey: string | undefined;
  /** EP of the XI plus the captain's double */
  rawEp: number;
}

/**
 * `penaltyPoints` and `collisions` used to live on `XiResult` and are deliberately gone (B-025).
 *
 * Nothing is charged against an XI any more, so both would have been zero and empty on every
 * arrangement the optimizer produces — a field that can only report one value is not a report, it is
 * a number that looks healthy because it cannot be anything else. What a pair costs is a fact about
 * the fifteen, and `arrangeSquad` states it there.
 */

/** Every k-subset of a list, as index combinations. */
function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

/**
 * Best legal starting XI from the chosen 15, with its captain — exactly 1 GKP and a DEF/MID/FWD split
 * within each position's min/max play that sums to 10 outfield.
 *
 * **Exact subset enumeration rather than top-EP-per-position, and the reason changed with B-025.**
 * The original reason was the pairwise collision penalty: once holding two players costs more than
 * holding each, the penalty-optimal XI may want the 4th-best defender over the 3rd, and picking the
 * top of each position can never find that. The penalty is on ownership now, so the XI is separable
 * again and a greedy pick would in fact agree. The enumeration stays because it is `2 × C(5,d) ×
 * C(5,m) × C(3,f)` — a few thousand combinations, trivially cheap — and because it is the second
 * implementation the served solve is checked against in `optimizer.service`. A greedy version would
 * be a check that agrees with the LP for a weaker reason.
 *
 * **The XI carries the concentration charge (B-029), and it is the only penalty left in the
 * objective.** `d_ij ≥ y_i + y_j − 1` charges λ for every pair of our defensive players starting for
 * the same club, so which eleven is chosen changes the objective and this enumeration has to score it
 * or it will disagree with the LP about who plays. The armband carries no charge of its own: B-027's
 * captain rows went with B-011 when B-028 measured the collision to be a hedge.
 */
export function pickBestXi(
  squad: Candidate[],
  rules: Rules,
  /**
   * The same bench weight the squad LP uses (B-023).
   *
   * It matters here even though the fifteen is already fixed. `Σ EP·x` is then a constant, but the
   * `− benchWeight · Σ EP·y` half of the bench term is not: starting a player REMOVES his bench
   * value, because a player you start cannot auto-sub in. Scoring the XI without it would make this
   * function maximise a different expression from the solve that chose the fifteen, and the two
   * would disagree on which XI is best — which is precisely what this function exists to prevent.
   */
  benchWeight = BENCH_WEIGHT,
  /**
   * The concentration context (B-029) — which of these fifteen would be two of one club's defence.
   *
   * Scored here because it keys off `y`: the charge depends on which eleven is picked, so an
   * enumeration that ignored it would return a different eleven from the solve and the drift warning
   * in `optimizer.service` would fire on every request.
   */
  concentration: Concentration = NO_CONCENTRATION,
): XiResult {
  // The eleven and the armband are priced on THIS gameweek where the candidates carry it.
  const xiEp = (c: Candidate): number => c.epNext ?? c.ep;
  const byPos = (pos: PositionCode) =>
    squad
      .filter((c) => c.position === pos)
      .sort((a, b) => xiEp(b) - xiEp(a));
  const gk = byPos('GKP');
  const def = byPos('DEF');
  const mid = byPos('MID');
  const fwd = byPos('FWD');

  // Only the pairs both of whose members this fifteen actually holds can ever be charged.
  const held = new Set(squad.map((c) => c.key));
  const heldPairs = pairsWithin(held, concentration.pairs);
  // `lambda` is a POLICY number in HORIZON points (B-029, B-033: one point over five gameweeks per
  // pair started together). When the eleven is priced on this gameweek alone the charge has to be
  // brought into the same units, or a rule measured as "inert on the fifteen, 71 projected points
  // over a season on the eleven" would silently become four times as strong. Scaled by the ratio of
  // this week's projection to the horizon's over the fifteen, so its bite relative to a player's
  // value is exactly what was measured; with no `epNext` anywhere the ratio is 1.
  const horizonTotal = squad.reduce((s, c) => s + c.ep, 0);
  const weekTotal = squad.reduce((s, c) => s + xiEp(c), 0);
  const lambda =
    concentration.lambda *
    (horizonTotal > 0 && weekTotal > 0 ? weekTotal / horizonTotal : 1);

  let best: (XiResult & { score: number }) | null = null;

  const consider = (chosen: Candidate[], formation: string) => {
    const baseEp = chosen.reduce((s, c) => s + xiEp(c), 0);
    const starting = new Set(chosen.map((c) => c.key));
    const charge = lambda * pairsWithin(starting, heldPairs).length;

    // The armband goes to the best projection in the eleven. Nothing charges it since B-029 — the
    // captain's collision rows went with the rule they belonged to.
    const scored = [...chosen].sort((a, b) => xiEp(b) - xiEp(a));
    const captain = scored[0];
    const vice = scored[1];
    if (!captain) return;

    // The LP's expression exactly: (1 − w)·Σ EP·y + EP·captain − λ·Σ d. The constant w·Σ EP·x is
    // dropped because the fifteen is fixed here and a constant cannot change an argmax.
    const score = (1 - benchWeight) * baseEp + xiEp(captain) - charge;

    if (!best || score > best.score) {
      best = {
        starters: starting,
        formation,
        captainKey: captain.key,
        viceKey: vice?.key,
        rawEp: baseEp + xiEp(captain),
        score,
      };
    }
  };

  for (
    let d = rules.minPlay('DEF');
    d <= Math.min(rules.maxPlay('DEF'), def.length);
    d++
  ) {
    for (
      let m = rules.minPlay('MID');
      m <= Math.min(rules.maxPlay('MID'), mid.length);
      m++
    ) {
      const f = rules.xiSize() - 1 - d - m; // outfield left for FWD
      if (
        f < rules.minPlay('FWD') ||
        f > Math.min(rules.maxPlay('FWD'), fwd.length)
      )
        continue;
      const formation = `${d}-${m}-${f}`;
      for (const g of combinations(gk, 1))
        for (const ds of combinations(def, d))
          for (const ms of combinations(mid, m))
            for (const fs of combinations(fwd, f))
              consider([...g, ...ds, ...ms, ...fs], formation);
    }
  }
  if (!best) throw new Error('no legal XI from the chosen squad');
  const { score: _score, ...result } = best as XiResult & { score: number };
  return result;
}

/**
 * What HiGHS hands back, as much of it as anything here reads.
 *
 * Declared structurally rather than imported: the `highs` package's own types describe a solved
 * model in more generality than this file needs, and a narrow local shape is what lets `readSolution`
 * be unit-tested without loading a WASM solver.
 */
export interface LpSolution {
  Status: string;
  ObjectiveValue: number;
  /**
   * `Primal` is OPTIONAL because an infeasible solve really does hand back columns without one —
   * that is HiGHS's own declared shape (`HighsInfeasibleSolutionColumn` has no `Primal` at all), not
   * defensiveness. `Index` is listed only so this stays a structural match for both of the package's
   * column types: a shape whose every property is optional is a *weak* type, and TypeScript refuses
   * to assign anything with no property in common with it. Requiring `Primal` instead would have
   * forced every caller to cast, and a cast is exactly how "we never checked the status" gets
   * written.
   */
  Columns: Record<string, { Index: number; Primal?: number } | undefined>;
}

/** A solved squad program, read back into the domain. */
export interface SolvedSquad {
  squad: Candidate[];
  /** the eleven the SOLVER chose — its own `y` columns, not a re-derivation */
  xi: Set<string>;
  /** the armband the SOLVER chose — its own `k` column */
  captainKey: string;
  /** "DEF-MID-FWD" of the solver's XI */
  formation: string;
  objective: number;
}

/**
 * Read a solved `buildLp` back into candidates, XI and armband — one implementation, three callers.
 *
 * **Every caller used to read the columns itself, and each read a different subset.** The served
 * optimizer read `x` and `y`; the season simulator read `x` alone; nothing read `k`. A harness that
 * wants to score the eleven the objective actually chose cannot be built on top of three partial
 * readers that may disagree, so the reading happens once, here.
 *
 * **It validates, and that is the point rather than a courtesy.** A solver that returns anything but
 * `Optimal` still returns a `Columns` object, and reading it yields a squad of whatever happened to
 * be there — usually nothing, occasionally something plausible. The failure then surfaces hundreds of
 * lines later as "no legal XI from this squad", which is a true statement about an empty squad and
 * says nothing about why. Worse for the replay harness: a silently short XI would be scored, and a
 * ten-man lineup quietly loses points that would read as the objective being bad.
 */
export function readSolution(
  candidates: Candidate[],
  solution: LpSolution,
  rules: Rules,
): SolvedSquad {
  if (solution.Status !== 'Optimal') {
    throw new Error(
      `the squad solve returned ${solution.Status} over ${candidates.length} candidates`,
    );
  }
  const on = (name: string) => (solution.Columns[name]?.Primal ?? 0) > 0.5;

  const squad = candidates.filter((c) => on(c.key));
  if (squad.length !== rules.squadSize()) {
    throw new Error(
      `the squad solve returned ${squad.length} players, expected ${rules.squadSize()}`,
    );
  }

  const xiMembers = candidates.filter((c) => on(`y_${c.key}`));
  if (xiMembers.length !== rules.xiSize()) {
    throw new Error(
      `the squad solve returned an XI of ${xiMembers.length}, expected ${rules.xiSize()}`,
    );
  }
  const inSquad = new Set(squad.map((c) => c.key));
  const stray = xiMembers.find((c) => !inSquad.has(c.key));
  if (stray) {
    throw new Error(
      `the squad solve started ${stray.webName}, who is not in the fifteen it chose`,
    );
  }

  const captains = candidates.filter((c) => on(`k_${c.key}`));
  if (captains.length !== 1) {
    throw new Error(
      `the squad solve returned ${captains.length} captains, expected exactly 1`,
    );
  }
  const captainKey = captains[0].key;
  if (!xiMembers.some((c) => c.key === captainKey)) {
    throw new Error(
      `the squad solve captained ${captains[0].webName}, who is not in the eleven it started`,
    );
  }

  const count = (pos: PositionCode) =>
    xiMembers.filter((c) => c.position === pos).length;
  for (const pos of POSITIONS) {
    const n = count(pos);
    if (n < rules.minPlay(pos) || n > rules.maxPlay(pos)) {
      throw new Error(
        `the squad solve started ${n} ${pos}, outside the legal ` +
          `${rules.minPlay(pos)}-${rules.maxPlay(pos)}`,
      );
    }
  }

  return {
    squad,
    xi: new Set(xiMembers.map((c) => c.key)),
    captainKey,
    formation: `${count('DEF')}-${count('MID')}-${count('FWD')}`,
    objective: solution.ObjectiveValue,
  };
}
