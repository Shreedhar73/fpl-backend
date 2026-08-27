import { PositionCode } from '../fpl-sync/mappers';
import { Rules, POSITIONS } from './rules';
import { ATTACKING_POSITIONS, DEFENSIVE_POSITIONS } from './policy';
import { FixtureLite } from './optimizer.repository';

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
  pPlay: number;
  /** Premier League appearances (gameweek rows with minutes > 0), archive + this season — B-010. */
  appearances: number;
}

/**
 * Two of our own players betting on opposite outcomes of one match: one of our attackers against one
 * of our defenders, in the same fixture (B-011).
 *
 * The projections are honest marginally and the squad is still wrong, because a linear objective
 * cannot see the correlation — the clean sheet that pays the defender is the one where the attacker
 * blanks. This is not a joint-distribution model and does not claim to be one; it is a priced
 * refusal to hold both sides.
 */
export interface ConflictPair {
  attacker: Candidate;
  defender: Candidate;
  /**
   * The match, as a human reads it — "CHE vs BHA", home side first.
   *
   * Plan 009 specified this field and what shipped emitted two team cuids instead, which is why
   * nothing could render the payload: a cuid on screen is worse than an omission, because it looks
   * like data. Built here, where both sides of the fixture are in hand, rather than looked up later.
   */
  fixture: string;
}

/**
 * Every conflicting pair in a candidate set, over the fixtures of ONE gameweek.
 *
 * Only the first horizon gameweek is used by the caller: a collision three gameweeks out is answered
 * by a transfer, not by refusing to own the player (B-008 territory). A double gameweek yields the
 * pairs of both fixtures — a team appearing twice simply contributes twice — and a blank yields
 * none, so neither needs a special case here.
 *
 * Attacker is FWD or MID, defensive is DEF or GKP (`policy.ts`). Both directions of every fixture.
 */
export function buildConflictPairs(
  candidates: Candidate[],
  fixtures: FixtureLite[],
): ConflictPair[] {
  const attacking = new Set<string>(ATTACKING_POSITIONS);
  const defensive = new Set<string>(DEFENSIVE_POSITIONS);
  const byTeam = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byTeam.get(c.teamId) ?? [];
    list.push(c);
    byTeam.set(c.teamId, list);
  }
  const of = (teamId: string) => byTeam.get(teamId) ?? [];

  const pairs: ConflictPair[] = [];
  const oneWay = (attackTeam: string, defendTeam: string, fixture: string) => {
    for (const attacker of of(attackTeam)) {
      if (!attacking.has(attacker.position)) continue;
      for (const defender of of(defendTeam)) {
        if (!defensive.has(defender.position)) continue;
        pairs.push({ attacker, defender, fixture });
      }
    }
  };
  for (const f of fixtures) {
    // One label per fixture, home side first, whichever direction the pair runs in. A pair is
    // "our attacker against our defender in this match"; the match does not change when the roles do.
    const label = `${f.homeTeamShortName} vs ${f.awayTeamShortName}`;
    oneWay(f.homeTeamId, f.awayTeamId, label);
    oneWay(f.awayTeamId, f.homeTeamId, label);
  }
  return pairs;
}

/** The penalty context a solve and an arrangement share, so the two can never disagree. */
export interface Collisions {
  pairs: ConflictPair[];
  lambda: number;
}

export const NO_COLLISIONS: Collisions = { pairs: [], lambda: 0 };

/** The pairs both of whose endpoints are held by a given set of candidate keys. */
export function pairsWithin(
  keys: Set<string>,
  pairs: ConflictPair[],
): ConflictPair[] {
  return pairs.filter(
    (p) => keys.has(p.attacker.key) && keys.has(p.defender.key),
  );
}

/**
 * The quantity the ILP actually maximises over a 15: raw horizon EP less the collision penalty.
 *
 * Exported because `insights` compares a user's squad against the recommendation, and comparing a
 * penalised optimum against an unpenalised squad is what makes a legitimately negative gap look like
 * a bug (Phase 3 of the plan).
 */
