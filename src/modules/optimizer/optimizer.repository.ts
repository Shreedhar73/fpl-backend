import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PositionCode } from '../fpl-sync/mappers';
import { Rules } from './rules';

export interface OptimizePlayer {
  id: string;
  webName: string;
  position: PositionCode;
  teamId: string;
  nowCost: number;
}

export interface ProjectionRowLite {
  playerId: string;
  gameweekId: number;
  expectedPoints: number;
  playProbability: number;
}

export interface FixtureLite {
  homeTeamId: string;
  awayTeamId: string;
}

export interface OptimizerRunInput {
  gameweekId: number;
  modelVersion: string;
  horizon: number;
  objectiveValue: number;
  durationMs: number;
  inputs: unknown;
  result: unknown;
  reasoning: unknown;
}

/**
 * The only file in the optimizer domain that touches PrismaService (fpl-architecture-contract §2):
 * loads the players, their projections and the squad rules, and writes each solve to `optimizer_runs`.
 * All optimisation lives in the pure `ilp.ts` and the service.
 */
@Injectable()
export class OptimizerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadRules(): Promise<Rules> {
    const row = await this.prisma.scoringConfig.findFirst({
      orderBy: { season: 'desc' },
      select: { rules: true, positions: true },
    });
    if (!row) throw new Error('no scoring_config — run the sync first');
    return new Rules(row.rules, row.positions);
  }

  /** The projection model version with the most recent rows. */
  async latestProjectionModelVersion(): Promise<string> {
    const row = await this.prisma.projection.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { modelVersion: true },
    });
    if (!row) throw new Error('no projections — run `pnpm project` first');
    return row.modelVersion;
  }

  async horizonGameweeks(n: number): Promise<number[]> {
    const rows = await this.prisma.gameweek.findMany({
      where: { finished: false },
      orderBy: { id: 'asc' },
      take: n,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async loadPlayers(): Promise<OptimizePlayer[]> {
    const rows = await this.prisma.player.findMany({
      where: { removed: false },
      select: {
        id: true,
        webName: true,
        position: true,
        teamId: true,
        nowCost: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      webName: r.webName,
      position: r.position,
      teamId: r.teamId,
      nowCost: r.nowCost,
    }));
  }

  /**
   * Premier League appearances per player — gameweek rows with `minutes > 0` — over the stored
   * archive plus the current season, keyed by `Player.id` (B-010).
   *
   * Two grouped queries, not one per player: the players table is 612 rows and a per-player count is
   * the N+1 trap `fpl-performance-budget` names. The archive joins on the stable `Player.code`
   * (`ArchivePlayerGameweek.playerId` is nullable and set to null when a player row goes), the live
   * season joins on `Player.id`.
   *
   * This is NOT `Accumulator.matches` in `features.ts`, which counts every row including unused-sub
   * zeros. Same word, different number; it cannot be reused unchanged.
   */
  async appearanceCounts(): Promise<Map<string, number>> {
    const [archive, live] = await Promise.all([
      this.prisma.archivePlayerGameweek.groupBy({
        by: ['playerCode'],
        where: { minutes: { gt: 0 } },
        _count: { _all: true },
      }),
      this.prisma.playerGameweekStat.groupBy({
        by: ['playerId'],
        where: { minutes: { gt: 0 } },
        _count: { _all: true },
      }),
    ]);

    const idByCode = new Map(
      (
        await this.prisma.player.findMany({ select: { id: true, code: true } })
      ).map((p) => [p.code, p.id]),
    );

    const counts = new Map<string, number>();
    for (const row of archive) {
      const id = idByCode.get(row.playerCode);
      if (!id) continue; // an archived player who is not in the current game
      counts.set(id, (counts.get(id) ?? 0) + row._count._all);
    }
    for (const row of live) {
      counts.set(row.playerId, (counts.get(row.playerId) ?? 0) + row._count._all);
    }
    return counts;
  }

  /**
   * The fixtures of one gameweek, as team-id pairs (B-011). A double gameweek returns two rows for
   * the same team and a blank returns none — the collision rule needs no special case for either,
   * because it iterates fixtures rather than teams.
   */
  async fixturesFor(gameweekId: number): Promise<FixtureLite[]> {
    const rows = await this.prisma.fixture.findMany({
      where: { gameweekId },
      select: { homeTeamId: true, awayTeamId: true },
    });
    return rows.map((r) => ({
      homeTeamId: r.homeTeamId,
      awayTeamId: r.awayTeamId,
    }));
  }

  async loadProjections(
    modelVersion: string,
    gwIds: number[],
  ): Promise<ProjectionRowLite[]> {
    const rows = await this.prisma.projection.findMany({
      where: { modelVersion, gameweekId: { in: gwIds } },
      select: {
        playerId: true,
        gameweekId: true,
        expectedPoints: true,
        playProbability: true,
      },
    });
    return rows.map((r) => ({
      playerId: r.playerId,
      gameweekId: r.gameweekId,
      expectedPoints: Number(r.expectedPoints),
      playProbability: Number(r.playProbability),
    }));
  }

  async writeRun(input: OptimizerRunInput): Promise<string> {
    const run = await this.prisma.optimizerRun.create({
      data: {
        gameweekId: input.gameweekId,
        modelVersion: input.modelVersion,
        horizon: input.horizon,
        freeTransfers: 0, // from-scratch: no owned squad, no transfers (B-008)
        hitsTaken: 0,
        objectiveValue: input.objectiveValue,
        inputs: input.inputs as Prisma.InputJsonValue,
        result: input.result as Prisma.InputJsonValue,
        reasoning: input.reasoning as Prisma.InputJsonValue,
        durationMs: input.durationMs,
      },
      select: { id: true },
    });
    return run.id;
  }
}
