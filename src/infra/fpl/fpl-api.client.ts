import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import {
  Bootstrap,
  ElementSummary,
  RawFixture,
} from './fpl.types';

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

  /** Stable content hash of a payload, so an unchanged sync can skip its writes. */
  hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async get<T>(path: string, attempt = 1): Promise<T> {
    const maxAttempts = 4;
    try {
      const res = await this.http.get<T>(path);
      return res.data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      // 4xx other than 429 will not fix themselves — do not retry.
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt >= maxAttempts) {
        throw new Error(
          `FPL GET ${path} failed (attempt ${attempt}/${maxAttempts}` +
            `${status ? `, status ${status}` : ''}): ${(err as Error).message}`,
        );
      }
      const backoffMs = 500 * 2 ** (attempt - 1);
      this.log.warn(`GET ${path} attempt ${attempt} failed; retrying in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
      return this.get<T>(path, attempt + 1);
    }
  }
}
