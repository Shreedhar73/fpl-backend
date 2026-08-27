/**
 * `pnpm sweep:collision` — the one part of plan 009 that can be measured rather than argued.
 *
 * Solves the same from-scratch squad over every archived gameweek at several values of
 * `COLLISION_LAMBDA` and scores what the chosen XI and captain actually went on to score. The
 * appearance floor is held ON at every lambda, so one thing varies.
 *
 * **Mean alone cannot answer this.** The penalty spends expected points to buy variance reduction,
 * so lambda = 0 wins the mean by construction and a mean-only test could return nothing but its own
 * escape clause. The realised distribution is reported beside it — worst decile and worst quartile
 * per lambda — because that is what separates "the rule is worthless" from "the insurance is priced
 * right".
 *
 * **What this is not.** Each gameweek is solved from scratch at that week's prices: no transfers, no
 * free-transfer bank, no hits, no sell-on fee, and no auto-subs — a benched player who would have
 * come on for a starter who did not play scores nothing here. That is B-012's season simulator, not
 * this. Holding the omissions constant across lambda is what makes the comparison fair; it is not
 * what makes it a season.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import highsLoader from 'highs';
import { AppModule } from '../app.module';
import {
  OptimizerService,
  prunePool,
} from '../modules/optimizer/optimizer.service';
import {
  buildLp,
  buildConflictPairs,
  pickBestXi,
  Candidate,
  Collisions,
} from '../modules/optimizer/ilp';
import { MIN_APPEARANCES } from '../modules/optimizer/policy';
import type { FixtureLite } from '../modules/optimizer/optimizer.repository';
import { ForecastRepository } from '../modules/projections/forecast.repository';
import { walkRounds, HistoryRow } from '../modules/projections/features';
import { FITTED_PARAMS } from '../modules/projections/fitted';
import {
  minutesDistribution,
  projectFixtureV2,
} from '../modules/projections/model-v2';
import { Scoring } from '../modules/projections/scoring';
import { scoringForSeason } from '../modules/archive/archive-scoring';

const LAMBDAS = [0, 0.5, 1, 2, 4];

interface RoundScore {
  season: string;
  round: number;
  points: Record<string, number>; // lambda -> realised points of the XI + captain
  pairsHeld: Record<string, number>;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(q * sorted.length)),
  );
  return sorted[i];
}

/**
 * The rounds are PAIRED — every lambda solves the same gameweek off the same projections — so the
 * comparison that matters is the mean of the per-round differences, not the difference of the means.
 * A per-round standard error alongside it is what turns "lambda 1 is better" into a claim that can
 * be false: a gap smaller than a couple of standard errors is the sweep saying it cannot tell.
 */
function paired(values: number[], baseline: number[]): string {
  const diffs = values.map((v, i) => v - baseline[i]);
  const n = diffs.length;
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance =
    n > 1 ? diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1) : 0;
  const se = Math.sqrt(variance / n);
  const better = diffs.filter((d) => d > 0).length;
  const worse = diffs.filter((d) => d < 0).length;
  return (
    `vs lambda 0: ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} +/- ${se.toFixed(2)} per round  ` +
    `(better ${better}, worse ${worse}, tied ${n - better - worse})`
  );
}

function summarise(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return (
    `mean ${mean.toFixed(2)}  ` +
    `worst-decile ${quantile(sorted, 0.1).toFixed(1)}  ` +
    `worst-quartile ${quantile(sorted, 0.25).toFixed(1)}  ` +
    `median ${quantile(sorted, 0.5).toFixed(1)}  ` +
    `min ${sorted[0]?.toFixed(1)}`
  );
}

