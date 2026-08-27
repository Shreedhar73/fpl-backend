import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { FixtureCount } from './chips';

/**
 * The three reads the transfer planner needs and nothing else does (B-008).
 *
 * Reads only. A plan is advice; nothing here writes a transfer anywhere, and the product makes no
 * write to FPL at all (D-013).
 */
@Injectable()
export class TransfersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `Player.id` → FPL element id, for joining a stored pick to the public transfer log.
   *
   * The transfer log speaks in element ids and everything here speaks in cuids, and the join has to
   * happen somewhere. It happens once, over the fifteen picks, rather than per lookup.
   */
  async fplIdByPlayerId(playerIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, fplId: true },
    });
    return new Map(rows.map((r) => [r.id, r.fplId]));
  }

  /**
   * Every player's price in one gameweek, keyed by FPL element id.
   *
   * **`player_gameweek_stats.value`, deliberately, and not `player_price_history`.** FPL's
   * per-gameweek `value` is the price in that gameweek, so for a player held since the manager's
   * first gameweek this IS the purchase price. `player_price_history` starts on the day this project
   * first synced — 2026-08-26, after the GW1 deadline — so it would substitute today's price for the
   * one actually paid, in the one field whose entire purpose is that the two differ.
   *
   * A double gameweek gives a player two rows with the same price; `max` collapses them rather than
   * summing, because a price is a property of the player that week and not of the fixture.
   */
  async pricesAtGameweek(gameweekId: number): Promise<Map<number, number>> {
    const rows = await this.prisma.playerGameweekStat.findMany({
      where: { gameweekId },
      select: { value: true, player: { select: { fplId: true } } },
    });
    const out = new Map<number, number>();
    for (const r of rows) {
      out.set(r.player.fplId, Math.max(out.get(r.player.fplId) ?? 0, r.value));
    }
    return out;
  }

  /**
   * How many fixtures each club plays in each gameweek of the horizon — the only input chip advice
   * has.
   *
   * A club **absent** from a gameweek's map has no fixture, which is the blank; a club with two has
   * a double. Both are read off the fixture table rather than inferred from anything, because both
   * are facts about a published calendar and nothing else.
   */
  async fixtureCounts(gameweekIds: number[]): Promise<FixtureCount[]> {
    const rows = await this.prisma.fixture.findMany({
      where: { gameweekId: { in: gameweekIds } },
      select: { gameweekId: true, homeTeamId: true, awayTeamId: true },
    });

    return gameweekIds.map((gameweekId) => {
      const fixturesByTeam = new Map<string, number>();
      for (const r of rows) {
        if (r.gameweekId !== gameweekId) continue;
        for (const teamId of [r.homeTeamId, r.awayTeamId]) {
          fixturesByTeam.set(teamId, (fixturesByTeam.get(teamId) ?? 0) + 1);
        }
      }
      return { gameweekId, fixturesByTeam };
    });
  }
}
