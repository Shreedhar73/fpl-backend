import { Injectable, Logger } from '@nestjs/common';
import { FplApiClient } from '../../infra/fpl/fpl-api.client';
import { SyncRepository } from './sync.repository';
import {
  positionByType,
  mapTeam,
  mapPlayer,
  mapGameweek,
  mapFixture,
  mapOwnership,
  mapGameweekStat,
  seasonLabel,
} from './mappers';
import { ElementSummary } from '../../infra/fpl/fpl.types';

export interface SyncRunSummary {
  endpoint: string;
  mode: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  rowsWritten: number;
  error?: string;
}

/**
 * Orchestrates the sync: fetch upstream, map at the boundary, write through the repository, and
 * record a `sync_runs` row per endpoint per pass. Knows nothing about Prisma directly
 * (fpl-architecture-contract §2). Read-only against FPL; no auth, no writes back (D-013).
 *
 * A pass over an endpoint whose payload hash matches the last good run is recorded as `skipped`
 * with 0 rows — the upserts would be no-ops anyway, and skipping saves the work.
 */
@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);

  constructor(
    private readonly api: FplApiClient,
    private readonly repo: SyncRepository,
  ) {}

  /** Default mode: `bootstrap-static/` (teams, players, gameweeks, config, price+ownership) + `fixtures/`. */
  async runIncremental(): Promise<SyncRunSummary[]> {
    const bootstrap = await this.syncBootstrap();
    const fixtures = await this.syncFixtures();
    return [bootstrap, fixtures];
  }

  private async syncBootstrap(): Promise<SyncRunSummary> {
    const endpoint = 'bootstrap-static/';
    const run = await this.repo.startRun(endpoint, 'incremental');
    try {
      const data = await this.api.getBootstrap();
      const hash = this.api.hash(data);
      if ((await this.repo.lastGoodHash(endpoint)) === hash) {
        await this.repo.finishRun(run.id, { rowsWritten: 0, status: 'skipped', payloadHash: hash });
        return { endpoint, mode: 'incremental', status: 'skipped', rowsWritten: 0 };
      }

      const pos = positionByType(data.element_types);
      const teamRows = await this.repo.upsertTeams(data.teams.map(mapTeam));
      const gwRows = await this.repo.upsertGameweeks(data.events.map(mapGameweek));
      await this.repo.upsertScoringConfig(
        seasonLabel(data.events),
        data.game_config.scoring,
        data.game_config.rules,
      );

      const teamId = await this.repo.teamIdByFplId();
      const players = data.elements.map((e) => mapPlayer(e, pos));
      const playerRows = await this.repo.upsertPlayers(players, teamId);

      const playerId = await this.repo.playerIdByFplId();
      const priceRows = await this.repo.appendPriceHistory(players, playerId, run.startedAt);
      const ownershipRows = await this.repo.appendOwnershipHistory(
        data.elements.map(mapOwnership),
        playerId,
        run.startedAt,
      );

      const rowsWritten = teamRows + gwRows + playerRows + priceRows + ownershipRows;
      await this.repo.finishRun(run.id, { rowsWritten, status: 'success', payloadHash: hash });
      this.log.log(
        `bootstrap: ${teamRows} teams, ${gwRows} gameweeks, ${playerRows} players, ` +
          `${priceRows} price rows, ${ownershipRows} ownership rows`,
      );
      return { endpoint, mode: 'incremental', status: 'success', rowsWritten };
    } catch (err) {
      const message = (err as Error).message;
      await this.repo.finishRun(run.id, { rowsWritten: 0, status: 'failed', error: message });
      this.log.error(`bootstrap sync failed: ${message}`);
      return { endpoint, mode: 'incremental', status: 'failed', rowsWritten: 0, error: message };
    }
  }

  private async syncFixtures(): Promise<SyncRunSummary> {
    const endpoint = 'fixtures/';
    const run = await this.repo.startRun(endpoint, 'incremental');
    try {
      const data = await this.api.getFixtures();
      const hash = this.api.hash(data);
      if ((await this.repo.lastGoodHash(endpoint)) === hash) {
        await this.repo.finishRun(run.id, { rowsWritten: 0, status: 'skipped', payloadHash: hash });
        return { endpoint, mode: 'incremental', status: 'skipped', rowsWritten: 0 };
      }
      const teamId = await this.repo.teamIdByFplId();
      const rowsWritten = await this.repo.upsertFixtures(data.map(mapFixture), teamId);
      await this.repo.finishRun(run.id, { rowsWritten, status: 'success', payloadHash: hash });
      this.log.log(`fixtures: ${rowsWritten} upserted`);
      return { endpoint, mode: 'incremental', status: 'success', rowsWritten };
    } catch (err) {
      const message = (err as Error).message;
      await this.repo.finishRun(run.id, { rowsWritten: 0, status: 'failed', error: message });
      this.log.error(`fixtures sync failed: ${message}`);
      return { endpoint, mode: 'incremental', status: 'failed', rowsWritten: 0, error: message };
    }
  }

  /**
   * `--full`: backfill this season's per-gameweek history from `element-summary/{id}/`, one request
   * per player, rate-limited to the client's concurrency cap. Requires the snapshot tables to exist
   * (run incremental first) so player and fixture fpl ids resolve to internal keys.
   */
  async runFull(): Promise<SyncRunSummary[]> {
    const endpoint = 'element-summary/{id}/';
    const run = await this.repo.startRun(endpoint, 'full');
    try {
      const playerId = await this.repo.playerIdByFplId();
      const fixtureId = await this.repo.fixtureIdByFplId();
      if (playerId.size === 0) {
        throw new Error('no players in the database — run the incremental sync first');
      }

      const fplIds = [...playerId.keys()];
      const cap = this.api.backfillConcurrency;
      let rowsWritten = 0;
      let failedPlayers = 0;

      for (let i = 0; i < fplIds.length; i += cap) {
        const batch = fplIds.slice(i, i + cap);
        const summaries = await Promise.all(
          batch.map(async (id): Promise<ElementSummary | null> => {
            try {
              return await this.api.getElementSummary(id);
            } catch (err) {
              failedPlayers++;
              this.log.warn(`element-summary ${id} failed: ${(err as Error).message}`);
              return null;
            }
          }),
        );
        const stats = summaries
          .filter((s): s is ElementSummary => s !== null)
          .flatMap((s) => s.history.map(mapGameweekStat));
        rowsWritten += await this.repo.upsertGameweekStats(stats, playerId, fixtureId);
        if (i + cap < fplIds.length) {
          await new Promise((r) => setTimeout(r, this.api.backfillBatchDelayMs));
        }
      }

      const status = failedPlayers === 0 ? 'success' : 'partial';
      await this.repo.finishRun(run.id, {
        rowsWritten,
        status,
        error: failedPlayers ? `${failedPlayers} players failed to fetch` : undefined,
      });
      this.log.log(`full backfill: ${rowsWritten} gameweek-stat rows, ${failedPlayers} players failed`);
      return [{ endpoint, mode: 'full', status, rowsWritten }];
    } catch (err) {
      const message = (err as Error).message;
      await this.repo.finishRun(run.id, { rowsWritten: 0, status: 'failed', error: message });
      this.log.error(`full backfill failed: ${message}`);
      return [{ endpoint, mode: 'full', status: 'failed', rowsWritten: 0, error: message }];
    }
  }

  /**
   * `--live` is not implemented in this pass. The `event/{gw}/live/` element carries neither the
   * fixture-scoped `was_home`/`opponent_team` nor the price a `player_gameweek_stats` row needs, so
   * it requires joins the finished-gameweek `--full` path does not — and it can only be verified
   * against a genuinely in-progress gameweek. `--full` already covers every finished gameweek. See
   * B-003 / docs/plans/003-fpl-sync.md.
   */
  runLive(_gameweek: number): Promise<never> {
    return Promise.reject(
      new Error(
        'live sync is not implemented yet (B-003 follow-up). Use the default or --full mode; ' +
          '--full covers all finished gameweeks.',
      ),
    );
  }
}