async function main(): Promise<void> {
  const log = new Logger('sweep');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const rules = await app.get(OptimizerService).loadRules();
    const rows = await app.get(ForecastRepository).archiveHistory();
    const highs = await highsLoader();

    const scoringCache = new Map<string, Scoring>();
    const scoringFor = (season: string): Scoring => {
      const hit = scoringCache.get(season);
      if (hit) return hit;
      const table = scoringForSeason(season);
      if (!table)
        throw new Error(
          `no reconstructed scoring table for ${season} — scoring it with another season's rules ` +
            'would price categories it did not have',
        );
      const s = Scoring.from(table.scoring);
      scoringCache.set(season, s);
      return s;
    };

    /** playerCode -> appearances (rows with minutes > 0) STRICTLY BEFORE the round being solved */
    const appearances = new Map<number, number>();
    const results: RoundScore[] = [];
    const skipped: { reason: string; n: number } = {
      reason: 'infeasible',
      n: 0,
    };

    for (const context of walkRounds(rows, FITTED_PARAMS)) {
      // A player may have two fixtures in one round (a double gameweek). The candidate is the
      // player, so both fixtures are summed — projected and realised alike.
      const byPlayer = new Map<
        number,
        { cand: Candidate; realised: number; ok: boolean }
      >();
      const fixtures = new Map<string, FixtureLite>();

      for (const { row, features, goalRates } of context.items) {
        if (row.teamCode === null || row.opponentTeamCode === null) continue;
        if (row.wasHome) {
          fixtures.set(`${row.teamCode}-${row.opponentTeamCode}`, {
            homeTeamId: String(row.teamCode),
            awayTeamId: String(row.opponentTeamCode),
            homeTeamShortName: `T${row.teamCode}`,
            awayTeamShortName: `T${row.opponentTeamCode}`,
          });
        }
        const minutes = minutesDistribution(
          {
            startRate: features.laggedStartRate,
            subRate: features.laggedSubRate,
          },
          1,
          FITTED_PARAMS,
        );
        const projection = projectFixtureV2(
          row.position,
          minutes,
          features.rates,
          goalRates,
          scoringFor(row.season),
          FITTED_PARAMS,
        );
        const existing = byPlayer.get(row.playerCode);
        if (existing) {
          existing.cand.ep += projection.ep;
          existing.realised += row.totalPoints;
          continue;
        }
        byPlayer.set(row.playerCode, {
          cand: {
            key: `p_${row.playerCode}`,
            playerId: String(row.playerCode),
            webName: row.webName,
            position: row.position,
            teamId: String(row.teamCode),
            // The archive has team codes and no short names. A sweep renders no payload.
            teamShortName: `T${row.teamCode}`,
            cost: row.value,
            ep: projection.ep,
            pPlay: minutes.pPlay,
            appearances: appearances.get(row.playerCode) ?? 0,
          },
          realised: row.totalPoints,
          // a player the model has never seen is a guess about a stranger; the floor removes them
          // anyway, and this keeps the reason explicit
          ok: features.matchesSample > 0,
        });
      }

      // fold this round into the appearance counter AFTER the candidates were built from it, which
      // is the same time cut the features use — the round being solved is never part of its own inputs
      for (const { row } of context.items) {
        if (row.minutes > 0)
          appearances.set(
            row.playerCode,
            (appearances.get(row.playerCode) ?? 0) + 1,
          );
      }

      const candidates = [...byPlayer.values()]
        .filter((v) => v.ok)
        .map((v) => v.cand);
      const realisedOf = new Map(
        [...byPlayer.values()].map((v) => [v.cand.key, v.realised]),
      );
      const pool = prunePool(candidates);
      const pairs = buildConflictPairs(pool, [...fixtures.values()]);

      const points: Record<string, number> = {};
      const pairsHeld: Record<string, number> = {};
      let feasible = true;
      for (const lambda of LAMBDAS) {
        const collisions: Collisions = { pairs, lambda };
        const sol = highs.solve(buildLp(pool, rules, collisions));
        if (sol.Status !== 'Optimal') {
          feasible = false;
          break;
        }
        const squad = pool.filter(
          (c) =>
            ((sol.Columns[c.key] as { Primal?: number })?.Primal ?? 0) > 0.5,
        );
        const xi = pickBestXi(squad, rules, collisions);
        let realised = 0;
        for (const key of xi.starters) realised += realisedOf.get(key) ?? 0;
        if (xi.captainKey) realised += realisedOf.get(xi.captainKey) ?? 0;
        points[String(lambda)] = realised;
        pairsHeld[String(lambda)] = xi.collisions.length;
      }
      if (!feasible) {
        skipped.n++;
        continue;
      }
      const first = context.items[0].row;
      results.push({
        season: first.season,
        round: first.round,
        points,
        pairsHeld,
      });
      log.log(
        `${first.season} GW${first.round}: ` +
          LAMBDAS.map((l) => `λ${l}=${points[String(l)]}`).join(' '),
      );
    }

    const report: string[] = [];
    report.push(
      `rounds scored: ${results.length}, skipped as infeasible (too little history to field a legal 15 under the floor): ${skipped.n}`,
    );
    const seasons = [...new Set(results.map((r) => r.season))].sort();
    for (const scope of [null, ...seasons]) {
      const subset =
        scope === null ? results : results.filter((r) => r.season === scope);
      report.push(`\n### ${scope ?? 'all seasons'} (${subset.length} rounds)`);
      const baseline = subset.map((r) => r.points['0']);
      for (const lambda of LAMBDAS) {
        const values = subset.map((r) => r.points[String(lambda)]);
        const held = subset.reduce(
          (s, r) => s + r.pairsHeld[String(lambda)],
          0,
        );
        report.push(
          `  lambda ${String(lambda).padEnd(4)} ${summarise(values)}  pairs kept in XI ${held}`,
        );
        if (lambda !== 0)
          report.push(`               ${paired(values, baseline)}`);
      }
    }
    console.log('\n' + report.join('\n') + '\n');
    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).stack ?? (err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
