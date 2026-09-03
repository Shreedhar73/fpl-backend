import { Injectable, Logger } from '@nestjs/common';
import highsLoader from 'highs';
import { PositionCode } from '../fpl-sync/mappers';
import { FplApiClient } from '../../infra/fpl/fpl-api.client';
import { Candidate, defencePairs } from '../optimizer/ilp';
/**
 * The appearance floor, applied to what the planner may BUY. Imported rather than re-declared so the
 * two surfaces cannot drift — a planner that recommends buying a player the recommendation refuses to
 * own would have the app contradicting itself on one screen.
 */
import {
  BENCH_WEIGHT,
  DEFENCE_CONCENTRATION_LAMBDA,
  MIN_APPEARANCES as MIN_APPEARANCES_FOR_BUY,
} from '../optimizer/policy';
import {
  OptimizerService,
  type Universe,
} from '../optimizer/optimizer.service';
import { SquadService } from '../squad/squad.service';
import { SquadError } from '../squad/squad.errors';
import type { SquadDto } from '../squad/dto/squad.dto';
import {
  reconstructEntryState,
  reconstructPurchasePrices,
  sellValueOf,
  type PurchasePrice,
  type PurchasePriceSource,
} from '../squad/entry-state';
import { adviseChips, type ChipAdvice } from './chips';
import {
  buildTransferLp,
  HIT_COST,
  MAX_HITS,
  maxTransfersFor,
  type OwnedCandidate,
} from './transfer-lp';
import { TransfersRepository } from './transfers.repository';

/**
 * B-008 — what to do with the squad you already have.
 *
 * Three things had to be **reconstructed** before this could exist at all, because FPL keeps all
 * three private and D-013 says we never authenticate: what each player cost, how many free transfers
 * are in hand, and which chips remain. `squad/entry-state.ts` does that; this service is the decision
 * on top of it.
 *
 * **The two rules this service is built to keep.**
 *
 * 1. **The hit lives in the objective.** The question is never "can I afford a −4", it is "is this
 *    player worth more than four points over the horizon". `transfer-lp.ts` writes it that way.
 * 2. **Money comes back at sell value.** A plan priced in market prices spends money the manager does
 *    not have. When a sell value could not be reconstructed the plan says so per player rather than
 *    substituting `nowCost`, because that substitution is exactly the error and it is silent.
 *
 * **Since B-045 there are two ways in.** `plan(managerId)` reconstructs the three private facts from
 * the manager's public record. `planBuilt(playerIds, …)` plans from a fifteen nobody has bought: two
 * of the three facts are *stated* by the caller (free transfers, optionally the bank) and the third
 * has one honest value — a hypothetical squad is priced at what it costs to assemble today, so sell
 * value IS market price, by construction rather than by fallback. Both feed the same solve, so the
 * two surfaces cannot disagree about what a plan is.
 */

// Both moved to `transfer-lp.ts` so a backtest can read them without importing this service; they
// are re-exported here because callers and tests refer to them by this path.
export { HIT_COST, MAX_HITS, maxTransfersFor };

export type FreeTransfersSource = 'reconstructed' | 'stated';

export interface PlannedMove {
  out: {
    playerId: string;
    webName: string;
    position: PositionCode;
    teamShortName: string;
    nowCost: number;
    sellValue: number | null;
    sellValueSource: PurchasePriceSource;
    epHorizon: number;
  };
  in: {
    playerId: string;
    webName: string;
    position: PositionCode;
    teamShortName: string;
    nowCost: number;
    epHorizon: number;
  };
  /** horizon EP this single move adds, before any hit */
  gainEp: number;
}

export interface TransferPlan {
  /** null for a plan from a hand-built fifteen */
  managerId: number | null;
  gameweekId: number;
  horizonGameweekIds: number[];
  modelVersion: string;
  freeTransfers: number;
  /** replayed from a manager's history, or stated by the caller for a built fifteen */
  freeTransfersSource: FreeTransfersSource;
  /** true when the count is not a lower bound: a complete replay, or a stated number */
  freeTransfersReconstructed: boolean;
  bank: number;
  moves: PlannedMove[];
  hits: number;
  hitCost: number;
  /** horizon EP of the squad as it stands */
  currentEp: number;
  /** horizon EP after the moves, with the hit already subtracted */
  plannedEp: number;
  /** plannedEp − currentEp. Negative is impossible: holding is always available to the solver. */
  netGainEp: number;
  /** picks whose sell value could not be reconstructed, so the budget used their market price */
  sellValueUnknown: string[];
  chips: ChipAdvice[];
  /** what this plan is not, in the payload rather than only in a plan file */
  caveats: string[];
}

