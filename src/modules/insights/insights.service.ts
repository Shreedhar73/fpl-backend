import { Injectable, Logger } from '@nestjs/common';
import { penalisedSquadEp, type Candidate } from '../optimizer/ilp';
import { MIN_APPEARANCES } from '../optimizer/policy';
import {
  arrangeSquad,
  OptimizerService,
  type SquadPlayer,
  type Universe,
} from '../optimizer/optimizer.service';
import { SquadService } from '../squad/squad.service';
import { SquadError } from '../squad/squad.errors';
import type { SquadDto } from '../squad/dto/squad.dto';
import {
  AdviceDto,
  AdvicePlayerDto,
  SquadDifferenceDto,
} from './dto/advice.dto';
import {
  InsightsRepository,
  type NextGwProjection,
  type PlayerMeta,
  type TeamHorizonFixture,
} from './insights.repository';
import { round2, squadDifference, squadHorizonEp, xiNextGwEp } from './advice';

/**
 * The "why" layer: given a squad from anywhere, say who to captain, in what order the bench should
 * sit, and how far the squad is from the best legal one — with the model's own per-term reasoning
 * attached to every player.
 *
 * What it deliberately does not do is recommend transfers or chips. Both need an owned squad's
 * sell value and a hit calculation (B-008), and `sellValue` is null on every imported pick because
 * no public endpoint carries a purchase price. `notAdvisedOn` says so in the payload rather than
 * leaving the gap to be discovered.
 */
@Injectable()
export class InsightsService {
  private readonly log = new Logger(InsightsService.name);

  /**
   * What this payload deliberately does not answer.
   *
   * Transfers and chips came off this list when B-008 shipped — they are answered, at
   * `GET /insights/transfers/{managerId}`, and a list that still refused them would have the app
   * telling a user it cannot do something it does on the next screen. What replaced them is the
   * limit that is now true and was always the more important one.
   */
  private static readonly NOT_ADVISED_ON = [
    'Uncertainty — every number here is a mean with no dispersion attached, so a 6.0 from a nailed starter and a 6.0 from a rotation risk read identically (B-017).',
    'Whether a chip is worth playing — the transfer endpoint names the gameweek the calendar argues for and stops. A chip is unspendable once used, and no model here can price the week you would then never get to use it in.',
    'Availability beyond what FPL publishes — the injury and doubt multiplier is a hand-drawn scalar, not a fitted term, because the archive carries no per-gameweek status (B-015).',
  ];

  constructor(
    private readonly optimizer: OptimizerService,
    private readonly squads: SquadService,
    private readonly repo: InsightsRepository,
  ) {}

  async adviseManager(managerId: number): Promise<AdviceDto> {
    return this.advise(await this.squads.getSquad(managerId), managerId);
  }

  async adviseRecommended(): Promise<AdviceDto> {
    return this.advise(await this.squads.getRecommendedSquad(), null);
  }

  /**
   * Advice for a squad someone built by hand. It is validated first and refused if illegal —
   * advising on an illegal squad would produce a captain and a bench for a team that cannot be
   * fielded, which reads as encouragement.
   */
  async adviseBuilt(playerIds: string[]): Promise<AdviceDto> {
    const verdict = await this.squads.validateSquad(playerIds);
    if (!verdict.legal) {
      throw SquadError.illegalSquad(verdict.violations.map((v) => v.message));
    }
    return this.advise(await this.squads.asSquadDto(playerIds), null);
  }

