import { Injectable, Logger } from '@nestjs/common';
import highsLoader from 'highs';
import { PositionCode } from '../fpl-sync/mappers';
import { OptimizerRepository } from './optimizer.repository';
import { buildLp, pickBestXi, Candidate } from './ilp';
import { POSITIONS, Rules } from './rules';

export const OPTIMIZER_VERSION = 'v1-ilp';
const HORIZON = 5;
const DECAY = 0.84;
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
}

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
): { squad: SquadPlayer[]; formation: string } {
  const { starters, formation } = pickBestXi(inSquad, rules);

  // captain = highest-EP starter, vice = next
  const starterList = inSquad
    .filter((c) => starters.has(c.key))
    .sort((a, b) => b.ep - a.ep);
  const captainKey = starterList[0]?.key;
  const viceKey = starterList[1]?.key;

  const bench = inSquad.filter((c) => !starters.has(c.key));
  const benchGk = bench.filter((c) => c.position === 'GKP');
  const benchOut = bench
    .filter((c) => c.position !== 'GKP')
    .sort((a, b) => b.pPlay * b.ep - a.pPlay * a.ep);
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

  return { squad, formation };
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
      cost: p.nowCost,
      ep: horizonEp(p.id),
      pPlay: ppByPlayer.get(p.id) ?? 0,
    }));

    return { candidates, rules, gameweekIds, modelVersion };
  }

  async run(
    opts: { singleGw?: boolean; persist?: boolean } = {},
  ): Promise<OptimizeSummary> {
    const started = Date.now();
    const { candidates, rules, gameweekIds, modelVersion } =
      await this.buildUniverse(opts);
    const gwIds = gameweekIds;
    const nextGw = gwIds[0];

    const pool = this.prunePool(candidates);
    const lp = buildLp(pool, rules);
    const highs = await highsLoader();
    const solution = highs.solve(lp);
    if (solution.Status !== 'Optimal') {
      throw new Error(
        `optimiser did not find an optimal squad (status: ${solution.Status})`,
      );
    }
    const objectiveValue = solution.ObjectiveValue;

    const inSquad = pool.filter(
      (c) => (solution.Columns[c.key]?.Primal ?? 0) > 0.5,
    );
    if (inSquad.length !== rules.squadSize()) {
      throw new Error(
        `solver returned ${inSquad.length} players, expected ${rules.squadSize()}`,
      );
    }

    // best legal XI, captain, vice and bench order — the same arrangement `insights` applies to a
    // squad the optimizer did not choose.
    const { squad, formation } = arrangeSquad(inSquad, rules);

    const totalCost = inSquad.reduce((s, c) => s + c.cost, 0);
    const durationMs = Date.now() - started;

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
            },
            result: { squad, totalCost, formation },
            reasoning: squad,
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
    };
  }

  /** Top-EP per position ∪ cheapest per position — the only players an optimal squad can contain. */
  private prunePool(candidates: Candidate[]): Candidate[] {
    const keep = new Map<string, Candidate>();
    for (const pos of POSITIONS) {
      const ofPos = candidates.filter((c) => c.position === pos);
      const byEp = [...ofPos].sort((a, b) => b.ep - a.ep).slice(0, POOL_TOP);
      const byCost = [...ofPos]
        .sort((a, b) => a.cost - b.cost)
        .slice(0, POOL_CHEAP);
      for (const c of [...byEp, ...byCost]) keep.set(c.key, c);
    }
    return [...keep.values()];
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