export function penalisedSquadEp(
  squad: Candidate[],
  collisions: Collisions,
): number {
  const raw = squad.reduce((s, c) => s + c.ep, 0);
  const keys = new Set(squad.map((c) => c.key));
  return raw - collisions.lambda * pairsWithin(keys, collisions.pairs).length;
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

export function buildLp(
  candidates: Candidate[],
  rules: Rules,
  collisions: Collisions = NO_COLLISIONS,
): string {
  const clubs = [...new Set(candidates.map((c) => c.teamId))];
  const inPos = (pos: PositionCode) =>
    candidates.filter((c) => c.position === pos);
  const inClub = (teamId: string) =>
    candidates.filter((c) => c.teamId === teamId);

  // A name mentioned anywhere in an LP file is implicitly declared, so a `z` row naming a player who
  // is not in this LP would silently create a free variable with a zero objective and a constraint
  // that can never bind. Pairs are built over the whole universe (insights needs the ones involving
  // players a user holds); only the pairs the solver can actually act on are emitted here.
  const inLp = new Set(candidates.map((c) => c.key));
  const pairs =
    collisions.lambda === 0
      ? []
      : collisions.pairs.filter(
          (p) => inLp.has(p.attacker.key) && inLp.has(p.defender.key),
        );

  const lines: string[] = [];
  lines.push('Maximize');
  lines.push(
    ' obj: ' +
      signedExpr([
        ...candidates.map((c) => ({ coef: c.ep, name: c.key })),
        ...pairs.map((_, i) => ({ coef: -collisions.lambda, name: `z_${i}` })),
      ]),
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
  // z >= x_i + x_j - 1, written so the solver reads it as a linear row. `z` stays CONTINUOUS and out
  // of the Binary section: the `-lambda*z` objective pushes it to its lower bound, so it lands on 0
  // unless both players are taken, and the LP relaxation of a binary is not needed.
  pairs.forEach((p, i) => {
    lines.push(
      ` conf_${i}: ${p.attacker.key} + ${p.defender.key} - z_${i} <= 1`,
    );
  });

  lines.push('Binary');
  // Binary section lists variable names only — no '+' operators.
  lines.push('  ' + candidates.map((c) => c.key).join('\n  '));
  lines.push('End');
  return lines.join('\n');
}

export interface XiResult {
  starters: Set<string>; // candidate keys
  formation: string; // "DEF-MID-FWD"
  captainKey: string | undefined;
  viceKey: string | undefined;
  /** raw EP of the XI plus the captain's double, before the penalty */
  rawEp: number;
  /** the collision points charged against this XI, captain doubling included */
  penaltyPoints: number;
  collisions: ConflictPair[];
}

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
 * **Exact subset enumeration, not top-EP-per-position.** A pairwise penalty breaks separability: once
 * holding two players costs more than the sum of holding each, the penalty-optimal XI may want the
 * 4th-best defender over the 3rd, and picking the top of each position can never find that. The
 * enumeration is `2 × C(5,d) × C(5,m) × C(3,f)` over a 15-man squad — a few thousand combinations,
 * still trivial. Both keepers are enumerated because a keeper is a defensive position and collides.
 *
 * **The captain is chosen here, not afterwards, and his collision counts twice.** The captain doubles,
 * so a captain colliding with two of our own starting defenders is the worst version of this — and a
 * captain picked by raw EP after the XI is fixed cannot see it. Doubling his exposure alongside his
 * points is a policy choice, consistent with `COLLISION_LAMBDA` itself being one: it says the stake
 * on that correlated outcome is what doubled, not just the reward. The vice is the runner-up on the
 * same penalised score.
 */
export function pickBestXi(
  squad: Candidate[],
  rules: Rules,
  collisions: Collisions = NO_COLLISIONS,
): XiResult {
  const byPos = (pos: PositionCode) =>
    squad.filter((c) => c.position === pos).sort((a, b) => b.ep - a.ep);
  const gk = byPos('GKP');
  const def = byPos('DEF');
  const mid = byPos('MID');
  const fwd = byPos('FWD');

  const held = new Set(squad.map((c) => c.key));
  const relevant = collisions.pairs.filter(
    (p) => held.has(p.attacker.key) && held.has(p.defender.key),
  );

  let best: (XiResult & { score: number }) | null = null;

  const consider = (chosen: Candidate[], formation: string) => {
    const keys = new Set(chosen.map((c) => c.key));
    const inXi = relevant.filter(
      (p) => keys.has(p.attacker.key) && keys.has(p.defender.key),
    );
    const conflictsOf = (key: string) =>
      inXi.filter((p) => p.attacker.key === key || p.defender.key === key)
        .length;

    const baseEp = chosen.reduce((s, c) => s + c.ep, 0);
    const scored = chosen
      .map((c) => ({
        c,
        // what adding the armband to this player is worth, net of doubling his exposure
        gain: c.ep - collisions.lambda * conflictsOf(c.key),
      }))
      .sort((a, b) => b.gain - a.gain);
    const captain = scored[0];
    const vice = scored[1];
    if (!captain) return;

    const penaltyPoints =
      collisions.lambda * (inXi.length + conflictsOf(captain.c.key));
    const rawEp = baseEp + captain.c.ep;
    const score = rawEp - penaltyPoints;

    if (!best || score > best.score) {
      best = {
        starters: keys,
        formation,
        captainKey: captain.c.key,
        viceKey: vice?.c.key,
        rawEp,
        penaltyPoints,
        collisions: inXi,
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