  private async advise(
    squad: SquadDto,
    managerId: number | null,
  ): Promise<AdviceDto> {
    const universe = await this.optimizer.buildUniverse();
    const nextGw = universe.gameweekIds[0];

    const mine = this.candidatesFor(squad, universe);
    // The user's squad is arranged under the SAME objective the recommendation was solved under, so
    // the two XIs and the two captains mean the same thing. Since B-029 the only penalty is the
    // defensive-concentration charge, which keys off the eleven — so passing the context here is what
    // makes a user's XI chosen the way the recommendation's was.
    const arranged = arrangeSquad(mine, universe.rules, universe.concentration);

    // A fresh optimal solve, unpersisted: this runs on every advice request purely to measure a
    // gap, and filling optimizer_runs with those would bury the solves a human asked for.
    // The GUARDED optimum: what we would actually recommend, not a bigger and misleading gap against
    // an optimum we would refuse to serve. The penalty totals that explain the difference used to go
    // only to `optimizer_runs.reasoning`, where no user could reach them; B-018 carries them out on
    // `AdviceDto.reasoning`, which is the DTO change plan 009 deliberately did not make.
    //
    // `explain: true` costs a second ILP solve over an unguarded pool. It buys the number a user
    // actually reads — what the appearance floor cost this recommendation — and that number was
    // being computed, persisted and then shown to nobody.
    const optimal = await this.optimizer.run({ persist: false, explain: true });
    const optimalCandidates = this.byPlayerId(universe, optimal.squad);
    const optimalArranged = {
      squad: optimal.squad,
      formation: optimal.formation,
    };

    const involved = [...mine, ...optimalCandidates].map((c) => c.playerId);
    const minePlayerIds = mine.map((c) => c.playerId);
    const [projections, meta, horizonEp] = await Promise.all([
      this.repo.projectionsFor(involved, nextGw, universe.modelVersion),
      this.repo.playerMeta(involved),
      // The horizon rides only the user's 15 — the comparison's set difference is a list, not a
      // ledger, and the optimal 15 already has its own view.
      this.repo.horizonProjections(
        minePlayerIds,
        universe.gameweekIds,
        universe.modelVersion,
      ),
    ]);
    const teamIds = [
      ...new Set(
        minePlayerIds
          .map((id) => meta.get(id)?.teamId)
          .filter((t): t is string => t !== undefined),
      ),
    ];
    const fixtures = await this.repo.fixturesForTeams(
      teamIds,
      universe.gameweekIds,
    );
    const epNext = (playerId: string): number =>
      projections.get(playerId)?.expectedPoints ?? 0;

    const players = arranged.squad.map((p) =>
      this.toPlayerDto(p, squad, projections, meta, {
        gameweekIds: universe.gameweekIds,
        ep: horizonEp,
        fixtures,
      }),
    );
    const diff = squadDifference(mine, optimalCandidates);

    const horizonGap = round2(
      squadHorizonEp(optimalCandidates) - squadHorizonEp(mine),
    );
    // A negative RAW horizon gap is now a legitimate outcome, and this check had to stop treating it
    // as a bug. Three things let a user squad out-score the recommendation on raw EP:
    //
    //   1. the appearance floor (B-010) — a squad may hold players the optimizer refuses to bet on;
    //   2. the defensive-concentration penalty (B-029) — the optimizer maximises
    //      `EP - lambda x same-club defensive pairs STARTED`, not `EP`. It is charged on the XI, so
    //      it does not enter this squad-level comparison at all;
    //   3. pool pruning, which predates both and was always a (much smaller) hole in the old claim.
    //
    // What is still an invariant, and what is logged: over a squad the optimizer *could* have chosen
    // — every player eligible and in the pool it solved over — the optimum must win on the PENALISED
    // quantity. Both sides are computed here by the same function over the same universe numbers,
    // never against the solver's objective value, which is built from rounded coefficients.
    const eligibleForTheSolve = mine.every(
      (c) => c.appearances >= MIN_APPEARANCES,
    );
    const minePenalised = penalisedSquadEp(mine);
    const optimalPenalised = penalisedSquadEp(optimalCandidates);
    if (eligibleForTheSolve && minePenalised > optimalPenalised + 1e-6) {
      this.log.error(
        `a legal squad beat the optimum on penalised horizon EP ` +
          `(${round2(minePenalised)} vs ${round2(optimalPenalised)}) for manager ` +
          `${managerId ?? 'recommended'} — the two sides were built from different numbers, ` +
          'or the pool pruned a player the optimum needed',
      );
    }

    return {
      managerId,
      gameweekId: nextGw,
      horizonGameweekIds: universe.gameweekIds,
      modelVersion: universe.modelVersion,
      captain: players.find((p) => p.role === 'captain') ?? null,
      viceCaptain: players.find((p) => p.role === 'vice') ?? null,
      players,
      comparison: {
        squadHorizonEp: round2(squadHorizonEp(mine)),
        optimalHorizonEp: round2(squadHorizonEp(optimalCandidates)),
        horizonGap,
        xiNextGwEp: round2(xiNextGwEp(arranged, epNext)),
        optimalXiNextGwEp: round2(xiNextGwEp(optimalArranged, epNext)),
        xiNextGwGap: round2(
          xiNextGwEp(optimalArranged, epNext) - xiNextGwEp(arranged, epNext),
        ),
        formation: arranged.formation,
        optimalFormation: optimal.formation,
        optimalHasThatYouDoNot: diff.optimalHasThatYouDoNot.map((c) =>
          toDifference(c, meta),
        ),
        youHaveThatOptimalDoesNot: diff.youHaveThatOptimalDoesNot.map((c) =>
          toDifference(c, meta),
        ),
      },
      reasoning: optimal.reasoning,
      notAdvisedOn: InsightsService.NOT_ADVISED_ON,
    };
  }

