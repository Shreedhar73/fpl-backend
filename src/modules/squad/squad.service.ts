import { Injectable, Logger } from '@nestjs/common';
import { FplApiClient, FplHttpError } from '../../infra/fpl/fpl-api.client';
import type { RawEntry, RawEntryPicks } from '../../infra/fpl/fpl.types';
import { OptimizerService } from '../optimizer/optimizer.service';
import { SquadDto, SquadPickDto } from './dto/squad.dto';
import { SquadError } from './squad.errors';
import {
  checkLegality,
  type LegalityPlayer,
  type LegalityResult,
} from './legality';
import { PersistedSquad, PlayerRow, SquadRepository } from './squad.repository';

/**
 * The three ways a squad reaches the model, minus the manual builder: imported from a public
 * manager id, or taken from the optimizer's recommendation. No authentication is involved in
 * either — D-013. The manager id is an input, and the only thing persisted under it is the squad
 * it produced.
 */
@Injectable()
export class SquadService {
  private readonly log = new Logger(SquadService.name);

  constructor(
    private readonly fpl: FplApiClient,
    private readonly repo: SquadRepository,
    private readonly optimizer: OptimizerService,
  ) {}

  /**
   * Fetch a manager's last-locked squad and persist it. This is the one code path in the app that
   * calls upstream while a user waits — see the carve-out in the fpl-api-reference etiquette
   * section. Persisting is what keeps it to once: `getSquad` reads Postgres.
   */
  async importSquad(managerId: number): Promise<SquadDto> {
    // Already have it? Then do not ask upstream. Picks are locked once their deadline passes, so a
    // stored squad for the latest readable gameweek cannot have gone stale — re-importing could
    // only fetch the identical payload. This is what keeps the upstream call to once per manager
    // per gameweek rather than once per click.
    const latest = await this.repo.latestReadableGameweek();
    if (latest !== null) {
      const cached = await this.repo.findSquad(managerId, latest);
      if (cached) {
        this.log.log(
          `manager ${managerId} GW${latest} already imported — served from Postgres`,
        );
        return this.toDto(cached);
      }
    }

    const entry = await this.fetchEntry(managerId);

    const gameweekId = entry.current_event;
    if (gameweekId === null) {
      throw SquadError.squadNotAvailableYet(
        managerId,
        'they have not played a gameweek yet',
      );
    }

    const picks = await this.fetchPicks(managerId, gameweekId);

    // The gameweek must exist locally or the foreign key fails with a message about a constraint
    // rather than about the sync being behind.
    if (!(await this.repo.gameweekExists(gameweekId))) {
      throw SquadError.squadNotAvailableYet(
        managerId,
        `this app has not synced gameweek ${gameweekId}`,
      );
    }

    const players = await this.resolvePlayers(picks);

    await this.repo.upsertSquad({
      managerId,
      gameweekId,
      bank: picks.entry_history.bank,
      teamValue: picks.entry_history.value,
      activeChip: picks.active_chip,
      picks: picks.picks.map((p) => ({
        playerId: players.get(p.element)!.id,
        slot: p.position,
        multiplier: p.multiplier,
        isCaptain: p.is_captain,
        isViceCaptain: p.is_vice_captain,
      })),
    });

    this.log.log(
      `imported manager ${managerId} GW${gameweekId}: ${picks.picks.length} picks, ` +
        `bank £${(picks.entry_history.bank / 10).toFixed(1)}m`,
    );

    const managerName = [entry.player_first_name, entry.player_last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      managerId,
      managerName: managerName || null,
      gameweekId,
      bank: picks.entry_history.bank,
      teamValue: picks.entry_history.value,
      activeChip: picks.active_chip,
      source: 'import',
      picks: picks.picks.map((p) =>
        toPickDto(players.get(p.element)!, {
          slot: p.position,
          multiplier: p.multiplier,
          isCaptain: p.is_captain,
          isViceCaptain: p.is_vice_captain,
        }),
      ),
    };
  }

  /** The persisted import. No upstream call — that is the point of persisting it. */
  async getSquad(managerId: number): Promise<SquadDto> {
    const row = await this.repo.findSquad(managerId);
    if (!row) throw SquadError.notImported(managerId);
    return this.toDto(row);
  }

  /**
   * `managerName` is null on this path. The name is not stored — it is not part of the squad, and
   * a display name is not something to keep about a person on the strength of a public id. It is
   * returned by a fresh import, where it came back in the same response.
   */
  private toDto(row: PersistedSquad): SquadDto {
    return {
      managerId: row.managerId,
      managerName: null,
      gameweekId: row.gameweekId,
      bank: row.bank,
      teamValue: row.teamValue,
      activeChip: row.activeChip,
      source: 'import',
      picks: row.picks.map((p) => toPickDto(p.player, p)),
    };
  }

