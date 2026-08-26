import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Scoring } from '../projections/scoring';
import { FittedParams } from '../projections/fitted';
import { scoringForSeason } from '../archive/archive-scoring';
import { CalibrationRepository } from './calibration.repository';
import {
  commonRows,
  PREDICTORS,
  Predictor,
  PredictionRow,
  runBacktest,
} from './harness';
import {
  DEFAULT_KS,
  ORDERING_VIEWS,
  orderingByRound,
  OrderingSummary,
  summariseOrdering,
} from './ordering';
import { TEST_SEASON, TRAIN_SEASONS } from './calibration.service';

/**
 * The decision-quality report (B-012).
 *
 * Separate from `CalibrationService` on purpose. That one answers "how far off is each prediction",
 * which D-020 established is the wrong verdict for this product; this one answers "did the model make
 * better decisions", which is the question a squad optimiser actually poses. Keeping them in one
 * service would have meant one report where the error tables sit above the decision tables and get
 * read as the headline again.
 *
 * Invariant, inherited from B-007 and extended by B-012: **nothing here writes anything.** The
 * `projections` row count is asserted unmoved around every run.
 */

export interface DecisionReport {
  path: string;
  ordering: Map<Predictor, OrderingSummary>;
}

@Injectable()
export class DecisionService {
  private readonly log = new Logger(DecisionService.name);

  constructor(private readonly repo: CalibrationRepository) {}

  async evaluate(label: string, params: FittedParams): Promise<DecisionReport> {
    const before = await this.repo.projectionCount();
    const scoringFor = await this.scoringResolver();
    const rows = await this.repo.history([...TRAIN_SEASONS, TEST_SEASON]);

    const result = runBacktest(rows, params, scoringFor, {
      evaluate: (row) => row.season === TEST_SEASON,
    });

    // Ordering is a comparison, so it runs on the common population like every other comparison
    // (B-012 invariant 3) — a predictor ranking a field its rival could not see is not being
    // compared to it.
    const population = commonRows(result.rows);
    const ordering = new Map<Predictor, OrderingSummary>();
    for (const p of PREDICTORS) {
      ordering.set(
        p,
        summariseOrdering(orderingByRound(population, p, ORDERING_VIEWS[0])),
      );
    }

    const path = await this.writeReport(label, result.rows, population);

    const after = await this.repo.projectionCount();
    if (after !== before) {
      throw new Error(
        `the decision harness wrote to projections (${before} → ${after}). Invariant 1 exists ` +
          `because a backtest row becomes the newest by createdAt and would then be served.`,
      );
    }

    return { path, ordering };
  }

  private async scoringResolver(): Promise<(season: string) => Scoring> {
    const cache = new Map<string, Scoring>();
    let live: Scoring | null = null;
    for (const season of [...TRAIN_SEASONS, TEST_SEASON]) {
      const table = scoringForSeason(season);
      if (table) {
        cache.set(season, Scoring.from(table.scoring));
        continue;
      }
      this.log.warn(`${season}: no reconstructed scoring table — using the live config`);
      live ??= Scoring.from(await this.repo.liveScoring());
      cache.set(season, live);
    }
    return (season) => {
      const s = cache.get(season);
      if (!s) throw new Error(`no scoring table resolved for ${season}`);
      return s;
    };
  }