export interface BuiltPlanOptions {
  /** free transfers the user says they hold; defaults to one, capped at the rule's bank */
  freeTransfers?: number;
  /** tenths; defaults to what the fifteen leaves of the budget at today's prices */
  bank?: number;
}

/** An owned candidate with where its sell value came from, so a move can say so. */
type PricedOwned = OwnedCandidate & { sellValueSource: PurchasePriceSource };

/** Everything the solve needs that differs between an imported and a built fifteen. */
interface PlanInput {
  managerId: number | null;
  squad: SquadDto;
  universe: Universe;
  bank: number;
  freeTransfers: number;
  freeTransfersSource: FreeTransfersSource;
  freeTransfersReconstructed: boolean;
  chipsUsed: string[];
  /** what this pick cost, from wherever this entry point can honestly get it */
  purchaseOf: (pick: SquadDto['picks'][number]) => PurchasePrice;
  /** the caveats specific to this entry point; the shared ones are added here */
  caveats: string[];
}

@Injectable()
export class TransfersService {
  private readonly log = new Logger(TransfersService.name);

  constructor(
    private readonly optimizer: OptimizerService,
    private readonly squads: SquadService,
    private readonly fpl: FplApiClient,
    private readonly repo: TransfersRepository,
  ) {}

  async plan(managerId: number): Promise<TransferPlan> {
    const squad = await this.squads.getSquad(managerId);
    const universe = await this.optimizer.buildUniverse();
    const rules = universe.rules;

    // The two on-demand reads. `transfers/` returning [] is the normal state of a manager who has
    // not transferred and must never be read as a failure.
    const [transfers, history] = await Promise.all([
      this.fpl.getEntryTransfers(managerId),
      this.fpl.getEntryHistory(managerId),
    ]);

    const state = reconstructEntryState(history, rules.freeTransferCap());
    const startedEvent =
      history.current.length > 0
        ? Math.min(...history.current.map((r) => r.event))
        : squad.gameweekId;

    const fplIdOf = await this.repo.fplIdByPlayerId(
      squad.picks.map((p) => p.playerId),
    );
    const startingPrices = await this.repo.pricesAtGameweek(startedEvent);

    const purchase = reconstructPurchasePrices(
      squad.picks
        .map((p) => fplIdOf.get(p.playerId))
        .filter((id): id is number => id !== undefined),
      transfers,
      startingPrices,
    );

    const caveats: string[] = [];
    if (!state.complete) {
      caveats.push(
        'The free-transfer count is a replay of this manager’s gameweek history and that history ' +
          'has a gap, so the count is a lower bound rather than a certainty.',
      );
    }
    if (squad.picks.some((p) => p.sellValue === null)) {
      caveats.push(
        'Sell values here are reconstructed from the public transfer log and gameweek prices, not ' +
          'read from your account — FPL exposes neither purchase nor selling price publicly (D-013).',
      );
    }

    return this.solve({
      managerId,
      squad,
      universe,
      bank: squad.bank,
      freeTransfers: state.freeTransfers,
      freeTransfersSource: 'reconstructed',
      freeTransfersReconstructed: state.complete,
      chipsUsed: state.chipsUsed,
      purchaseOf: (pick) => {
        const fplId = fplIdOf.get(pick.playerId);
        return (
          (fplId === undefined ? undefined : purchase.get(fplId)) ?? {
            price: null,
            source: 'unknown',
          }
        );
      },
      caveats,
    });
  }

