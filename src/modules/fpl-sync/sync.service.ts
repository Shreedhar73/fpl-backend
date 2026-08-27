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
  mapSeasonHistory,
  mapPositionQuotas,
  seasonLabel,
  MappedPlayer,
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
/**
 * How close a deadline must be for a sync to record a snapshot.
 *
 * 36 hours rather than 24: syncs are run by hand, and a Friday-morning deadline with the last sync on
 * Wednesday evening would fall outside a 24-hour window and be captured not at all. The row carries
 * `hoursToDeadline` so a distant capture is visible as one rather than being silently equal to a late
 * one.
 */
const SNAPSHOT_WINDOW_HOURS = 36;

/**
 * How many `event/{gw}/live/` payloads one sync run will fetch.
 *
 * Three, so a fresh database catches up on 38 gameweeks within a day of hourly syncs without ever
 * making a burst of 38 requests at ~440 KB each.
 */
const LIVE_CAPTURES_PER_RUN = 3;

@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);

  constructor(
    private readonly api: FplApiClient,
    private readonly repo: SyncRepository,
  ) {}

  /** Default mode: `bootstrap-static/` (teams, players, gameweeks, config, price+ownership) + `fixtures/`. */
  /**
   * Force the pre-deadline snapshot on the next run regardless of how far away the deadline is.
   *
   * `pnpm sync:fpl -- --snapshot`. The window exists so an ordinary sync does not record a snapshot
   * three weeks out and call it evidence; this exists because the person running the sync sometimes
   * knows better — a deliberate capture before a deadline that has not yet entered the window, or a
   * re-capture after late team news.
   */
  forceSnapshot = false;

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
        await this.repo.finishRun(run.id, {
          rowsWritten: 0,
          status: 'skipped',
          payloadHash: hash,
        });
        return {
          endpoint,
          mode: 'incremental',
          status: 'skipped',
          rowsWritten: 0,
        };
      }

      const pos = positionByType(data.element_types);
      const teamRows = await this.repo.upsertTeams(data.teams.map(mapTeam));
      const gwRows = await this.repo.upsertGameweeks(
        data.events.map(mapGameweek),
      );
      await this.repo.upsertScoringConfig(
        seasonLabel(data.events),
        data.game_config.scoring,
        data.game_config.rules,
        mapPositionQuotas(data.element_types),
      );

      const teamId = await this.repo.teamIdByFplId();
      const players = data.elements.map((e) => mapPlayer(e, pos));
      const playerRows = await this.repo.upsertPlayers(players, teamId);

      const playerId = await this.repo.playerIdByFplId();
      const priceRows = await this.repo.appendPriceHistory(
        players,
        playerId,
        run.startedAt,
      );
      const ownershipRows = await this.repo.appendOwnershipHistory(
        data.elements.map(mapOwnership),
        playerId,
        run.startedAt,
      );

      const snapshotRows = await this.captureDeadlineSnapshotIfDue(
        players,
        playerId,
        run.startedAt,
      );
      const liveRows = await this.captureLiveSnapshots();

      const rowsWritten =
        teamRows +
        gwRows +
        playerRows +
        priceRows +
        ownershipRows +
        snapshotRows +
        liveRows;
      await this.repo.finishRun(run.id, {
        rowsWritten,
        status: 'success',
        payloadHash: hash,
      });
      this.log.log(
        `bootstrap: ${teamRows} teams, ${gwRows} gameweeks, ${playerRows} players, ` +
          `${priceRows} price rows, ${ownershipRows} ownership rows` +
          (snapshotRows > 0 ? `, ${snapshotRows} deadline-snapshot rows` : '') +
          (liveRows > 0 ? `, ${liveRows} live-payload capture(s)` : ''),
      );
      return { endpoint, mode: 'incremental', status: 'success', rowsWritten };
    } catch (err) {
      const message = (err as Error).message;
      await this.repo.finishRun(run.id, {
        rowsWritten: 0,
        status: 'failed',
        error: message,
      });
      this.log.error(`bootstrap sync failed: ${message}`);
      return {
        endpoint,
        mode: 'incremental',
        status: 'failed',
        rowsWritten: 0,
        error: message,
      };
    }
  }

  private async syncFixtures(): Promise<SyncRunSummary> {
    const endpoint = 'fixtures/';
    const run = await this.repo.startRun(endpoint, 'incremental');
    try {
      const data = await this.api.getFixtures();
      const hash = this.api.hash(data);
      if ((await this.repo.lastGoodHash(endpoint)) === hash) {
        await this.repo.finishRun(run.id, {
          rowsWritten: 0,
          status: 'skipped',
          payloadHash: hash,
        });
        return {
          endpoint,
          mode: 'incremental',
          status: 'skipped',
          rowsWritten: 0,
        };
      }
      const teamId = await this.repo.teamIdByFplId();
      const rowsWritten = await this.repo.upsertFixtures(
        data.map(mapFixture),
        teamId,
      );
      await this.repo.finishRun(run.id, {
        rowsWritten,
        status: 'success',
        payloadHash: hash,
      });
      this.log.log(`fixtures: ${rowsWritten} upserted`);
      return { endpoint, mode: 'incremental', status: 'success', rowsWritten };
    } catch (err) {
      const message = (err as Error).message;
      await this.repo.finishRun(run.id, {
        rowsWritten: 0,
        status: 'failed',
        error: message,
      });
      this.log.error(`fixtures sync failed: ${message}`);
      return {
        endpoint,
        mode: 'incremental',
        status: 'failed',
        rowsWritten: 0,
        error: message,
      };
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
        throw new Error(
          'no players in the database — run the incremental sync first',
        );
      }

      const fplIds = [...playerId.keys()];
      const cap = this.api.backfillConcurrency;
      let statRows = 0;
      let seasonRows = 0;
      let failedPlayers = 0;

      for (let i = 0; i < fplIds.length; i += cap) {
        const batch = fplIds.slice(i, i + cap);
        const results = await Promise.all(
          batch.map(
            async (
              id,
            ): Promise<{ id: number; summary: ElementSummary | null }> => {
              try {
                return { id, summary: await this.api.getElementSummary(id) };
              } catch (err) {
                failedPlayers++;
                this.log.warn(
                  `element-summary ${id} failed: ${(err as Error).message}`,
                );
                return { id, summary: null };
              }
            },
          ),
        );
        const got = results.filter(
          (r): r is { id: number; summary: ElementSummary } =>
            r.summary !== null,
        );

        const stats = got.flatMap((r) =>
          r.summary.history.map(mapGameweekStat),
        );
        statRows += await this.repo.upsertGameweekStats(
          stats,
          playerId,
          fixtureId,
        );

        const seasonEntries = got
          .map((r) => ({
            playerId: playerId.get(r.id),
            seasons: r.summary.history_past.map(mapSeasonHistory),
          }))
          .filter(
            (
              e,
            ): e is {
              playerId: string;
              seasons: ReturnType<typeof mapSeasonHistory>[];
            } => e.playerId !== undefined && e.seasons.length > 0,
          );
        seasonRows += await this.repo.upsertSeasonHistory(seasonEntries);

        if (i + cap < fplIds.length) {
          await new Promise((r) =>
            setTimeout(r, this.api.backfillBatchDelayMs),
          );
        }
      }

      const rowsWritten = statRows + seasonRows;
      const status = failedPlayers === 0 ? 'success' : 'partial';
      await this.repo.finishRun(run.id, {
        rowsWritten,
        status,
        error: failedPlayers
          ? `${failedPlayers} players failed to fetch`
          : undefined,
      });
      this.log.log(
        `full backfill: ${statRows} gameweek-stat rows, ${seasonRows} prior-season rows, ` +
          `${failedPlayers} players failed`,
      );
      return [{ endpoint, mode: 'full', status, rowsWritten }];
    } catch (err) {
      const message = (err as Error).message;
      await this.repo.finishRun(run.id, {
        rowsWritten: 0,
        status: 'failed',
        error: message,
      });
      this.log.error(`full backfill failed: ${message}`);
      return [
        {
          endpoint,
          mode: 'full',
          status: 'failed',
          rowsWritten: 0,
          error: message,
        },
      ];
    }
  }

  /**
   * Capture the pre-deadline snapshot when a deadline is close enough for it to mean something.
   *
   * **Why this is inside the ordinary sync rather than a job of its own.** The thing being captured is
   * the bootstrap payload this sync has just fetched; a separate job would fetch it a second time to
   * record what we already had. And a capture that has to be remembered is a capture that will be
   * missed once — after which that gameweek's `status`, `chance_of_playing` and `ep_next` are gone
   * from every source there is (D-016: the community archive has none of them either).
   *
   * The window is generous on purpose. A snapshot at 20 hours is weaker evidence about a late fitness
   * call than one at two hours, but it is enormously better than nothing, and `hoursToDeadline` on the
   * row lets the fit tell them apart rather than forcing a choice now.
   *
   * Returns 0 outside the window, and 0 after the last deadline of a season — both normal.
   */
  private async captureDeadlineSnapshotIfDue(
    players: MappedPlayer[],
    playerId: Map<number, string>,
    capturedAt: Date,
  ): Promise<number> {
    const next = await this.repo.nextDeadline(capturedAt);
    if (!next) {
      this.log.log('no upcoming deadline — no snapshot to take');
      return 0;
    }

    const hours =
      (next.deadlineTime.getTime() - capturedAt.getTime()) / 3_600_000;
    if (hours > SNAPSHOT_WINDOW_HOURS && !this.forceSnapshot) {
      this.log.log(
        `next deadline (GW${next.gameweekId}) is ${hours.toFixed(1)}h away — ` +
          `outside the ${SNAPSHOT_WINDOW_HOURS}h snapshot window`,
      );
      return 0;
    }

    const rows = await this.repo.captureDeadlineSnapshot(
      players,
      playerId,
      next.gameweekId,
      next.deadlineTime,
      capturedAt,
    );
    this.log.log(
      `deadline snapshot: ${rows} players captured for GW${next.gameweekId}, ` +
        `${hours.toFixed(1)}h before the deadline` +
        (hours > SNAPSHOT_WINDOW_HOURS ? ' (forced, outside the window)' : ''),
    );
    return rows;
  }

  /**
   * `--live` is not implemented in this pass. The `event/{gw}/live/` element carries neither the
   * fixture-scoped `was_home`/`opponent_team` nor the price a `player_gameweek_stats` row needs, so
   * it requires joins the finished-gameweek `--full` path does not — and it can only be verified
   * against a genuinely in-progress gameweek. `--full` already covers every finished gameweek. See
   * B-003 / docs/plans/003-fpl-sync.md.
   *
   * The parameter stays in the signature — it is the contract callers will use once this is
   * implemented, and deleting it to satisfy the linter would change that contract.
   */
  /**
   * **Decided 2026-08-27 (B-016, and see `docs/decisions.md`): this stays unimplemented, and it is
   * no longer owed.**
   *
   * It was opened as a B-003 follow-up for two reasons and both are answered elsewhere.
   *
   * - *Calibration needs the `explain` blocks.* It does — and `captureLiveSnapshots` below now takes
   *   the whole payload on the ordinary sync, which is strictly better than a mode a human has to
   *   remember to run.
   * - *In-play display.* Nothing in this product shows a live score. The whole surface is a
   *   pre-deadline advisor, and a half-built in-play path would be an unused code path polling an
   *   endpoint every few minutes — the opposite of being a good guest (`fpl-api-reference`).
   *
   * It rejects rather than being deleted so that a caller passing `--live` gets a sentence rather
   * than a silence.
   */
  runLive(gameweek: number): Promise<never> {
    void gameweek;
    return Promise.reject(
      new Error(
        'live sync is deliberately not implemented — see docs/decisions.md D-027. The `explain` ' +
          'blocks it was owed for are captured by the ordinary sync into gameweek_live_snapshot; ' +
          'nothing in this product displays an in-play score. Use the default or --full mode.',
      ),
    );
  }

  /**
   * Capture `event/{gw}/live/` in full for any finished gameweek that has not been captured yet.
   *
   * **This exists because the payload disappears.** The endpoint serves the current season only and
   * no archive carries the `explain` blocks — FPL's own per-identifier answer key, and the only
   * thing that ever let this project verify its points engine against the source rather than against
   * its own reading of the rules. At season rollover they are gone for good.
   *
   * It rides the ordinary sync for the same reason the deadline snapshot does: a capture that
   * depends on somebody remembering to run a command is a capture that will be missed exactly once,
   * and once is enough. `doctor.sh` reports a finished gameweek with no capture behind it, so a
   * trigger that stops firing is visible rather than silent.
   *
   * Capped per run. On a fresh database this would otherwise fetch 38 payloads of ~440 KB in a
   * burst; a handful per hourly sync catches up within a day and stays a polite guest.
   */
  private async captureLiveSnapshots(): Promise<number> {
    const due = await this.repo.gameweeksNeedingLiveCapture(
      LIVE_CAPTURES_PER_RUN,
    );
    let captured = 0;
    for (const gameweekId of due) {
      try {
        const payload = await this.api.getEventLive(gameweekId);
        const elements = Array.isArray(
          (payload as { elements?: unknown[] })?.elements,
        )
          ? (payload as { elements: unknown[] }).elements.length
          : 0;
        if (elements === 0) {
          // An empty payload is not a capture. Storing it would satisfy the "has a snapshot" check
          // for ever and leave nothing behind it — the exact shape of a guard that cannot go red.
          this.log.warn(
            `GW${gameweekId}: event/live returned no elements — not captured`,
          );
          continue;
        }
        await this.repo.storeLiveSnapshot(gameweekId, payload, elements);
        captured++;
        this.log.log(
          `captured event/${gameweekId}/live — ${elements} elements, before season rollover takes it`,
        );
      } catch (err) {
        // A failed capture must not fail the sync: the rest of the run is the data the product
        // serves from, and this is a retention job that the next hourly run will retry.
        this.log.warn(
          `GW${gameweekId}: live capture failed (${(err as Error).message}) — will retry next sync`,
        );
      }
    }
    return captured;
  }
}
