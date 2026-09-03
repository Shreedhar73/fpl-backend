import { Injectable, Logger } from '@nestjs/common';
import highsLoader from 'highs';
import { PositionCode } from '../fpl-sync/mappers';
import { OptimizerRepository } from './optimizer.repository';
import {
  buildLp,
  pickBestXi,
  defencePairs,
  Candidate,
  Concentration,
  DefencePair,
  NO_CONCENTRATION,
  pairsWithin,
  readSolution,
  SolvedSquad,
} from './ilp';
import { POSITIONS, Rules } from './rules';
import {
  MIN_APPEARANCES,
  DEFENCE_CONCENTRATION_LAMBDA,
  BENCH_WEIGHT,
  HORIZON,
  HORIZON_DECAY as DECAY,
} from './policy';

export const OPTIMIZER_VERSION = 'v1-ilp';

/** Candidate-pool pruning: the top-EP players per position plus the cheapest few (budget enablers and
 * bench fodder). A player outside both sets is dominated and never in an optimal squad — this keeps the
 * solve fast without changing the answer. */
const POOL_TOP = 32;
const POOL_CHEAP = 8;

export interface SquadPlayer {
  playerId: string;
  webName: string;
  position: PositionCode;
  cost: number;
  ep: number;
  role: 'captain' | 'vice' | 'starter' | 'bench';
  benchOrder?: number; // 1..4 for bench
}

export interface OptimizeSummary {
  gameweekIds: number[];
  singleGw: boolean;
  objectiveValue: number;
  totalCost: number;
  formation: string; // e.g. "3-4-3"
  squad: SquadPlayer[];
  /** null when the solve was not persisted — see `run({ persist: false })`. */
  runId: string | null;
  durationMs: number;
  /** Why this squad and not another. The same object that is persisted — see below. */
  reasoning: RecommendationReasoning;
}

/**
 * What the optimizer REFUSED, and what it paid for what it kept (B-018).
 *
 * Two guards change every recommendation and were invisible outside `optimizer_runs.reasoning`: a
 * user reading the squad saw only that a player was absent and that someone else had the armband.
 * D-019's rule is that a model number states where it came from; a model *refusal* is a stronger
 * claim than a number and was stating nothing.
 *
 * **Returned as well as persisted, from one object.** The persisted JSON and the API payload used to
 * be built separately, which is how the persisted one came to carry team cuids where plan 009
 * specified a fixture label — a defect that only surfaces when somebody tries to render it.
 */
export interface RecommendationReasoning {
  appearanceFloor: {
    /** minimum appearances to enter the pool at all */
    threshold: number;
    /** how many of the league's players that removed */
    excluded: number;
    /**
     * Horizon EP the floor cost, against the same solve with the floor lifted and lambda unchanged.
     * `null` when it was not computed — it is a second ILP solve, so an advice request that only
     * needs the list does not pay for it.
     */
    costEp: number | null;
    /** the excluded players an unguarded solve would actually have picked */
    wouldHaveMadeTheSquad: {
      playerId: string;
      webName: string;
      position: PositionCode;
      teamShortName: string;
      appearances: number;
      epHorizon: number;
    }[];
    /** what the guard IS, in the payload rather than only in the component that renders it */
    statement: string;
  };
  defenceConcentration: {
    /** horizon EP charged per same-club defensive pair the eleven STARTS */
    lambda: number;
    /** pairs the fifteen holds, started or not */
    pairsHeld: number;
    /** horizon EP charged, which is for the started ones only */
    penaltyEp: number;
    started: { club: string; players: string[]; lambda: number }[];
    /** held but not both started — carries no charge, and a user should still see it */
    benched: { club: string; players: string[] }[];
    statement: string;
  };
}

/**
 * The two sentences that must travel WITH the numbers.
 *
 * The measurement behind these two guards is split, and a UI that presents them alike would state
 * the opposite of what is known. The floor is a refusal to bet on players the model cannot measure.
 * The collision penalty was swept over 103 archived gameweeks and earned nothing: +0.59 +/- 0.92
 * realised points per gameweek, per-season signs that flip, and the downside it was argued for as
 * insurance got worse. It stays on as a policy choice.
 *
 * They live here rather than in the frontend because a component can be rewritten by someone who
 * never reads `reports/guards-009.md`, and the honest version would quietly become the confident one.
 */