  /**
   * The squad's players as optimizer candidates, so both sides of the comparison are measured
   * against exactly the same expected points.
   *
   * A player the universe does not carry is one the sync marked `removed` — gone from FPL
   * mid-season. They stay in the squad with zero expected points rather than vanishing: a
   * 14-player squad would quietly change the formation and the comparison.
   */
  private candidatesFor(squad: SquadDto, universe: Universe): Candidate[] {
    const byId = new Map(universe.candidates.map((c) => [c.playerId, c]));
    return squad.picks.map((pick) => {
      const found = byId.get(pick.playerId);
      if (found) return found;
      this.log.warn(
        `player ${pick.webName} (${pick.playerId}) is not in the candidate universe — ` +
          'projecting zero. They were probably removed from FPL.',
      );
      return {
        key: `p_${pick.playerId}`,
        playerId: pick.playerId,
        webName: pick.webName,
        position: pick.position,
        // A removed player has no row in the candidate universe, so there is no cuid to use. The
        // short name doubles as the id here, and is stated so rather than left looking like one.
        teamId: pick.teamShortName,
        teamShortName: pick.teamShortName,
        cost: pick.nowCost,
        ep: 0,
        pPlay: 0,
        appearances: 0,
      };
    });
  }

  private byPlayerId(universe: Universe, squad: SquadPlayer[]): Candidate[] {
    const byId = new Map(universe.candidates.map((c) => [c.playerId, c]));
    return squad
      .map((p) => byId.get(p.playerId))
      .filter((c): c is Candidate => c !== undefined);
  }

  private toPlayerDto(
    p: SquadPlayer,
    squad: SquadDto,
    projections: Map<string, NextGwProjection>,
    meta: Map<string, PlayerMeta>,
    horizon: {
      gameweekIds: number[];
      ep: Map<string, Map<number, number>>;
      fixtures: Map<string, TeamHorizonFixture[]>;
    },
  ): AdvicePlayerDto {
    const pick = squad.picks.find((x) => x.playerId === p.playerId);
    const projection = projections.get(p.playerId);
    const m = meta.get(p.playerId);
    const epByGw = horizon.ep.get(p.playerId);
    const clubFixtures = m ? (horizon.fixtures.get(m.teamId) ?? []) : [];
    return {
      playerId: p.playerId,
      fplId: pick?.fplId ?? m?.fplId ?? 0,
      webName: p.webName,
      position: p.position,
      teamShortName: pick?.teamShortName ?? m?.teamShortName ?? '',
      nowCost: p.cost,
      // 'a' when the meta row is missing — the same absence the list renders as no flag.
      status: m?.status ?? 'a',
      news: m?.news ?? null,
      chanceOfPlayingNextRound: m?.chanceOfPlayingNextRound ?? null,
      role: p.role,
      benchOrder: p.benchOrder ?? null,
      epNextGw: round2(projection?.expectedPoints ?? 0),
      epHorizon: p.ep,
      evidence: projection
        ? {
            components: projection.components,
            expectedMinutes: projection.expectedMinutes,
            playProbability: projection.playProbability,
            sd: projection.sd,
            pBlank: projection.pBlank,
            pHaul: projection.pHaul,
          }
        : null,
      horizon: horizon.gameweekIds.map((gameweekId) => {
        const ep = epByGw?.get(gameweekId);
        return {
          gameweekId,
          expectedPoints: ep === undefined ? null : round2(ep),
          fixtures: clubFixtures
            .filter((f) => f.gameweekId === gameweekId)
            .map((f) => ({
              opponentShortName: f.opponentShortName,
              isHome: f.isHome,
              difficulty: f.difficulty,
            })),
        };
      }),
    };
  }
}

function toDifference(
  c: Candidate,
  meta: Map<string, PlayerMeta>,
): SquadDifferenceDto {
  return {
    playerId: c.playerId,
    webName: c.webName,
    position: c.position,
    teamShortName: meta.get(c.playerId)?.teamShortName ?? '',
    nowCost: c.cost,
    epHorizon: round2(c.ep),
  };
}
