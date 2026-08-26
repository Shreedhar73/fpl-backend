import { Injectable, Logger } from '@nestjs/common';
import type { Candidate } from '../optimizer/ilp';
import {
  arrangeSquad,
  OptimizerService,
  type SquadPlayer,
  type Universe,
} from '../optimizer/optimizer.service';
import { SquadService } from '../squad/squad.service';
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

  private static readonly NOT_ADVISED_ON = [
    'Transfers — needs sell value, which no public FPL endpoint exposes, and a hit calculation (B-008).',
    'Chip timing — a chip is unspendable once spent, so it is a season-level decision, not a weekly one (B-008).',
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

  private async advise(
    squad: SquadDto,
    managerId: number | null,
  ): Promise<AdviceDto> {
    const universe = await this.optimizer.buildUniverse();
    const nextGw = universe.gameweekIds[0];

    const mine = this.candidatesFor(squad, universe);
    const arranged = arrangeSquad(mine, universe.rules);

    // A fresh optimal solve, unpersisted: this runs on every advice request purely to measure a
    // gap, and filling optimizer_runs with those would bury the solves a human asked for.
    const optimal = await this.optimizer.run({ persist: false });
    const optimalCandidates = this.byPlayerId(universe, optimal.squad);
    const optimalArranged = {
      squad: optimal.squad,
      formation: optimal.formation,
    };

    const involved = [...mine, ...optimalCandidates].map((c) => c.playerId);
    const [projections, meta] = await Promise.all([
      this.repo.projectionsFor(involved, nextGw, universe.modelVersion),
      this.repo.playerMeta(involved),
    ]);
    const epNext = (playerId: string): number =>
      projections.get(playerId)?.expectedPoints ?? 0;

    const players = arranged.squad.map((p) =>
      this.toPlayerDto(p, squad, projections, meta),
    );
    const diff = squadDifference(mine, optimalCandidates);

    const horizonGap = round2(
      squadHorizonEp(optimalCandidates) - squadHorizonEp(mine),
    );
    if (horizonGap < 0) {
      // Not a user-facing case: the optimizer is optimal over the same universe, so this can only
      // mean the two sides were built from different numbers.
      this.log.error(
        `negative horizon gap (${horizonGap}) for manager ${managerId ?? 'recommended'} — ` +
          'the squad and the optimum were measured against different universes',
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
        teamId: pick.teamShortName,
        cost: pick.nowCost,
        ep: 0,
        pPlay: 0,
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
  ): AdvicePlayerDto {
    const pick = squad.picks.find((x) => x.playerId === p.playerId);
    const projection = projections.get(p.playerId);
    const m = meta.get(p.playerId);
    return {
      playerId: p.playerId,
      fplId: pick?.fplId ?? m?.fplId ?? 0,
      webName: p.webName,
      position: p.position,
      teamShortName: pick?.teamShortName ?? m?.teamShortName ?? '',
      nowCost: p.cost,
      role: p.role,
      benchOrder: p.benchOrder ?? null,
      epNextGw: round2(projection?.expectedPoints ?? 0),
      epHorizon: p.ep,
      evidence: projection
        ? {
            components: projection.components,
            expectedMinutes: projection.expectedMinutes,
            playProbability: projection.playProbability,
          }
        : null,
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