const FLOOR_STATEMENT =
  `A player with fewer than ${MIN_APPEARANCES} Premier League appearances has a per-90 rate ` +
  'estimated from almost nothing. The optimizer is a maximiser, so it hunts exactly the players ' +
  'whose estimate is most inflated by noise. This is a refusal to bet on them, not a claim that ' +
  'they are bad.';
const CONCENTRATION_STATEMENT =
  "Two of one club's defence starting together share a single clean sheet. Measured over three " +
  'archived seasons their points move together (+5.58 covariance) — the most concentrated position ' +
  'a squad can take. The charge applies to STARTING both, not to owning both: a benched player ' +
  'carries no exposure. This is a POLICY choice, not a measured gain — what was measured is that ' +
  'the correlation exists and which way it points, never that a narrower squad scores more. It ' +
  'replaced a rule that charged for owning both sides of one fixture, which the same measurement ' +
  "showed to be a hedge (-0.195 correlation, cutting a pair's variance by a fifth).";

/**
 * Everything a solve reasons over, built once: every player as a candidate carrying horizon EP and
 * next-gameweek play probability, plus the rules and the gameweeks in the horizon.
 *
 * Exposed because `insights` has to score a squad the optimizer did not choose, and it must do so
 * over exactly the same numbers — a comparison against a differently-built universe would report a
 * gap that is partly an artefact of the two builds disagreeing.
 */
export interface Universe {
  candidates: Candidate[];
  rules: Rules;
  gameweekIds: number[];
  modelVersion: string;
  /**
   * The concentration context, built over EVERY candidate — not just the pool. `insights` scores
   * squads the optimizer did not choose, and a pair involving a player the pool pruned is still a
   * pair that squad is holding. Carried on the universe for the reason the universe exists at all:
   * two sides arranged under different objectives report a gap that is partly an artefact of the two
   * builds disagreeing.
   */
  concentration: Concentration;
}

/**
 * A pair of our defensive players from one club that the squad holds, and whether both took the field.
 *
 * Both facts are reported because only one of them is charged (B-029): starting two of a club's
 * defence is the concentrated position, and holding one on the bench is not. A payload that reported
 * only the charged pairs would tell a user nothing about the £5.0m defender sitting behind the two
 * who play.
 */
export interface HeldPair {
  pair: DefencePair;
  bothStarted: boolean;
}

/**
 * Arrange a set of 15 into a legal XI, a captain, a vice and an ordered bench. Pure, and the only
 * implementation — `run()` calls it for the squad it solved and `insights` calls it for the squad a
 * user brought, so the two can never disagree about what "best XI" means.
 *
 * Bench order is a real decision, not presentation: auto-subs walk the bench in slot order and the
 * first eligible player comes on. The reserve keeper is pinned to slot 12 (only a keeper can replace
 * a keeper) and the outfielders follow in descending `P(plays) × EP`, best substitute first.
 */
export function arrangeSquad(
  inSquad: Candidate[],
  rules: Rules,
  concentration: Concentration = NO_CONCENTRATION,
  /** The squad LP's bench weight, so an arrangement and a solve optimise one expression (B-023). */
  benchWeight = BENCH_WEIGHT,
): {
  squad: SquadPlayer[];
  formation: string;
  /** the same-club defensive pairs the FIFTEEN holds, and whether the XI started both */
  heldPairs: HeldPair[];
  /** horizon EP charged, which is for the STARTED ones only */
  concentrationPenalty: number;
} {
  // The captain comes back from the enumeration rather than being picked afterwards, so that the XI
  // and the armband are one decision here exactly as they are one decision in the LP.
  const { starters, formation, captainKey, viceKey } = pickBestXi(
    inSquad,
    rules,
    benchWeight,
    concentration,
  );

  const held = new Set(inSquad.map((c) => c.key));
  const heldPairs: HeldPair[] = pairsWithin(held, concentration.pairs).map(
    (pair) => ({
      pair,
      bothStarted: starters.has(pair.a.key) && starters.has(pair.b.key),
    }),
  );
  // Only the started ones are charged — the charge keys off `y`, and a benched player carries no
  // variance. That is the difference from B-011, where benching answered nothing.
  // Reported in horizon points, the unit `lambda` is declared in — the enumeration scales the
  // charge into this week's units to choose, and this is what it costs over the horizon.
  const concentrationPenalty =
    concentration.lambda * heldPairs.filter((h) => h.bothStarted).length;

  const bench = inSquad.filter((c) => !starters.has(c.key));
  const benchGk = bench.filter((c) => c.position === 'GKP');
  const benchOut = bench
    .filter((c) => c.position !== 'GKP')
    // Tie-broken on the LP key (B-039), which is `p_<playerId>` and unique. Bench order is
    // auto-substitution priority, and two equally-rated bench players resolved by candidate array
    // order means the served recommendation can differ between two identical solves.
    .sort(
      (a, b) =>
        b.pPlay * (b.epNext ?? b.ep) - a.pPlay * (a.epNext ?? a.ep) ||
        a.key.localeCompare(b.key),
    );
  const benchOrdered = [...benchGk, ...benchOut];

  const squad: SquadPlayer[] = inSquad.map((c) => {
    const isStarter = starters.has(c.key);
    const benchIdx = benchOrdered.findIndex((b) => b.key === c.key);
    const role: SquadPlayer['role'] =
      c.key === captainKey
        ? 'captain'
        : c.key === viceKey
          ? 'vice'
          : isStarter
            ? 'starter'
            : 'bench';
    return {
      playerId: c.playerId,
      webName: c.webName,
      position: c.position,
      cost: c.cost,
      ep: round2(c.ep),
      role,
      benchOrder: isStarter ? undefined : benchIdx + 1,
    };
  });

  return { squad, formation, heldPairs, concentrationPenalty };
}

