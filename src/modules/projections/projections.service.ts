import { Injectable, Logger } from '@nestjs/common';
import { ProjectionsRepository, ProjectionRow } from './projections.repository';
import { ForecastService, PlayerForecast } from './forecast.service';
import { FITTED_PARAMS } from './fitted';

/**
 * The ONE thing that writes projections.
 *
 * That is this file's job, not an implementation detail. Serving picks the model version by
 * `createdAt desc` (`latestProjectionModelVersion()`), so whichever writer ran last is what the whole
 * app serves — optimiser, insights, the frontend advice panel. For a day there were two: `pnpm
 * project` writing the v1 heuristic and `pnpm forecast` writing the fitted model, taking turns with no
 * error and nothing visible to say which had won. `/fpl:plan-gameweek` step 4 says "run the projection
 * job", which would have silently reverted the app to v1 on the next weekly run.
 *
 * So this service IS the fitted path now: it delegates to `ForecastService`, which runs the same
 * feature engine and the same model the backtest measured. `pnpm forecast` is gone, and so is the v1
 * heuristic it would have competed with. A second writer needs a better reason than convenience, and
 * a decision about which one serves.
 *
 * What the model is and is not: `fitted.ts` and `docs/decisions.md` D-017. The number worth carrying
 * around — on a held-out season it beats a trailing-form baseline on RMSE and bias and loses to it on
 * MAE, and its availability term is not fitted at all.
 */

/** Bumped when the fitted parameters change, so older projections stay comparable rather than lost. */
export const MODEL_VERSION = `v2-fitted-${FITTED_PARAMS.provenance.date}`;

const HORIZON = 5;

export interface ProjectionSummary {
  modelVersion: string;
  playersProjected: number;
  gameweekIds: number[];
  rowsWritten: number;
  nextGameweek: number | null;
  /** how many of the next gameweek's players were priced off a captured deadline snapshot */
  fromSnapshot: number;
  /** players with no history in the archive or this season — positional means alone */
  withoutHistory: number;
  top: {
    webName: string;
    position: string;
    nowCost: number;
    nextGwEp: number;
    horizonEp: number;
  }[];
}

@Injectable()
export class ProjectionsService {
  private readonly log = new Logger(ProjectionsService.name);

  constructor(
    private readonly repo: ProjectionsRepository,
    private readonly forecast: ForecastService,
  ) {}

  async run(horizon = HORIZON): Promise<ProjectionSummary> {
    const gameweekIds = await this.repo.horizonGameweeks(horizon);
    if (gameweekIds.length === 0) {
      throw new Error('no upcoming gameweeks — nothing to project');
    }

    const results = await this.forecast.forecastMany(gameweekIds);

    const rows: ProjectionRow[] = [];
    // Horizon totals per player, so the printed table shows what a squad picker optimises over
    // rather than only the next gameweek.
    const horizonEp = new Map<number, number>();

    for (const { summary, players } of results) {
      for (const p of players) {
        horizonEp.set(
          p.playerCode,
          (horizonEp.get(p.playerCode) ?? 0) + p.expectedPoints,
        );
        if (p.playerId === null) continue;
        rows.push({
          playerId: p.playerId,
          gameweekId: summary.gameweekId,
          modelVersion: MODEL_VERSION,
          expectedPoints: round(p.expectedPoints, 2),
          expectedMinutes: round(p.expectedMinutes, 2),
          playProbability: round(p.playProbability, 3),
          components: {
            ...Object.fromEntries(
              Object.entries(p.components).map(([k, v]) => [k, round(v, 3)]),
            ),
            fixtures: p.fixtures,
          },
        });
      }
    }

    const rowsWritten = await this.repo.writeProjections(rows);
    const next = results[0];

    this.log.log(
      `${MODEL_VERSION}: ${rowsWritten} rows over GW${gameweekIds.join(', GW')} — ` +
        `${next.summary.fromSnapshot} of GW${next.summary.gameweekId}'s players on a captured ` +
        `deadline snapshot, ${next.summary.withoutHistory} with no history`,
    );

    return {
      modelVersion: MODEL_VERSION,
      playersProjected: next.players.length,
      gameweekIds,
      rowsWritten,
      nextGameweek: next.summary.gameweekId,
      fromSnapshot: next.summary.fromSnapshot,
      withoutHistory: next.summary.withoutHistory,
      top: topPlayers(next.players, horizonEp),
    };
  }
}

function topPlayers(
  players: PlayerForecast[],
  horizonEp: Map<number, number>,
): ProjectionSummary['top'] {
  return players.slice(0, 15).map((p) => ({
    webName: p.webName,
    position: p.position,
    nowCost: p.nowCost,
    nextGwEp: round(p.expectedPoints, 2),
    horizonEp: round(horizonEp.get(p.playerCode) ?? 0, 2),
  }));
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
