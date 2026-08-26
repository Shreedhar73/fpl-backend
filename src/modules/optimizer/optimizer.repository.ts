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