/**
 * Solves for the best legal 15 from scratch: assembles candidates (horizon EP, price, position, club),
 * hands the ILP to the solver, and reads back the squad, XI, captain and bench. Knows nothing about
 * Prisma directly. From-scratch buys at market price and plans no transfers — that is B-008.
 */
@Injectable()
export class OptimizerService {
  private readonly log = new Logger(OptimizerService.name);

  constructor(private readonly repo: OptimizerRepository) {}

  /**
   * The squad ruleset, straight from `scoring_config`. Exposed so callers that need one number —
   * the budget, the club limit — do not build a whole universe to reach it.
   */
  async loadRules(): Promise<Rules> {
    return this.repo.loadRules();
  }

  /**
   * Build the candidate universe — every player, with horizon EP and next-gameweek play
   * probability, plus the rules. Public because `insights` scores a user's squad against the same
   * numbers the optimizer used; see `Universe`.
   */
  async buildUniverse(opts: { singleGw?: boolean } = {}): Promise<Universe> {
    const rules = await this.repo.loadRules();
    const modelVersion = await this.repo.latestProjectionModelVersion();
    const allGwIds = await this.repo.horizonGameweeks(HORIZON);
    if (allGwIds.length === 0)
      throw new Error('no upcoming gameweeks to optimise for');
    const gameweekIds = opts.singleGw ? allGwIds.slice(0, 1) : allGwIds;

    const projections = await this.repo.loadProjections(
      modelVersion,
      gameweekIds,
    );
    const players = await this.repo.loadPlayers();
    const appearances = await this.repo.appearanceCounts();

    // horizon EP per player, and next-gameweek play probability
    const epByPlayer = new Map<string, Map<number, number>>();
    const ppByPlayer = new Map<string, number>();
    const nextGw = gameweekIds[0];
    for (const p of projections) {
      const m = epByPlayer.get(p.playerId) ?? new Map<number, number>();
      m.set(p.gameweekId, p.expectedPoints);
      epByPlayer.set(p.playerId, m);
      if (p.gameweekId === nextGw)
        ppByPlayer.set(p.playerId, p.playProbability);
    }
    const horizonEp = (playerId: string): number => {
      const m = epByPlayer.get(playerId);
      if (!m) return 0;
      return gameweekIds.reduce(
        (sum, gw, i) => sum + (m.get(gw) ?? 0) * DECAY ** i,
        0,
      );
    };

    const candidates: Candidate[] = players.map((p) => ({
      key: `p_${p.id}`,
      playerId: p.id,
      webName: p.webName,
      position: p.position,
      teamId: p.teamId,
      teamShortName: p.teamShortName,
      cost: p.nowCost,
      ep: horizonEp(p.id),
      // This gameweek alone, for the eleven and the armband. Absent (a player with no row for the
      // next gameweek — a blank) rather than 0, so the fallback is the horizon and not a zero that
      // would bench him under every rule at once.
      epNext: epByPlayer.get(p.id)?.get(nextGw),
      pPlay: ppByPlayer.get(p.id) ?? 0,
      appearances: appearances.get(p.id) ?? 0,
    }));

    // No fixture lookup any more: a defensive concentration is a property of the SQUAD, not of a
    // gameweek. B-011's collisions had to be built per fixture and only for the first horizon
    // gameweek; two of a club's defence start together in every week they both play (B-029).
    const concentration: Concentration = {
      pairs: defencePairs(candidates),
      lambda: DEFENCE_CONCENTRATION_LAMBDA,
    };

    return { candidates, rules, gameweekIds, modelVersion, concentration };
  }

