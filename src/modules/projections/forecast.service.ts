import { Injectable, Logger } from '@nestjs/common';
import { PositionCode } from '../fpl-sync/mappers';
import { Scoring } from './scoring';
import { FITTED_PARAMS } from './fitted';
import { minutesDistribution, projectFixtureV2 } from './model-v2';
import { ForecastRepository } from './forecast.repository';
import { HistoryRow, walkRounds } from './features';


/**
 * Projects a real, upcoming gameweek with the fitted model (B-007 Phase 4e).
 *
 * The same feature engine the backtest uses, fed the same way, with one difference: the round being
 * projected has not happened, so its rows are synthetic — the fixtures, with every stat left at zero.
 * That works because the engine yields a round's features BEFORE folding that round in, so a
 * synthetic row cannot inform the projection that reads it. The backtest and the forecast are then
 * the same code path, which is the only way a number measured in a backtest means anything when it is
 * served.
 *
 * History is the archive plus this season, joined on `Player.code` and indistinguishable to the
 * model. That matters most in August: this season has one gameweek, and a player who has been in the
 * league before brings three seasons of rates with him.
 */

export interface PlayerForecast {
  playerCode: number;
  playerId: string | null;
  webName: string;
  position: PositionCode;
  nowCost: number;
  expectedPoints: number;
  expectedMinutes: number;
  playProbability: number;
  components: Record<string, number>;
  fixtures: number;
  /** false when availability came from the live row rather than a captured deadline snapshot */
  availabilityFromSnapshot: boolean;
  status: string;
}

export interface ForecastSummary {
  gameweekId: number;
  players: number;
  fixtures: number;
  fromSnapshot: number;
  /** players with no history in the archive or this season — projected off positional means alone */
  withoutHistory: number;
}

@Injectable()
export class ForecastService {
  private readonly log = new Logger(ForecastService.name);

  constructor(private readonly repo: ForecastRepository) {}

  async forecast(
    gameweekId?: number,
  ): Promise<{ summary: ForecastSummary; players: PlayerForecast[] }> {
    const target = gameweekId ?? (await this.repo.nextGameweek());
    if (target === null) {
      throw new Error('no upcoming gameweek — nothing to project');
    }
    const [result] = await this.forecastMany([target]);
    return result;
  }

  /**
   * Project several gameweeks, loading history once and walking once PER gameweek.
   *
   * One walk covering all of them would be wrong, not merely convenient: the synthetic rows of GW3
   * would be folded into the accumulators before GW4 is projected, so every player would gain a
   * zero-minute appearance per future gameweek — dragging their rates down — and every future fixture
   * would enter team strength with zero xG, making the whole league look like it had stopped
   * attacking. A separate walk per target keeps each projection reading real history only.
   */
  async forecastMany(
    gameweekIds: number[],
  ): Promise<{ summary: ForecastSummary; players: PlayerForecast[] }[]> {
    const scoring = Scoring.from(await this.repo.liveScoring());
    const [archive, current, playerId] = await Promise.all([
      this.repo.archiveHistory(),
      this.repo.currentSeasonHistory(),
      this.repo.playerIdByCode(),
    ]);
    const history = [...archive, ...current];

    const out: { summary: ForecastSummary; players: PlayerForecast[] }[] = [];
    for (const gw of gameweekIds) {
      out.push(
        await this.forecastOne(gw, history, scoring, playerId),
      );
    }
    return out;
  }

