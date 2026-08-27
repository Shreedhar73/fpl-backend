import { Injectable, Logger } from '@nestjs/common';
import { ProjectionsRepository, ProjectionRow } from './projections.repository';
import { ForecastService, PlayerForecast } from './forecast.service';
import { CandidateService } from './candidate.service';
import { AVAILABILITY_CANDIDATE_PARAMS, FITTED_PARAMS } from './fitted';

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

/**
 * Bumped when the fitted parameters change, so older projections stay comparable rather than lost.
 *
 * **v3, not v2, and the major number is not decoration.** v2 was v1's structure with fitted
 * constants. v3 changed the STRUCTURE in three places, each measured on the same held-out rows:
 *
 * - the substitute-appearance term became a per-player curve instead of one league-wide constant
 *   (B-019) — `P(any appearance)` Brier reliability 0.0121 to 0.0009;
 * - every non-linear term is integrated over the minutes distribution and not only over the count
 *   (B-020) — `P(defcon >= threshold)` 0.013 predicted against a 0.054 base rate, now 0.048;
 * - team strength reads decay-weighted actual goals alongside expected goals (B-014), which is what
 *   let the fixture elasticities fit to something other than zero for the first time.
 *
 * Two models that disagree about a player's expected points must not share a name in a table that
 * is queried by name.
 */
export const MODEL_VERSION = `v3-fitted-${FITTED_PARAMS.provenance.date}`;

/**
 * The availability candidate's version (plan 024). Never served — the optimizer's version is pinned
 * to MODEL_VERSION; these rows exist so `pnpm score:gameweek` scores the fitted-availability regime
 * beside the incumbent on the live season, which is the prospective half of plan 024's referee.
 */
export const AVAILABILITY_MODEL_VERSION = `v3-avail-${AVAILABILITY_CANDIDATE_PARAMS.provenance.date}`;

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
    private readonly candidate: CandidateService,
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
          sd: round(p.distribution.sd, 3),
          pBlank: round(p.distribution.pBlank, 3),
          pHaul: round(p.distribution.pHaul, 3),
        });
      }
    }

    const rowsWritten = await this.repo.writeProjections(rows);

    // The candidate rides the same weekly run (B-037): its rows land under its own version, are
    // scored by `pnpm score:gameweek` beside these, and are never served — the optimizer's version
    // is pinned to MODEL_VERSION. A candidate that only produces numbers when someone remembers to
    // run a second command produces no prospective evidence at all.
    try {
      await this.candidate.run(gameweekIds);
    } catch (err) {
      // The incumbent's projections must not be hostage to the candidate's: log and continue.
      this.log.warn(
        `candidate projections failed (incumbent rows are written): ${err instanceof Error ? err.message : err}`,
      );
    }

    // The availability candidate (plan 024) rides the same run, through the SAME forecast machinery
    // with its own params — one feature engine, one projection path, a second version of rows.
    try {
      const availResults = await this.forecast.forecastMany(
        gameweekIds,
        AVAILABILITY_CANDIDATE_PARAMS,
      );
      const availRows: ProjectionRow[] = [];
      for (const { summary, players } of availResults) {
        for (const p of players) {
          if (p.playerId === null) continue;
          availRows.push({
            playerId: p.playerId,
            gameweekId: summary.gameweekId,
            modelVersion: AVAILABILITY_MODEL_VERSION,
            expectedPoints: round(p.expectedPoints, 2),
            expectedMinutes: round(p.expectedMinutes, 2),
            playProbability: round(p.playProbability, 3),
            components: {
              ...Object.fromEntries(
                Object.entries(p.components).map(([k, v]) => [k, round(v, 3)]),
              ),
              fixtures: p.fixtures,
            },
            sd: round(p.distribution.sd, 3),
            pBlank: round(p.distribution.pBlank, 3),
            pHaul: round(p.distribution.pHaul, 3),
          });
        }
      }
      const availWritten = await this.repo.writeProjections(availRows);
      this.log.log(
        `${AVAILABILITY_MODEL_VERSION}: ${availWritten} candidate rows — scored weekly beside the ` +
          `incumbent; never served (the optimizer's version is pinned)`,
      );
    } catch (err) {
      this.log.warn(
        `availability-candidate projections failed (incumbent rows are written): ${err instanceof Error ? err.message : err}`,
      );
    }

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
