import { Injectable, Logger } from '@nestjs/common';
import {
  ProjectionsRepository,
  PlayerRow,
  PriorAggregate,
  ProjectionRow,
} from './projections.repository';
import { Scoring } from './scoring';
import { minutesModel } from './minutes';
import { projectFixture, RateInputs } from './model';

export const MODEL_VERSION = 'v1-fdr-blend';
const HORIZON = 5;
const DECAY = 0.84;
/** shrinkage constants: matches-worth of prior weight for the start rate, minutes-worth for rates. */
const START_SHRINK_GAMES = 4;
const RATE_SHRINK_MINUTES = 270;
const SEASON_GAMES = 38;

export interface ProjectionSummary {
  playersProjected: number;
  gameweekIds: number[];
  rowsWritten: number;
  nextGameweek: number | null;
  baselineMaeVsEpNext: number | null;
  top: {
    webName: string;
    nextGwEp: number;
    epNext: number | null;
    horizonEp: number;
  }[];
}

/**
 * Turns the stored inputs into expected points per player per gameweek and persists them. Minutes
 * first (it dominates), then the rate terms; early-season rates are shrunk toward the last two
 * seasons because a one-gameweek sample is mostly noise (`fpl-optimizer`). Scoring is read from
 * `scoring_config`, never hardcoded. Every value it writes is reconstructable from `components`.
 */
@Injectable()
export class ProjectionsService {
  private readonly log = new Logger(ProjectionsService.name);

  constructor(private readonly repo: ProjectionsRepository) {}

  async run(): Promise<ProjectionSummary> {
    const scoring = Scoring.from(await this.repo.loadScoring());
    const players = await this.repo.loadPlayers();
    const priors = await this.repo.loadPriors(2);
    const gwIds = await this.repo.horizonGameweeks(HORIZON);
    if (gwIds.length === 0)
      throw new Error('no upcoming gameweeks — nothing to project');
    const diffs = await this.repo.fixtureDifficulties(gwIds);
    const finishedGames = await this.repo.finishedGameweekCount();
    const nextGw = gwIds[0];

    const rows: ProjectionRow[] = [];
    const perPlayerNext = new Map<
      string,
      { player: PlayerRow; nextGwEp: number; horizonEp: number }
    >();

    for (const player of players) {
      const prior = priors.get(player.id);
      const startRate = blendStartRate(player, prior, finishedGames);
      const rates = blendRates(player, prior);
      const mins = minutesModel({
        status: player.status,
        chance: player.chance,
        startRate,
      });
      const expectedBonus = estimateBonus(rates);

      let horizonEp = 0;
      let nextGwEp = 0;
      for (let i = 0; i < gwIds.length; i++) {
        const gwId = gwIds[i];
        const teamDiffs = diffs.get(player.teamId)?.get(gwId) ?? []; // [] = blank gameweek
        let gwEp = 0;
        const components: Record<string, number> = {};
        for (const d of teamDiffs) {
          const fp = projectFixture(
            player.position,
            mins,
            rates,
            { difficulty: d },
            scoring,
            expectedBonus,
          );
          gwEp += fp.ep;
          for (const [k, v] of Object.entries(fp.components))
            components[k] = (components[k] ?? 0) + v;
        }
        components.fixtures = teamDiffs.length;
        rows.push({
          playerId: player.id,
          gameweekId: gwId,
          modelVersion: MODEL_VERSION,
          expectedPoints: round2(gwEp),
          expectedMinutes: round2(
            mins.pPlay * mins.eMinutesIfPlay * teamDiffs.length,
          ),
          playProbability: round3(mins.pPlay),
          components: roundComponents(components),
        });
        horizonEp += gwEp * DECAY ** i;
        if (i === 0) nextGwEp = gwEp;
      }
      perPlayerNext.set(player.id, { player, nextGwEp, horizonEp });
    }

    const rowsWritten = await this.repo.writeProjections(rows);

    // Baseline: our next-gameweek EP vs FPL's own ep_next (the number the model must beat).
    const withBaseline = [...perPlayerNext.values()].filter(
      (p) => p.player.epNext !== null,
    );
    const mae =
      withBaseline.length > 0
        ? withBaseline.reduce(
            (s, p) => s + Math.abs(p.nextGwEp - (p.player.epNext as number)),
            0,
          ) / withBaseline.length
        : null;

    const top = [...perPlayerNext.values()]
      .sort((a, b) => b.nextGwEp - a.nextGwEp)
      .slice(0, 15)
      .map((p) => ({
        webName: p.player.webName,
        nextGwEp: round2(p.nextGwEp),
        epNext: p.player.epNext,
        horizonEp: round2(p.horizonEp),
      }));

    this.log.log(
      `projected ${players.length} players over gameweeks ${gwIds.join(',')} — ${rowsWritten} rows` +
        (mae !== null ? `, MAE vs ep_next ${mae.toFixed(2)}` : ''),
    );
    return {
      playersProjected: players.length,
      gameweekIds: gwIds,
      rowsWritten,
      nextGameweek: nextGw,
      baselineMaeVsEpNext: mae === null ? null : round2(mae),
      top,
    };
  }
}

/** Blend current- and prior-season start rate, weighting current more as the season grows. */
export function blendStartRate(
  player: PlayerRow,
  prior: PriorAggregate | undefined,
  finishedGames: number,
): number {
  const priorStartRate =
    prior && prior.seasons > 0
      ? clamp01(prior.starts / (prior.seasons * SEASON_GAMES))
      : null;
  const currentStartRate =
    finishedGames > 0
      ? clamp01(player.seasonStarts / finishedGames)
      : (priorStartRate ?? 0.5);
  if (priorStartRate === null) return currentStartRate;
  const w = finishedGames / (finishedGames + START_SHRINK_GAMES);
  return w * currentStartRate + (1 - w) * priorStartRate;
}

/** Blend per-90 rates toward the last two seasons while the current-season minute sample is thin. */
export function blendRates(
  player: PlayerRow,
  prior: PriorAggregate | undefined,
): RateInputs {
  const cur: RateInputs = {
    xg90: player.xg90,
    xa90: player.xa90,
    defcon90: player.defcon90,
    saves90: player.saves90,
  };
  if (!prior || prior.minutes === 0) return cur;
  const per90 = (total: number) => (total / prior.minutes) * 90;
  const priorRates: RateInputs = {
    xg90: per90(prior.xg),
    xa90: per90(prior.xa),
    defcon90: per90(prior.defcon),
    saves90: per90(prior.saves),
  };
  const w = player.seasonMinutes / (player.seasonMinutes + RATE_SHRINK_MINUTES);
  return {
    xg90: mix(cur.xg90, priorRates.xg90, w),
    xa90: mix(cur.xa90, priorRates.xa90, w),
    defcon90: mix(cur.defcon90, priorRates.defcon90, w),
    saves90: mix(cur.saves90, priorRates.saves90, w),
  };
}

/** Rough expected bonus from attacking involvement — a v1 placeholder for a BPS/90 model. */
function estimateBonus(rates: RateInputs): number {
  return Math.min(1.5, (rates.xg90 + rates.xa90) * 0.6);
}

function mix(a: number, b: number, w: number): number {
  return w * a + (1 - w) * b;
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
function roundComponents(c: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) out[k] = round2(v);
  return out;
}