  async run(
    opts: {
      singleGw?: boolean;
      persist?: boolean;
      /**
       * Compute what the appearance floor COST, which is a second ILP solve over an unguarded pool.
       *
       * Defaults to whatever `persist` does, so a persisted run always records it and a throwaway
       * solve does not pay for it. `insights` turns it on explicitly: the advice payload shows the
       * cost, and a number the user can see is worth one more solve.
       */
      explain?: boolean;
    } = {},
  ): Promise<OptimizeSummary> {
    const started = Date.now();
    opts = { explain: opts.persist !== false, ...opts };
    const { candidates, rules, gameweekIds, modelVersion, concentration } =
      await this.buildUniverse(opts);
    const gwIds = gameweekIds;
    const nextGw = gwIds[0];

    const eligible = candidates.filter((c) => c.appearances >= MIN_APPEARANCES);
    const pool = prunePool(candidates);
    const highs = await highsLoader();
    // One reader for the solved columns, shared with the season simulator and the replay harness
    // (`readSolution`) — it validates the squad, the XI and the armband rather than trusting them.
    const solve = (from: Candidate[]): SolvedSquad =>
      readSolution(
        from,
        highs.solve(buildLp(from, rules, concentration, BENCH_WEIGHT)),
        rules,
      );

    const { squad: inSquad, objective: objectiveValue, xi: lpXi } = solve(pool);

    // What the floor cost, in players rather than in adjectives: the same solve with the floor
    // lifted and LAMBDA unchanged, so the diff isolates B-010 and does not smuggle B-011 into it.
    //
    // Only when the run is persisted. Its one consumer is the reasoning JSON, which an unpersisted
    // run throws away — and `insights` calls `run({ persist: false })` on every advice request, so
    // computing it there is a second ILP solve per request that nothing ever reads.
    const chosen = new Set(inSquad.map((c) => c.key));
    const unguarded =
      opts.explain === false
        ? null
        : solve(prunePool(candidates, { floor: false }));
    const wouldHaveMadeTheSquad = (unguarded?.squad ?? [])
      .filter((c) => !chosen.has(c.key) && c.appearances < MIN_APPEARANCES)
      .map((c) => ({
        playerId: c.playerId,
        webName: c.webName,
        position: c.position,
        teamShortName: c.teamShortName,
        appearances: c.appearances,
        epHorizon: round2(c.ep),
      }));

    // best legal XI, captain, vice and bench order — the same arrangement `insights` applies to a
    // squad the optimizer did not choose.
    const { squad, formation, heldPairs, concentrationPenalty } = arrangeSquad(
      inSquad,
      rules,
      concentration,
    );

    // The LP already chose an XI and an armband on the horizon. The enumeration below re-derives
    // them over the SAME expression — with `epNext` stripped, because the served arrangement above
    // prices the eleven on this gameweek and the LP's columns on the horizon, and a check that
    // compared the two would fire on every solve and prove nothing. What must agree is the LP and
    // an enumeration of its own objective; a disagreement there means a constraint row and the
    // scoring have drifted apart, which neither would report on its own.
    const { starters: horizonXi } = pickBestXi(
      inSquad.map((c) => ({ ...c, epNext: undefined })),
      rules,
      BENCH_WEIGHT,
      concentration,
    );
    const chosenXi = horizonXi;
    if (
      lpXi.size === chosenXi.size &&
      ![...lpXi].every((k) => chosenXi.has(k))
    ) {
      this.log.warn(
        'the solver and the XI enumeration disagree about who starts — they optimise the same ' +
          'expression, so this means a constraint row and the enumeration have drifted apart',
      );
    }

    const totalCost = inSquad.reduce((s, c) => s + c.cost, 0);
    const durationMs = Date.now() - started;

    const reasoning: RecommendationReasoning = {
      appearanceFloor: {
        threshold: MIN_APPEARANCES,
        excluded: candidates.length - eligible.length,
        // The unguarded solve's objective minus this one's, in horizon EP. Both are the SAME solve
        // with lambda unchanged, so the difference isolates B-010 and does not smuggle B-011 into it.
        costEp: unguarded ? round2(unguarded.objective - objectiveValue) : null,
        wouldHaveMadeTheSquad,
        statement: FLOOR_STATEMENT,
      },
      defenceConcentration: {
        lambda: DEFENCE_CONCENTRATION_LAMBDA,
        pairsHeld: heldPairs.length,
        penaltyEp: round2(concentrationPenalty),
        started: heldPairs
          .filter((h) => h.bothStarted)
          .map(({ pair }) => ({
            club: pair.club,
            players: [pair.a.webName, pair.b.webName],
            lambda: DEFENCE_CONCENTRATION_LAMBDA,
          })),
        benched: heldPairs
          .filter((h) => !h.bothStarted)
          .map(({ pair }) => ({
            club: pair.club,
            players: [pair.a.webName, pair.b.webName],
          })),
        statement: CONCENTRATION_STATEMENT,
      },
    };

    // `insights` solves for the optimal 15 on every advice request purely to measure a gap against
    // it. Persisting those would fill optimizer_runs with rows nobody asked for and bury the solves
    // a human actually ran.
    const runId =
      opts.persist === false
        ? null
        : await this.repo.writeRun({
            gameweekId: nextGw,
            modelVersion,
            horizon: gwIds.length,
            objectiveValue,
            durationMs,
            inputs: {
              gwIds,
              decay: DECAY,
              poolSize: pool.length,
              projectionModel: modelVersion,
              minAppearances: MIN_APPEARANCES,
              defenceConcentrationLambda: DEFENCE_CONCENTRATION_LAMBDA,
              // Recorded even though the collision charge no longer reads it: it scales the whole
              // objective, and a run whose stored inputs cannot reconstruct the program is a run
              // nobody can argue with later.
              benchWeight: BENCH_WEIGHT,
            },
            result: { squad, totalCost, formation },
            // The SAME object the caller gets. Built once: the persisted JSON and the API payload
            // used to be assembled separately, which is how the persisted one came to carry team
            // cuids where plan 009 specified a fixture label.
            reasoning: { squad, ...reasoning },
          });

    this.log.log(
      `optimised GW${nextGw} (${opts.singleGw ? 'single' : `horizon ${gwIds.length}`}): ` +
        `${formation}, £${(totalCost / 10).toFixed(1)}m, objective ${objectiveValue.toFixed(2)}, ${durationMs}ms`,
    );
    return {
      gameweekIds: gwIds,
      singleGw: !!opts.singleGw,
      objectiveValue: round2(objectiveValue),
      totalCost,
      formation,
      squad,
      runId,
      durationMs,
      reasoning,
    };
  }
}