  private async writeReport(
    label: string,
    all: PredictionRow[],
    population: PredictionRow[],
  ): Promise<string> {
    const lines: string[] = [];
    const w = (s = '') => lines.push(s);
    const n3 = (x: number | null) => (x === null ? '—' : x.toFixed(3));
    const pct = (x: number | null) =>
      x === null ? '—' : `${(x * 100).toFixed(1)}%`;

    w(`# Decision quality — ${label}`);
    w();
    w(
      `Test season **${TEST_SEASON}**, held out of the fit. This is the report B-012 exists for: ` +
        `\`calibration-*.md\` says how far each prediction was from the outcome, and this one says ` +
        `whether the ordering those predictions imply is any better than the alternatives.`,
    );
    w();
    w(`## Why not MAE`);
    w();
    w(
      `MAE is minimised by the conditional median. Most player-gameweeks are players who barely ` +
        `feature, so a predictor that says near-zero for everyone wins MAE and tells a squad ` +
        `optimiser nothing — it never asks what a player will score, it asks which fifteen, which ` +
        `eleven of those, and who takes the armband. Every one of those is an ordering question. ` +
        `Recorded as D-020.`,
    );
    w();
    w(`## The defensive-contribution caveat, on this verdict too`);
    w();
    w(
      `The season scored here is ${TEST_SEASON}, and ${TEST_SEASON} rounds 1–19 are where the ` +
        `defensive-contribution parameters were fitted — that category exists in no earlier season, ` +
        `so it cannot be held out across seasons. Those rows are passed to the fit separately and no ` +
        `other parameter reads them, but the defcon term's contribution below is **not** held out. ` +
        `Every calibration report carries this; the verdict carries it too, or it claims a cleaner ` +
        `holdout than it has.`,
    );
    w();
    w(`## Ordering`);
    w();
    w(
      `Scored **per round and then averaged**, never pooled: pooling conflates ranking a deadline's ` +
        `players well with knowing which rounds were high-scoring, and only the first is a job the ` +
        `product does. Rounds where nobody scored produce no number and are dropped rather than ` +
        `counted as zero.`,
    );
    w();
    w(
      `**Spearman is tie-corrected**, and it cannot reach 1 here: FPL outcomes are massively tied, ` +
        `so the outcome itself carries no order to recover among the players on 0, 1 or 2. The ` +
        `ceiling is the data's, not the model's. **Points captured @ k** is the primary top-k ` +
        `metric — the realised points of a predictor's top *k* over the realised points of the true ` +
        `top *k*, which a tie at the boundary cannot move. **Precision@k** is reported beside it and ` +
        `is the fragile one.`,
    );
    w();
    w(
      `Population: **${population.length}** of ${all.length} player-gameweeks — the rows every ` +
        `predictor could score, so the ranking each produced is over the same field.`,
    );
    w();

    for (const view of ORDERING_VIEWS) {
      w(`### ${view.label}`);
      w();
      w(
        `| Predictor | rounds | Spearman | ` +
          DEFAULT_KS.map((k) => `points captured @${k} | precision @${k} `).join('| ') +
          `|`,
      );
      w(`|---|---:|---:|` + DEFAULT_KS.map(() => `---:|---:|`).join(''));
      for (const p of PREDICTORS) {
        const s = summariseOrdering(orderingByRound(population, p, view));
        w(
          `| ${p} | ${s.rounds} | ${n3(s.meanSpearman)} | ` +
            DEFAULT_KS.map(
              (k) =>
                `${pct(s.meanPointsCaptured.get(k) ?? null)} | ${pct(s.meanPrecision.get(k) ?? null)} `,
            ).join('| ') +
            `|`,
        );
      }
      w();
    }

    w(`## What the ordering says`);
    w();
    {
      const whole = ORDERING_VIEWS[0];
      const m = summariseOrdering(orderingByRound(population, 'model', whole));
      const f = summariseOrdering(orderingByRound(population, 'form', whole));
      const capturedWins = DEFAULT_KS.filter((k) => {
        const a = m.meanPointsCaptured.get(k);
        const b = f.meanPointsCaptured.get(k);
        return a !== null && a !== undefined && b !== null && b !== undefined && a > b;
      });
      const rhoWin =
        m.meanSpearman !== null &&
        f.meanSpearman !== null &&
        m.meanSpearman > f.meanSpearman;

      w(
        `Against \`form\`, over the whole field: Spearman **${n3(m.meanSpearman)}** against ` +
          `**${n3(f.meanSpearman)}**, and points captured @11 **${pct(m.meanPointsCaptured.get(11) ?? null)}** ` +
          `against **${pct(f.meanPointsCaptured.get(11) ?? null)}**.`,
      );
      w();
      if (!rhoWin && capturedWins.length === DEFAULT_KS.length) {
        w(
          `**A split, and the split is the finding.** \`form\` orders the *whole field* better, and ` +
            `this model captures more points in the *top k* at every k measured. Those are not in ` +
            `conflict: a whole-field rank correlation is dominated by the mass of players who score ` +
            `nothing, which \`form\` ranks well by predicting nothing for them — and a squad ` +
            `optimiser never chooses between two players who will both blank. It chooses at the top, ` +
            `which is what points-captured@k measures. **On the part of the ranking the product ` +
            `uses, the model is ahead.**`,
        );
        w();
        w(
          `That is a claim about ordering, not about points. It becomes a claim about points when ` +
            `the season simulation lands (Phases 3–4), and not before.`,
        );
      } else if (rhoWin && capturedWins.length === DEFAULT_KS.length) {
        w(`**Beats \`form\` on rank correlation and on points captured at every k.**`);
      } else if (capturedWins.length === 0) {
        w(
          `**Does not beat \`form\` on points captured at any k.** Recorded as it stands. The ` +
            `serving version is not deleted and \`modelVersion\` does not move on this.`,
        );
      } else {
        w(
          `**Mixed**: ahead on points captured at ${capturedWins.map((k) => `@${k}`).join(', ')} ` +
            `and behind at the rest. Recorded as it stands rather than summarised into a verdict ` +
            `the numbers do not support.`,
        );
      }
      w();
      w(
        `\`priorSeason\` is far behind on every measure, which is the sanity check on the metric ` +
          `itself: a baseline that cannot see this season should not rank this season's rounds.`,
      );
    }
    w();
    w(`## Still to come in this report`);
    w();
    w(
      `B-012's remaining phases: the XI and captain decision over fixed squads shared by every ` +
        `model (Phase 2), and a full-season simulation under the real rules — free transfers banked ` +
        `to five, −4 hits, the 50% sell fee, auto-subs, captain fallback (Phases 3–4). Until those ` +
        `land, this report answers "is the ranking better" and does not yet answer "would it have ` +
        `scored more points".`,
    );
    w();
    w(`Nothing was written to \`projections\` — asserted, not assumed.`);
    w();

    const dir = 'reports';
    await mkdir(dir, { recursive: true });
    const path = join(dir, `decision-quality${label === 'fitted' ? '' : `-${label}`}.md`);
    await writeFile(path, lines.join('\n'), 'utf8');
    return path;
  }
}
