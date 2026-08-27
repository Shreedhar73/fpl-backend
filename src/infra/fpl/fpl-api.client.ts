import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import {
  Bootstrap,
  ElementSummary,
  RawEntry,
  RawEntryHistory,
  RawEntryPicks,
  RawEntryTransfer,
  RawFixture,
} from './fpl.types';

/**
 * Thrown by every call here. `status` is the upstream HTTP status when there was one, and it is
 * load-bearing for the on-demand `entry/` reads: a 404 means the manager id does not exist and is
 * the user's mistake, while a timeout or a 5xx is upstream's and must not be reported as either.
 * The bulk sync callers only ever needed the message, so they are unaffected.
 */
export class FplHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'FplHttpError';
  }
}

/**
 * The only place the app talks to the official FPL API. Lives in `src/infra/` because it is
 * cross-cutting — the sync uses it today, other read jobs may later (fpl-architecture-contract §2).
 *
 * Etiquette (fpl-api-reference §etiquette): a real User-Agent, one in-flight request for the bulk
 * endpoints, a small concurrency cap with a delay between batches for the per-player backfill, and
 * a bounded retry. We are a guest with no SLA — a 502 upstream must never become a 502 from us, so
 * every call here is off the request path by construction (only the sync invokes it).
 */
@Injectable()
export class FplApiClient {
  private readonly log = new Logger(FplApiClient.name);
  private readonly http: AxiosInstance;

  /** ≤4 concurrent element-summary requests, per the etiquette rule. */
  readonly backfillConcurrency = 4;
  /** delay between element-summary batches, ms. */
  readonly backfillBatchDelayMs = 500;

  constructor() {
    this.http = axios.create({
      baseURL: 'https://fantasy.premierleague.com/api/',
      timeout: 30_000,
      headers: {
        'User-Agent':
          'fpl-orchestrator/1.0 (+https://github.com/Shreedhar73/fpl-orchestrator) squad-optimizer',
        Accept: 'application/json',
      },
    });
  }

  async getBootstrap(): Promise<Bootstrap> {
    return this.get<Bootstrap>('bootstrap-static/');
  }

  async getFixtures(): Promise<RawFixture[]> {
    return this.get<RawFixture[]>('fixtures/');
  }

  async getEventLive(gameweek: number): Promise<unknown> {
    return this.get<unknown>(`event/${gameweek}/live/`);
  }

  async getElementSummary(playerFplId: number): Promise<ElementSummary> {
    return this.get<ElementSummary>(`element-summary/${playerFplId}/`);
  }

  /**
   * The two on-demand reads, and the only calls here that sit on a user request path — a manager
   * id nobody has typed yet cannot be pre-synced. They are the carve-out the etiquette rule now
   * names: small payloads, a short timeout, and one attempt rather than four, because a user is
   * waiting and a retry storm is the opposite of being a good guest. The result is persisted, so a
   * second visit reads Postgres and makes no upstream call at all.
   */
  async getEntry(managerId: number): Promise<RawEntry> {
    return this.get<RawEntry>(`entry/${managerId}/`, 1, this.onDemand);
  }

  async getEntryPicks(
    managerId: number,
    gameweek: number,
  ): Promise<RawEntryPicks> {
    return this.get<RawEntryPicks>(
      `entry/${managerId}/event/${gameweek}/picks/`,
      1,
      this.onDemand,
    );
  }

  /**
   * The transfer log and the season history — the two reads B-008 needs and nothing else does.
   *
   * On-demand like the other `entry/` calls: they sit on a user request path, so one attempt and a
   * short timeout. `transfers/` returning `[]` is the normal state of a manager who has not
   * transferred, and callers must not read an empty array as a failure.
   */
  async getEntryTransfers(managerId: number): Promise<RawEntryTransfer[]> {
    return this.get<RawEntryTransfer[]>(
      `entry/${managerId}/transfers/`,
      1,
      this.onDemand,
    );
  }

  async getEntryHistory(managerId: number): Promise<RawEntryHistory> {
    return this.get<RawEntryHistory>(
      `entry/${managerId}/history/`,
      1,
      this.onDemand,
    );
  }

  private readonly onDemand = { timeoutMs: 5_000, maxAttempts: 1 };

  /** Stable content hash of a payload, so an unchanged sync can skip its writes. */
  hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async get<T>(
    path: string,
    attempt = 1,
    opts: { timeoutMs?: number; maxAttempts?: number } = {},
  ): Promise<T> {
    const maxAttempts = opts.maxAttempts ?? 4;
    try {
      const res = await this.http.get<T>(path, { timeout: opts.timeoutMs });
      return res.data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const timedOut =
        axios.isAxiosError(err) &&
        (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT');
      // 4xx other than 429 will not fix themselves — do not retry.
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt >= maxAttempts) {
        throw new FplHttpError(
          `FPL GET ${path} failed (attempt ${attempt}/${maxAttempts}` +
            `${status ? `, status ${status}` : ''}): ${(err as Error).message}`,
          status,
          timedOut,
        );
      }
      const backoffMs = 500 * 2 ** (attempt - 1);
      this.log.warn(
        `GET ${path} attempt ${attempt} failed; retrying in ${backoffMs}ms`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
      // `opts` must be carried through: dropping it would silently restore the bulk timeout and
      // retry count on the second attempt of an on-demand call.
      return this.get<T>(path, attempt + 1, opts);
    }
  }
}