/**
 * The eligible candidate pool the ILP solves over: the appearance floor first (B-010), then top-EP
 * per position ∪ cheapest per position.
 *
 * **The order is load-bearing.** Pruning first and filtering after would let sub-threshold cheap
 * fodder occupy the budget-enabler slots and then be dropped, leaving the pool short of the cheap
 * players a legal 15 needs — and there are zero eligible forwards at or under £4.5m, so the pool can
 * genuinely run out.
 *
 * The floor applies HERE and nowhere else. `buildUniverse` keeps every player, so `insights` can
 * still score a user squad holding a new signing over the same numbers.
 *
 * Under a pairwise collision penalty the top-32 cut is no longer provably answer-preserving — a
 * player just outside it who collides with nothing can belong to the true optimum. At 32 per position
 * the gap is negligible, and the honest fix is this sentence rather than a bigger pool.
 */
export function prunePool(
  candidates: Candidate[],
  opts: { floor?: boolean } = {},
): Candidate[] {
  const eligible =
    opts.floor === false
      ? candidates
      : candidates.filter((c) => c.appearances >= MIN_APPEARANCES);
  const keep = new Map<string, Candidate>();
  for (const pos of POSITIONS) {
    const ofPos = eligible.filter((c) => c.position === pos);
    const byEp = [...ofPos].sort((a, b) => b.ep - a.ep).slice(0, POOL_TOP);
    const byCost = [...ofPos]
      .sort((a, b) => a.cost - b.cost)
      .slice(0, POOL_CHEAP);
    for (const c of [...byEp, ...byCost]) keep.set(c.key, c);
  }
  return [...keep.values()];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