  private async forecastOne(
    target: number,
    history: HistoryRow[],
    scoring: Scoring,
    playerId: Map<number, string>,
  ): Promise<{ summary: ForecastSummary; players: PlayerForecast[] }> {
    const [synthetic, availability] = await Promise.all([
      this.repo.syntheticRowsFor(target),
      this.repo.availabilityByCode(target),
    ]);

    if (synthetic.length === 0) {
      throw new Error(
        `gameweek ${target} has no fixtures in the database — run \`pnpm sync:fpl\` first`,
      );
    }

    const rows: HistoryRow[] = [...history, ...synthetic];
    const syntheticSet = new Set(synthetic);

    // One entry per player, summed across their fixtures — a double gameweek is two fixtures and
    // therefore two projections that add, a blank is no fixture and therefore no entry at all.
    const byCode = new Map<number, PlayerForecast>();
    let withoutHistory = 0;
    let fromSnapshot = 0;

    for (const context of walkRounds(rows, FITTED_PARAMS)) {
      for (const { row, features, goalRates } of context.items) {
        if (!syntheticSet.has(row)) continue;

        const avail = availability.get(row.playerCode);
        const multiplier = availabilityMultiplier(
          avail?.status ?? 'a',
          avail?.chance ?? null,
        );
        const minutes = minutesDistribution(
          features.laggedStartRate,
          multiplier,
          FITTED_PARAMS,
        );
        const projection = projectFixtureV2(
          row.position,
          minutes,
          features.rates,
          goalRates,
          scoring,
          FITTED_PARAMS,
        );

        let entry = byCode.get(row.playerCode);
        if (!entry) {
          if (features.matchesSample === 0) withoutHistory++;
          if (avail?.fromSnapshot) fromSnapshot++;
          entry = {
            playerCode: row.playerCode,
            playerId: playerId.get(row.playerCode) ?? null,
            webName: row.webName,
            position: row.position,
            nowCost: row.value,
            expectedPoints: 0,
            expectedMinutes: 0,
            playProbability: minutes.pPlay,
            components: {},
            fixtures: 0,
            availabilityFromSnapshot: avail?.fromSnapshot ?? false,
            status: avail?.status ?? 'a',
          };
          byCode.set(row.playerCode, entry);
        }

        foldFixture(entry, projection, minutes.expectedMinutes);
      }
    }

    const players = [...byCode.values()].sort(
      (a, b) => b.expectedPoints - a.expectedPoints,
    );

    const fixtureCount = new Set(synthetic.map((r) => r.fixture)).size;
    this.log.log(
      `GW${target}: ${players.length} players over ${fixtureCount} fixtures, ` +
        `${fromSnapshot} using a captured deadline snapshot, ${withoutHistory} with no history`,
    );

    return {
      summary: {
        gameweekId: target,
        players: players.length,
        fixtures: fixtureCount,
        fromSnapshot,
        withoutHistory,
      },
      players,
    };
  }
}

/**
 * Add one fixture's projection into a player's running total for the gameweek.
 *
 * **Extracted so a double gameweek is testable.** A player with two fixtures in one event must have
 * both counted — the points from both matches score — and a player with none must produce no entry at
 * all, which is the caller's business because a blank is the *absence* of a call. `player_gameweek_stats`
 * is keyed by fixture rather than by gameweek for exactly this reason, and doubles and blanks are the
 * highest-leverage weeks of a season and the ones naive code silently gets wrong (`fpl-optimizer`).
 *
 * It was inline and untested until B-012 Phase 5. The behaviour was correct; nothing would have said
 * so if it stopped being.
 */
export function foldFixture(
  entry: PlayerForecast,
  projection: { ep: number; components: Record<string, number> },
  expectedMinutes: number,
): void {
  entry.expectedPoints += projection.ep;
  entry.expectedMinutes += expectedMinutes;
  entry.fixtures += 1;
  for (const [k, v] of Object.entries(projection.components)) {
    entry.components[k] = (entry.components[k] ?? 0) + v;
  }
}

/**
 * Availability from FPL's own status and chance fields.
 *
 * This is the half of the minutes model that is NOT fitted — the archive carries no per-gameweek
 * status, so there is nothing to fit it against until `player_deadline_snapshot` accumulates.
 * Deliberately simple, and deliberately conservative about `d`: a doubt with no percentage attached
 * is a doubt, not a probable start.
 *
 * `chance === null` means FULLY FIT, not unknown. Reading it as 0 benches every healthy player.
 */
export function availabilityMultiplier(
  status: string,
  chance: number | null,
): number {
  if (['i', 's', 'u', 'n'].includes(status)) return 0;
  if (chance !== null) return Math.max(0, Math.min(1, chance / 100));
  return status === 'd' ? 0.5 : 1;
}