  /**
   * A plan from a fifteen nobody has bought (B-045).
   *
   * Validated first and refused if illegal, for the same reason the advice is: a plan for a squad
   * that cannot be fielded would read as encouragement. Then the three private facts, each with
   * the only honest value a hypothetical squad has:
   *
   * - **purchase price = market price**, so sell value equals market price. Not a fallback and not
   *   `unknown` — a squad assembled today at today's prices sells at those prices, exactly.
   * - **free transfers** are whatever the caller says. Nothing here can check the number, and the
   *   payload says it was stated rather than pretending it was replayed.
   * - **the bank** defaults to what the fifteen leaves of the budget, which is what FPL would leave
   *   a manager who bought exactly this squad now; the validator has already required Σ cost ≤ budget
   *   so the default is never negative.
   * - **no chip is spent.** The fifteen is hypothetical, so is its season.
   */
  async planBuilt(
    playerIds: string[],
    options: BuiltPlanOptions = {},
  ): Promise<TransferPlan> {
    const verdict = await this.squads.validateSquad(playerIds);
    if (!verdict.legal) {
      throw SquadError.illegalSquad(verdict.violations.map((v) => v.message));
    }
    const squad = await this.squads.asSquadDto(playerIds);
    const universe = await this.optimizer.buildUniverse();

    const cap = universe.rules.freeTransferCap();
    const freeTransfers = Math.min(
      cap,
      Math.max(1, Math.floor(options.freeTransfers ?? 1)),
    );
    const bankStated = options.bank !== undefined;
    const bank = bankStated ? Math.max(0, options.bank!) : squad.bank;

    const caveats = [
      'This fifteen was never bought, so every player is priced at today’s market: sell value and ' +
        'market price are the same number by construction, not a reconstruction.',
      `The free-transfer count (${freeTransfers}) is the one you gave; nothing here can check it.`,
      bankStated
        ? 'The bank is the one you gave.'
        : 'The bank is what this fifteen leaves of the budget at today’s prices.',
    ];

    return this.solve({
      managerId: null,
      squad,
      universe,
      bank,
      freeTransfers,
      freeTransfersSource: 'stated',
      freeTransfersReconstructed: true,
      chipsUsed: [],
      purchaseOf: (pick) => ({ price: pick.nowCost, source: 'market-price' }),
      caveats,
    });
  }

  /** The solve and its description, shared by both entry points so they cannot drift. */
  private async solve(input: PlanInput): Promise<TransferPlan> {
    const { squad, universe } = input;
    const rules = universe.rules;
    const byPlayerId = new Map(universe.candidates.map((c) => [c.playerId, c]));

    const owned: PricedOwned[] = [];
    const sellValueUnknown: string[] = [];
    for (const pick of squad.picks) {
      const candidate = byPlayerId.get(pick.playerId);
      if (!candidate) {
        // A player the universe does not carry was removed from FPL mid-season. They still occupy a
        // squad slot, so they are carried at zero EP and their own market price rather than dropped
        // — a fourteen-player squad would silently change the position quotas.
        this.log.warn(
          `${pick.webName} is not in the candidate universe — planning around them at zero EP`,
        );
        continue;
      }
      const p = input.purchaseOf(pick);
      const sellValue = sellValueOf(p.price, candidate.cost);
      if (sellValue === null) sellValueUnknown.push(pick.webName);
      owned.push({ ...candidate, sellValue, sellValueSource: p.source });
    }

    const ownedKeys = new Set(owned.map((c) => c.key));
    const market = this.marketFor(universe, ownedKeys);

    const highs = await highsLoader();
    const lp = buildTransferLp({
      owned,
      market,
      rules,
      bank: input.bank,
      freeTransfers: input.freeTransfers,
      hitCost: HIT_COST,
      // Everything free, plus the two hits the advice is asked to consider (#97). A flat count made
      // the reachable hit depth a function of the bank rather than of the question.
      maxTransfers: maxTransfersFor(input.freeTransfers),
      // The same objective the recommendation is solved under (B-024). It was NOT, for two releases:
      // B-023 gave the squad solve an eleven, a discounted bench and an armband, and this program
      // kept maximising all fifteen equally — so the plan and the recommendation could prefer
      // different players for the same money, on one screen. `benchWeight` defaults to the served
      // value; the concentration charge is passed explicitly because its pairs have to be built over
      // THIS program's universe, which is the owned fifteen plus the market rather than the market
      // alone.
      benchWeight: BENCH_WEIGHT,
      concentration: {
        pairs: defencePairs([...owned, ...market]),
        lambda: DEFENCE_CONCENTRATION_LAMBDA,
      },
    });
    const solution = highs.solve(lp);
    if (solution.Status !== 'Optimal') {
      throw new Error(
        `the transfer planner did not find an optimal plan (status: ${solution.Status})`,
      );
    }

    const chosen = new Set(
      [...owned, ...market]
        .filter((c) => (solution.Columns[c.key]?.Primal ?? 0) > 0.5)
        .map((c) => c.key),
    );
    const out = owned.filter((c) => !chosen.has(c.key));
    const bought = market.filter((c) => chosen.has(c.key));
    const moves = this.pairMoves(out, bought);

    const hits = Math.max(0, moves.length - input.freeTransfers);
    const currentEp = owned.reduce((s, c) => s + c.ep, 0);
    const plannedEp =
      owned.filter((c) => chosen.has(c.key)).reduce((s, c) => s + c.ep, 0) +
      bought.reduce((s, c) => s + c.ep, 0) -
      hits * HIT_COST;

    const horizon = await this.repo.fixtureCounts(universe.gameweekIds);
    const best = [...owned].sort((a, b) => b.ep - a.ep)[0];
    const chips = adviseChips({
      horizon,
      ownedTeamIds: owned.map((c) => c.teamId),
      bestPlayer: best ? { webName: best.webName, teamId: best.teamId } : null,
      chipsUsed: input.chipsUsed,
      horizonGap: await this.gapToRecommendation(currentEp),
    });

    this.log.log(
      `${input.managerId === null ? 'built squad' : `manager ${input.managerId}`}: ` +
        `${moves.length} transfer(s), ${hits} hit(s), ` +
        `net ${(plannedEp - currentEp).toFixed(2)} horizon EP`,
    );

    return {
      managerId: input.managerId,
      gameweekId: universe.gameweekIds[0],
      horizonGameweekIds: universe.gameweekIds,
      modelVersion: universe.modelVersion,
      freeTransfers: input.freeTransfers,
      freeTransfersSource: input.freeTransfersSource,
      freeTransfersReconstructed: input.freeTransfersReconstructed,
      bank: input.bank,
      moves,
      hits,
      hitCost: hits * HIT_COST,
      currentEp: round2(currentEp),
      plannedEp: round2(plannedEp),
      netGainEp: round2(plannedEp - currentEp),
      sellValueUnknown,
      chips,
      caveats: this.caveatsFor(input.caveats, sellValueUnknown),
    };
  }

