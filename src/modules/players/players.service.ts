import { Injectable } from '@nestjs/common';
import { PlayerListDto } from './dto/player.dto';
import { PlayersRepository } from './players.repository';

/**
 * The player universe, for anything that needs to pick from it. Today that is the squad builder.
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
      this.repo.latestModelVersion(),
      this.repo.nextGameweek(),
    ]);

    const projections =
      modelVersion && gameweekId
        ? await this.repo.projectionsFor(gameweekId, modelVersion)
        : new Map<string, { expectedPoints: number; playProbability: number }>();

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
}
