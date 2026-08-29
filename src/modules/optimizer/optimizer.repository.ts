import { Injectable } from '@nestjs/common';
import { MODEL_VERSION } from '../projections/projections.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PositionCode } from '../fpl-sync/mappers';
import { Rules } from './rules';

export interface OptimizePlayer {
  id: string;
  webName: string;
  position: PositionCode;
  teamId: string;
  /** e.g. "CHE" — the only team label safe to put in a payload; `teamId` is a cuid (B-018). */
  teamShortName: string;
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
  homeTeamShortName: string;
  awayTeamShortName: string;
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
  /**
   * The version the app serves — the PINNED incumbent, never "whatever row is newest".
   *
   * It used to be newest-`createdAt`, which meant ANY writer of `projections` silently became the
   * served model: a backtest, a candidate being scored prospectively, a replayed season. Plan 010's
   * "the harness writes nothing" invariant existed to fence that hole; pinning the version closes it
   * structurally, and is what makes writing candidate rows (B-037's prospective holdout) safe at
   * all. Adoption is a D-numbered decision that changes `MODEL_VERSION`, not a row landing.
   */
  async latestProjectionModelVersion(): Promise<string> {
    const n = await this.prisma.projection.count({
      where: { modelVersion: MODEL_VERSION },
    });
    if (n === 0)
      throw new Error(
        `no projections for the served version ${MODEL_VERSION} — run \`pnpm project\` first`,
      );
    return MODEL_VERSION;
  }

  /**
   * The next `n` gameweeks a decision can still be made for.
   *
   * **`finished: false` is not the same thing, and the difference is destructive.** A gameweek whose
   * deadline has passed is unfinished for as long as its matches are being played — so the old query
   * returned the gameweek in progress, and `pnpm project` would write it. Two consequences, both
   * silent:
   *
   * - `writeProjections` upserts on `(playerId, gameweekId, modelVersion)`, so a run during a
   *   gameweek OVERWRITES the pre-deadline rows for it. Those rows are the record of what the model
   *   said while the decision was still open, and `score:gameweek` grades them as exactly that. A
   *   projection written at half-time, scored as a forecast, flatters every model that has one.
   * - the optimizer would recommend transfers for a gameweek that can no longer take them.
   *
   * So the horizon starts at the first gameweek whose deadline is still ahead. Read against the
   * clock rather than a flag, because `finished` flips at the last whistle and `isNext` is upstream's
   * opinion, refreshed on a sync this query cannot assume has run.
   */
  async horizonGameweeks(n: number): Promise<number[]> {
    const rows = await this.prisma.gameweek.findMany({
      where: { finished: false, deadlineTime: { gt: new Date() } },
      orderBy: { id: 'asc' },
      take: n,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async loadPlayers(): Promise<OptimizePlayer[]> {
    const rows = await this.prisma.player.findMany({
      where: { removed: false },
      // A total order (B-039). This list becomes the LP's variable order and the bench sort's input,
      // and without an `ORDER BY` Postgres is free to return it differently between two identical
      // solves — so the product's own recommendation could differ run to run wherever two candidates
      // tie. `id` is the primary key, so this is total by construction rather than by luck.
      orderBy: { id: 'asc' },
      select: {
        id: true,
        webName: true,
        position: true,
        teamId: true,
        nowCost: true,
        // The short name, not only the id. A `teamId` is a cuid, and a cuid that reaches a payload
        // reads as data on screen — which is exactly what B-018 was opened to fix.
        team: { select: { shortName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      webName: r.webName,
      position: r.position,
      teamId: r.teamId,
      teamShortName: r.team.shortName,
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
      counts.set(
        row.playerId,
        (counts.get(row.playerId) ?? 0) + row._count._all,
      );
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
      select: {
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: { shortName: true } },
        awayTeam: { select: { shortName: true } },
      },
    });
    return rows.map((r) => ({
      homeTeamId: r.homeTeamId,
      awayTeamId: r.awayTeamId,
      homeTeamShortName: r.homeTeam.shortName,
      awayTeamShortName: r.awayTeam.shortName,
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