  /**
   * The optimizer's own 15, in the same shape. Not written to `squads`: it belongs to no manager,
   * and every solve is already persisted to `optimizer_runs`.
   */
  async getRecommendedSquad(): Promise<SquadDto> {
    const result = await this.optimizer.run({ persist: false });
    const players = await this.repo.playersByIds(
      result.squad.map((p) => p.playerId),
    );

    // The optimizer reports a role and a bench order; the wire shape is FPL's slot numbering, so
    // the XI takes slots 1-11 and the bench 12-15 in its substitution order.
    const starters = result.squad.filter((p) => p.role !== 'bench');
    const bench = result.squad
      .filter((p) => p.role === 'bench')
      .sort((a, b) => (a.benchOrder ?? 0) - (b.benchOrder ?? 0));

    const picks: SquadPickDto[] = [
      ...starters.map((p, i) => ({ p, slot: i + 1 })),
      ...bench.map((p, i) => ({ p, slot: 12 + i })),
    ].map(({ p, slot }) =>
      toPickDto(players.get(p.playerId)!, {
        slot,
        multiplier: p.role === 'captain' ? 2 : 1,
        isCaptain: p.role === 'captain',
        isViceCaptain: p.role === 'vice',
      }),
    );

    const teamValue = picks.reduce((sum, p) => sum + p.nowCost, 0);
    const rules = await this.optimizer.loadRules();

    return {
      managerId: null,
      managerName: null,
      gameweekId: result.gameweekIds[0],
      // A from-scratch squad spends against the budget, so whatever it did not spend is the bank.
      // Read from scoring_config, never hardcoded as 1000 — fpl-domain-rules, "the one rule about
      // rules".
      bank: rules.budget() - teamValue,
      teamValue,
      activeChip: null,
      source: 'recommended',
      picks,
    };
  }

  /**
   * Is this set of players a legal squad? Prices, positions and clubs come from our own store, not
   * from the request — a client claiming a £4.0m Haaland gets the real price checked.
   *
   * Every limit is read through the ruleset in `scoring_config`, never a constant. An id with no
   * player behind it is an error, the same as on the import path: a silently shorter squad would
   * pass the very check being asked for.
   */
  async validateSquad(playerIds: string[]): Promise<LegalityResult> {
    const found = await this.repo.playersByIds([...new Set(playerIds)]);
    const missing = playerIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw SquadError.unknownPlayerIds(missing);

    // Mapped from the request array rather than from the map, so a repeated id stays repeated and
    // the duplicate check has something to find.
    const players: LegalityPlayer[] = playerIds.map((id) => {
      const p = found.get(id)!;
      return {
        playerId: p.id,
        webName: p.webName,
        position: p.position,
        teamId: p.teamId,
        teamShortName: p.teamShortName,
        nowCost: p.nowCost,
      };
    });

    return checkLegality(players, await this.optimizer.loadRules());
  }

  /**
   * A hand-built squad in the same shape as an imported or recommended one, so the advice layer
   * and the view treat all three identically. Not persisted: it belongs to no manager and has not
   * been entered into FPL by anybody.
   *
   * Slots are assigned in the order given, which is enough for the advice — `arrangeSquad` picks
   * the XI, the captain and the bench order from scratch and ignores whatever slots arrive.
   */
  async asSquadDto(playerIds: string[]): Promise<SquadDto> {
    const found = await this.repo.playersByIds(playerIds);
    const missing = playerIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw SquadError.unknownPlayerIds(missing);

    const picks = playerIds.map((id, i) =>
      toPickDto(found.get(id)!, {
        slot: i + 1,
        multiplier: 1,
        isCaptain: false,
        isViceCaptain: false,
      }),
    );
    const teamValue = picks.reduce((sum, p) => sum + p.nowCost, 0);
    const rules = await this.optimizer.loadRules();
    const gameweekIds = (await this.optimizer.buildUniverse()).gameweekIds;

    return {
      managerId: null,
      managerName: null,
      gameweekId: gameweekIds[0],
      bank: rules.budget() - teamValue,
      teamValue,
      activeChip: null,
      source: 'built',
      picks,
    };
  }

  private async fetchEntry(managerId: number): Promise<RawEntry> {
    try {
      return await this.fpl.getEntry(managerId);
    } catch (err) {
      throw this.mapUpstream(err, managerId);
    }
  }

  private async fetchPicks(
    managerId: number,
    gameweek: number,
  ): Promise<RawEntryPicks> {
    try {
      return await this.fpl.getEntryPicks(managerId, gameweek);
    } catch (err) {
      // A 404 here is not a missing manager — the entry resolved a moment ago. It means the
      // gameweek's picks are not public, which is what happens before its deadline.
      if (err instanceof FplHttpError && err.status === 404) {
        throw SquadError.squadNotAvailableYet(
          managerId,
          `gameweek ${gameweek}'s picks are not public yet`,
        );
      }
      throw this.mapUpstream(err, managerId);
    }
  }

  private mapUpstream(err: unknown, managerId: number): Error {
    if (err instanceof FplHttpError) {
      if (err.status === 404) return SquadError.managerNotFound(managerId);
      return SquadError.upstreamUnavailable(
        err.timedOut ? 'timed out' : `status ${err.status ?? 'unknown'}`,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  /**
   * Map every FPL element id to a local player, or fail. A skipped pick would leave a 14-player
   * squad that passes every later check quietly and produces advice about a team nobody owns.
   */
  private async resolvePlayers(
    picks: RawEntryPicks,
  ): Promise<Map<number, PlayerRow>> {
    const fplIds = picks.picks.map((p) => p.element);
    const players = await this.repo.playersByFplId(fplIds);
    const missing = fplIds.filter((id) => !players.has(id));
    if (missing.length > 0) throw SquadError.unknownPlayer(missing);
    return players;
  }
}

function toPickDto(
  player: PlayerRow,
  pick: {
    slot: number;
    multiplier: number;
    isCaptain: boolean;
    isViceCaptain: boolean;
  },
): SquadPickDto {
  return {
    playerId: player.id,
    fplId: player.fplId,
    webName: player.webName,
    position: player.position,
    teamShortName: player.teamShortName,
    nowCost: player.nowCost,
    // Never inferred from nowCost — see the schema comment on SquadPick.sellValue.
    sellValue: null,
    slot: pick.slot,
    multiplier: pick.multiplier,
    isCaptain: pick.isCaptain,
    isViceCaptain: pick.isViceCaptain,
  };
}
