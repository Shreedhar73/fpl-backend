import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportFeatures } from '../calibration/feature-export';
// The v3 incumbent, NOT the served params (D-037). The composite's residual leg was trained
// against `v3ep` computed under v3, and its minutes come from "the incumbent's minutes machinery"
// as of the fit; handing it v5 — rates decay and per-player starter minutes on, a different
// corpus — would write a different model under `v4-composite-2026-08-27`, with nothing going red.
// The fit-v4 manifest asserts the feature LIST, not the params the features were built under.
import { V3_INCUMBENT_PARAMS as FITTED_PARAMS } from './fitted';
import { ForecastRepository } from './forecast.repository';
import { availabilityMultiplier } from './forecast.service';
import { minutesDistribution } from './model-v2';
import { ProjectionRow, ProjectionsRepository } from './projections.repository';
import { Scoring } from './scoring';
import { loadV4Scorers } from './v4/load';
import { V4Model } from './v4/model-v4';

/**
 * B-037 — the candidate's projections, written weekly beside the incumbent's so the live season
 * scores both.
 *
 * The archive holdout is retired: four architecture readings were the edge of what it survives, and
 * the pre-registered composite reading came one leg short (Tickers). The only referee left is the
 * season nobody has read — 2026-27, accumulating on its own. For it to referee, the candidate has to
 * publish a number BEFORE each deadline, into the same table, under its own version, and be scored
 * by the same `pnpm score:gameweek` that scores the incumbent (B-016 enumerates every modelVersion a
 * gameweek has rows for).
 *
 * **Writing candidate rows is safe because serving is pinned, not because nobody writes.** The
 * optimizer resolves the served version to the incumbent's constant, never to the newest row — that
 * pin landed with this service, and its test is the sabotage that used to be a hijack.
 *
 * ## What the candidate row carries, honestly
 *
 * - `expectedPoints` — the composite (per-position VALIDATE-chosen blend of the direct and residual
 *   fits), times the SAME hand-drawn availability multiplier the incumbent uses. The archive cannot
 *   teach availability (B-015); at serve time both models share the one heuristic layer, stated.
 * - `expectedMinutes`, `playProbability` — the incumbent's minutes machinery. v4 has no minutes
 *   model; publishing zeros would poison auto-sub and captain logic downstream if anyone ever
 *   consumed these rows, and inventing a second minutes model here would be architecture by side
 *   effect.
 * - `sd`, `pBlank`, `pHaul` — null. The candidate has no distribution (recorded in B-035).
 * - `components` — the feature provenance: model date, weights, availability multiplier applied.
 */
@Injectable()
export class CandidateService {
  private readonly log = new Logger(CandidateService.name);

  constructor(
    private readonly forecastRepo: ForecastRepository,
    private readonly projections: ProjectionsRepository,
  ) {}

  static version(): string {
    const raw = readFileSync(
      join(__dirname, 'v4', 'model-GKP.json'),
      'utf8',
    );
    const model = JSON.parse(raw) as V4Model;
    return `v4-composite-${model.provenance.date.slice(0, 10)}`;
  }

  async run(gameweekIds: number[]): Promise<{
    modelVersion: string;
    rowsWritten: number;
    gameweekIds: number[];
  }> {
    const scorers = loadV4Scorers();
    const version = CandidateService.version();
    const scoring = Scoring.from(await this.forecastRepo.liveScoring());
    const scoringFor = () => scoring;

    const [archive, current, playerId] = await Promise.all([
      this.forecastRepo.archiveHistory(),
      this.forecastRepo.currentSeasonHistory(),
      this.forecastRepo.playerIdByCode(),
    ]);

    const rows: ProjectionRow[] = [];
    for (const gw of gameweekIds) {
      const [synthetic, availability] = await Promise.all([
        this.forecastRepo.syntheticRowsFor(gw),
        this.forecastRepo.availabilityByCode(gw),
      ]);
      if (synthetic.length === 0) continue;
      const syntheticSet = new Set(synthetic);

      // The same walk the incumbent forecasts through, the same exporter the fit trained from —
      // one feature implementation from archive to deadline (B-034's whole point).
      const exported = exportFeatures(
        [...archive, ...current, ...synthetic],
        FITTED_PARAMS,
        scoringFor,
        (row) => syntheticSet.has(row as (typeof synthetic)[number]),
      );

      // Sum per player across the gameweek's fixtures — a DGW is two rows that add.
      const byCode = new Map<
        number,
        { ep: number; pPlay: number; expectedMinutes: number; mult: number }
      >();
      for (const r of exported) {
        const scorer = scorers.get(r.position);
        if (!scorer) continue;
        const avail = availability.get(r.playerCode);
        const mult = availabilityMultiplier(
          avail?.status ?? 'a',
          avail?.chance ?? null,
        );
        const minutes = minutesDistribution(
          {
            startRate: (r.features.get('laggedStartRate') as number) ?? 0,
            subRate: (r.features.get('laggedSubRate') as number) ?? 0,
          },
          mult,
          FITTED_PARAMS,
          r.position,
        );
        const raw = scorer.predict(r.features);
        const ep = Math.max(0, raw) * mult;
        const at = byCode.get(r.playerCode) ?? {
          ep: 0,
          pPlay: minutes.pPlay,
          expectedMinutes: 0,
          mult,
        };
        at.ep += ep;
        at.expectedMinutes += minutes.expectedMinutes;
        byCode.set(r.playerCode, at);
      }

      for (const [code, v] of byCode) {
        const pid = playerId.get(code);
        if (!pid) continue;
        rows.push({
          playerId: pid,
          gameweekId: gw,
          modelVersion: version,
          expectedPoints: round(v.ep, 2),
          expectedMinutes: round(v.expectedMinutes, 2),
          playProbability: round(v.pPlay, 3),
          components: {
            // Record<string, number> by contract; the version string lives in modelVersion.
            availabilityMultiplier: round(v.mult, 3),
          },
          sd: null,
          pBlank: null,
          pHaul: null,
        });
      }
    }

    const rowsWritten = await this.projections.writeProjections(rows);
    this.log.log(
      `${version}: ${rowsWritten} candidate rows over GW${gameweekIds.join(', GW')} — ` +
        `scored weekly beside the incumbent by \`pnpm score:gameweek\`; never served (the ` +
        `optimizer's version is pinned)`,
    );
    return { modelVersion: version, rowsWritten, gameweekIds };
  }
}

const round = (x: number, dp: number) => Number(x.toFixed(dp));
