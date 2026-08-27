import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { errorStats, type ErrorStats, type Observation } from './metrics';

/**
 * B-016 — scoring the projections we **actually served**.
 *
 * Everything else in this module measures the model against a third-party archive of seasons that
 * are over. That is the right way to fit and the wrong way to be trusted: an archive backtest cannot
 * see the availability multiplier (the archive has no per-gameweek `status`), cannot compare against
 * FPL's own `ep_next` (the archive's `xP` is scraped after the match — D-016), and cannot notice that
 * the number we published on Friday was not the number the model would produce today.
 *
 * This scores the row that was written before the deadline, against what happened, against the two
 * baselines only live data can supply.
 *
 * **Gated on `dataChecked`, never on `finished`.** `finished` flips as soon as the last whistle goes
 * and before bonus points and stat corrections land, so a scorer that trusted it would grade the
 * model against numbers FPL is still editing — and would do it silently, because the rows exist and
 * look complete.
 *
 * **A scorer with nothing to score returns cleanly and looks healthy.** That is the state this
 * project is in right now: `projections` starts at GW2 and no gameweek has completed under a served
 * projection. So the report NAMES the gameweeks it skipped and why, rather than reporting an empty
 * success.
 */

export interface ServedComparison {
  label: string;
  stats: ErrorStats;
  /** rows this predictor could score, of the rows in the common population */
  n: number;
}

export interface GameweekScore {
  gameweekId: number;
  /** one entry per modelVersion found in `projections` for this gameweek, plus the baselines */
  comparisons: ServedComparison[];
  /** players scored — the intersection every predictor could reach */
  players: number;
  /** whether a deadline snapshot existed, which is what makes ep_next and form available at all */
  hadSnapshot: boolean;
  /** the biggest misses, both ways, for the post-mortem to talk about */
  worstOver: { webName: string; predicted: number; actual: number }[];
  worstUnder: { webName: string; predicted: number; actual: number }[];
}

export interface SkippedGameweek {
  gameweekId: number;
  reason: string;
}

export interface ServedScoringReport {
  path: string;
  scored: GameweekScore[];
  skipped: SkippedGameweek[];
}

/** How many of the largest misses each way the post-mortem lists. */
const WORST_N = 5;

@Injectable()
export class ServedScoringService {
  private readonly log = new Logger(ServedScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  async score(only?: number): Promise<ServedScoringReport> {
    const gameweeks = await this.prisma.gameweek.findMany({
      where: only === undefined ? {} : { id: only },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        finished: true,
        dataChecked: true,
        deadlineTime: true,
      },
    });

    const scored: GameweekScore[] = [];
    const skipped: SkippedGameweek[] = [];

    for (const gw of gameweeks) {
      const projectionCount = await this.prisma.projection.count({
        where: { gameweekId: gw.id },
      });
      if (projectionCount === 0) {
        // Silent unless asked for: 30 of 38 gameweeks have no projection at any time, and listing
        // them all would bury the two that matter.
        if (only !== undefined) {
          skipped.push({
            gameweekId: gw.id,
            reason: 'no projection was ever served for this gameweek',
          });
        }
        continue;
      }
      if (!gw.dataChecked) {
        skipped.push({
          gameweekId: gw.id,
          reason: gw.finished
            ? 'finished but NOT dataChecked — bonus and stat corrections have not landed, and scoring now would grade the model against numbers FPL is still editing'
            : 'has not been played yet',
        });
        continue;
      }
      scored.push(await this.scoreOne(gw.id));
    }

    const path = await this.write(scored, skipped);
    return { path, scored, skipped };
  }

  private async scoreOne(gameweekId: number): Promise<GameweekScore> {
    const [projections, realised, snapshot] = await Promise.all([
      this.prisma.projection.findMany({
        where: { gameweekId },
        select: {
          playerId: true,
          modelVersion: true,
          expectedPoints: true,
          player: { select: { webName: true } },
        },
      }),
      this.prisma.playerGameweekStat.groupBy({
        by: ['playerId'],
        where: { gameweekId },
        // A double gameweek is two rows and both score, so the realised total is the SUM. Taking the
        // max here would silently under-report exactly the weeks that decide a season.
        _sum: { totalPoints: true },
      }),
      this.prisma.playerDeadlineSnapshot.findMany({
        where: { gameweekId },
        select: { playerId: true, epNext: true, form: true },
      }),
    ]);

    const actualOf = new Map(
      realised.map((r) => [r.playerId, r._sum.totalPoints ?? 0]),
    );
    const nameOf = new Map(
      projections.map((p) => [p.playerId, p.player.webName]),
    );

    const versions = [
      ...new Set(projections.map((p) => p.modelVersion)),
    ].sort();
    const byVersion = new Map<string, Map<string, number>>();
    for (const p of projections) {
      const m = byVersion.get(p.modelVersion) ?? new Map<string, number>();
      m.set(p.playerId, Number(p.expectedPoints));
      byVersion.set(p.modelVersion, m);
    }

    const epNextOf = new Map<string, number>();
    const formOf = new Map<string, number>();
    for (const s of snapshot) {
      if (s.epNext !== null) epNextOf.set(s.playerId, Number(s.epNext));
      if (s.form !== null) formOf.set(s.playerId, Number(s.form));
    }

    /**
     * The common population: every player the realised data covers AND every predictor can score.
     *
     * B-012's invariant 3, applied to live data. A model scored on 600 players and a baseline scored
     * on the 400 it happened to have a number for is not a comparison — and the rows that fall out
     * are never the average ones.
     */
    const predictors: { label: string; values: Map<string, number> }[] = [
      ...versions.map((v) => ({ label: v, values: byVersion.get(v)! })),
      { label: 'ep_next (FPL)', values: epNextOf },
      { label: 'form (FPL)', values: formOf },
    ].filter((p) => p.values.size > 0);

    const common = [...actualOf.keys()].filter((id) =>
      predictors.every((p) => p.values.has(id)),
    );

    const comparisons = predictors.map((p) => {
      const rows: Observation[] = common.map((id) => ({
        predicted: p.values.get(id)!,
        actual: actualOf.get(id)!,
        position: '',
        value: 0,
        season: 'live',
        round: gameweekId,
        playerCode: 0,
        webName: nameOf.get(id) ?? id,
        teamCode: null,
      }));
      return { label: p.label, stats: errorStats(rows), n: rows.length };
    });

    // The misses are described against the NEWEST model version, which is the one that serves.
    const serving = versions[versions.length - 1];
    const servingValues = byVersion.get(serving) ?? new Map<string, number>();
    const misses = common
      .map((id) => ({
        webName: nameOf.get(id) ?? id,
        predicted: servingValues.get(id) ?? 0,
        actual: actualOf.get(id) ?? 0,
      }))
      .filter((m) => Number.isFinite(m.predicted));

    return {
      gameweekId,
      comparisons,
      players: common.length,
      hadSnapshot: snapshot.length > 0,
      worstOver: [...misses]
        .sort((a, b) => b.predicted - b.actual - (a.predicted - a.actual))
        .slice(0, WORST_N),
      worstUnder: [...misses]
        .sort((a, b) => a.predicted - a.actual - (b.predicted - b.actual))
        .slice(0, WORST_N),
    };
  }

