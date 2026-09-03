import { Injectable } from '@nestjs/common';
import { HORIZON } from '../optimizer/policy';
import { PlayerDetailDto } from './dto/player-detail.dto';
import { PlayerListDto } from './dto/player.dto';
import { PlayersError } from './players.errors';
import { PlayersRepository } from './players.repository';

/** How many finished matches the sheet shows. Six is a run of form; more is a season table. */
export const RECENT_MATCHES = 6;

/**
 * The player universe, for anything that needs to pick from it, and one player whole, for the
 * sheet that opens on a tap (plan 030).
 *
 * Expected points are attached where the model has them and left **null** where it does not.
 * A null is not a zero: zero means "we project this player to score nothing", null means "we have
 * not projected them", and a picker that renders the second as the first quietly buries every
 * player the model has not reached.
 */
@Injectable()
export class PlayersService {
  constructor(private readonly repo: PlayersRepository) {}

  async list(): Promise<PlayerListDto> {
    const [players, modelVersion, gameweekId] = await Promise.all([
      this.repo.listAll(),
      this.repo.servedModelVersion(),
      this.repo.nextGameweek(),
    ]);

    const projections =
      modelVersion && gameweekId
        ? await this.repo.projectionsFor(gameweekId, modelVersion)
        : new Map<
            string,
            { expectedPoints: number; playProbability: number }
          >();

    return {
      gameweekId: projections.size > 0 ? gameweekId : null,
      modelVersion: projections.size > 0 ? modelVersion : null,
      count: players.length,
      players: players.map((p) => {
        const projection = projections.get(p.playerId);
        return {
          ...p,
          epNextGw: projection?.expectedPoints ?? null,
          playProbability: projection?.playProbability ?? null,
        };
      }),
    };
  }

  /**
   * One player, whole. Every read is one round trip and they run in parallel once the row and the
   * horizon are known — nothing runs per gameweek or per fixture.
   */
  async detail(playerId: string): Promise<PlayerDetailDto> {
    const [row, modelVersion, horizon] = await Promise.all([
      this.repo.detail(playerId),
      this.repo.servedModelVersion(),
      this.repo.horizonGameweeks(HORIZON),
    ]);
    if (!row) throw PlayersError.unknownPlayer(playerId);

    const [projections, fixtures, recent, totals, ownership, price] =
      await Promise.all([
        modelVersion
          ? this.repo.horizonProjections(playerId, horizon, modelVersion)
          : Promise.resolve([]),
        this.repo.fixturesForTeam(row.teamId, horizon),
        this.repo.recentStats(playerId, RECENT_MATCHES),
        this.repo.seasonTotals(playerId),
        this.repo.latestOwnership(playerId),
        this.repo.priceBounds(playerId),
      ]);

    return {
      playerId: row.playerId,
      fplId: row.fplId,
      webName: row.webName,
      fullName: row.fullName,
      position: row.position,
      teamShortName: row.teamShortName,
      teamName: row.teamName,
      nowCost: row.nowCost,
      status: row.status,
      news: row.news,
      chanceOfPlayingNextRound: row.chanceOfPlayingNextRound,
      form: row.form,
      pointsPerGame: row.pointsPerGame,
      seasonMinutes: row.seasonMinutes,
      seasonStarts: row.seasonStarts,
      penaltiesOrder: row.penaltiesOrder,
      directFreekicksOrder: row.directFreekicksOrder,
      cornersOrder: row.cornersOrder,
      selectedByPercent: ownership,
      priceChangeSinceTracked: price
        ? price.last.cost - price.first.cost
        : null,
      priceTrackedSince: price ? price.first.recordedAt.toISOString() : null,
      seasonTotals: totals,
      // The version is only a claim when at least one projection carries it.
      modelVersion: projections.length > 0 ? modelVersion : null,
      horizonGameweekIds: horizon,
      projections: projections.map((p) => ({
        ...p,
        fixtures: fixtures
          .filter((f) => f.gameweekId === p.gameweekId)
          .map((f) => ({
            opponentShortName: f.opponentShortName,
            isHome: f.isHome,
            difficulty: f.difficulty,
            kickoffTime: f.kickoffTime ? f.kickoffTime.toISOString() : null,
          })),
      })),
      recent,
    };
  }
}