  /**
   * Who is worth considering buying.
   *
   * The whole league is 600 players and the LP is a knapsack over them, which solves fine — but the
   * appearance floor (B-010) has to apply here exactly as it does to the squad solve, or the planner
   * would recommend buying players the recommendation refuses to own. That inconsistency is worse
   * than either rule alone: the two surfaces would contradict each other on the same screen.
   */
  private marketFor(universe: Universe, ownedKeys: Set<string>): Candidate[] {
    return universe.candidates.filter(
      (c) => !ownedKeys.has(c.key) && c.appearances >= MIN_APPEARANCES_FOR_BUY,
    );
  }

  /**
   * Turn a set of departures and a set of arrivals into moves a human can read.
   *
   * Paired **by position**, because that is the only pairing FPL's own transfer screen supports and
   * the only one a reader can act on. Within a position the highest-EP arrival is matched to the
   * lowest-EP departure, which is the pairing that makes each line read as an improvement.
   */
  private pairMoves(out: PricedOwned[], bought: Candidate[]): PlannedMove[] {
    const moves: PlannedMove[] = [];
    const remaining = [...bought].sort((a, b) => b.ep - a.ep);
    for (const leaving of [...out].sort((a, b) => a.ep - b.ep)) {
      const i = remaining.findIndex((c) => c.position === leaving.position);
      if (i === -1) continue;
      const arriving = remaining.splice(i, 1)[0];
      moves.push({
        out: {
          playerId: leaving.playerId,
          webName: leaving.webName,
          position: leaving.position,
          teamShortName: leaving.teamShortName,
          nowCost: leaving.cost,
          sellValue: leaving.sellValue,
          sellValueSource: leaving.sellValueSource,
          epHorizon: round2(leaving.ep),
        },
        in: {
          playerId: arriving.playerId,
          webName: arriving.webName,
          position: arriving.position,
          teamShortName: arriving.teamShortName,
          nowCost: arriving.cost,
          epHorizon: round2(arriving.ep),
        },
        gainEp: round2(arriving.ep - leaving.ep),
      });
    }
    return moves;
  }

  /** How far the from-scratch recommendation is ahead, for the wildcard line and nothing else. */
  private async gapToRecommendation(currentEp: number): Promise<number> {
    const optimal = await this.optimizer.run({ persist: false });
    const optimalEp = optimal.squad.reduce((s, p) => s + p.ep, 0);
    return Math.max(0, optimalEp - currentEp);
  }

  /** The caveats every plan carries, after the ones specific to how this fifteen was priced. */
  private caveatsFor(specific: string[], sellValueUnknown: string[]): string[] {
    const out = [
      'Every number here is a horizon expectation with no uncertainty attached. A 6.0 from a nailed ' +
        'starter and a 6.0 from a rotation risk are the same number to this planner (B-017).',
      'Chips are recommended as a window and never spent — a chip is unspendable once used, and no ' +
        'model here can price the week you would then never get to use it in.',
      ...specific,
    ];
    if (sellValueUnknown.length > 0) {
      out.push(
        `Sell value could not be reconstructed for ${sellValueUnknown.join(', ')}, so the budget ` +
          'used their market price. That OVERSTATES what you would get for a player whose price has ' +
          'risen, which is the direction that produces a plan you cannot afford.',
      );
    }
    return out;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