  private async write(
    scored: GameweekScore[],
    skipped: SkippedGameweek[],
  ): Promise<string> {
    const l: string[] = [];
    const f = (x: number, d = 3) => x.toFixed(d);

    l.push('# Served projections, scored against what happened');
    l.push('');
    l.push(
      'Generated by `pnpm score:gameweek`. **This is the only report in this repository about the ' +
        'live season.** Every other one measures the model against a third-party archive of seasons ' +
        'that are over — which is the right way to fit it and the wrong way to trust it.',
    );
    l.push('');
    l.push(
      'Gated on `dataChecked`, never on `finished`: `finished` flips at the last whistle and before ' +
        'bonus points and stat corrections land, so scoring on it would grade the model against ' +
        'numbers FPL is still editing.',
    );
    l.push('');

    if (scored.length === 0) {
      l.push('## Nothing has been scored yet, and that is the honest state');
      l.push('');
      l.push(
        'No gameweek has both a served projection and checked data. A scorer with nothing to score ' +
          'returns cleanly and looks healthy, so the gameweeks it passed over are named below ' +
          'rather than counted.',
      );
      l.push('');
    }

    for (const gw of scored) {
      l.push(`## Gameweek ${gw.gameweekId}`);
      l.push('');
      l.push(
        `${gw.players.toLocaleString()} players, scored on the rows every predictor could reach. ` +
          (gw.hadSnapshot
            ? 'A deadline snapshot exists, so `ep_next` and `form` are the numbers FPL published **before** the deadline.'
            : '**No deadline snapshot** — `ep_next` and `form` are unavailable for this gameweek and are gone permanently, because both are scalars that every sync overwrites.'),
      );
      l.push('');
      l.push(
        '| predictor | n | MAE | RMSE | bias | mean predicted | mean actual |',
      );
      l.push('|---|---:|---:|---:|---:|---:|---:|');
      for (const c of gw.comparisons) {
        l.push(
          `| ${c.label} | ${c.n.toLocaleString()} | ${f(c.stats.mae)} | ${f(c.stats.rmse)} | ` +
            `${f(c.stats.bias)} | ${f(c.stats.meanPredicted)} | ${f(c.stats.meanActual)} |`,
        );
      }
      l.push('');
      l.push('### The five we most over-paid');
      l.push('');
      l.push('| player | predicted | actual |');
      l.push('|---|---:|---:|');
      for (const m of gw.worstOver) {
        l.push(`| ${m.webName} | ${f(m.predicted, 2)} | ${m.actual} |`);
      }
      l.push('');
      l.push('### The five we most under-paid');
      l.push('');
      l.push('| player | predicted | actual |');
      l.push('|---|---:|---:|');
      for (const m of gw.worstUnder) {
        l.push(`| ${m.webName} | ${f(m.predicted, 2)} | ${m.actual} |`);
      }
      l.push('');
      l.push(
        '**Variance or model?** One gameweek cannot answer that, and this report does not pretend ' +
          'to. A player projected at 6 who blanked is the ordinary shape of football; the same ' +
          'player blanking for six weeks is a model finding. **Guardrail 10: do not re-fit on one ' +
          'gameweek.** What this table is for is accumulating — the misses that repeat are the ones ' +
          'worth chasing, and they are only visible once several of these exist.',
      );
      l.push('');
      l.push(
        '**And grade the decision, not the scoreboard** (guide §6). A −4 hit worth +7 expected ' +
          'points that returned −2 was a good decision badly rewarded. The columns above measure ' +
          'the prediction; whether the recommendation was right is a separate question and is not ' +
          'answered by a bad week.',
      );
      l.push('');
    }

    if (skipped.length > 0) {
      l.push('## Not scored, and why');
      l.push('');
      l.push('| gameweek | reason |');
      l.push('|---:|---|');
      for (const s of skipped) l.push(`| ${s.gameweekId} | ${s.reason} |`);
      l.push('');
    }

    const dir = 'reports';
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'served-projections.md');
    await writeFile(path, l.join('\n'), 'utf8');
    this.log.log(
      `scored ${scored.length} gameweek(s), skipped ${skipped.length} — ${path}`,
    );
    return path;
  }
}
