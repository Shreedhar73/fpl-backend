import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FittedParams } from '../projections/fitted';
import { CalibrationRepository } from './calibration.repository';
import { PredictionRow, runBacktest } from './harness';
import {
  CalibrationService,
  TEST_SEASON,
  TRAIN_SEASONS,
} from './calibration.service';
import {
  BinaryPair,
  BrierScore,
  brierScore,
  CountPair,
  DecileRow,
  decileTable,
  ReliabilityBin,
  reliabilityCurve,
} from './reliability';

/**
 * B-013 — the model measured **term by term** instead of only in total.
 *
 * `calibration.service.ts` scores the sum. Its held-out curve is over-confident at both tails and
 * under-confident in the middle while the overall bias is −0.025, which is the signature of a wrongly
 * *shaped* component rather than a wrong overall level — and an aggregate report structurally cannot
 * say which component. This one can, because `projectFixtureV2` now keeps the probabilities it
 * computes and `runBacktest` carries the realised counterpart of each on the same row.
 *
 * **The check that could not fail, and how it is closed.** A reliability curve is happy to be
 * computed against a counterpart that is definitionally true, or over rows the term does not apply
 * to, and it looks identical either way. So every table here carries its `n` and its `baseRate`, the
 * row filter for each term is written next to it, and the Brier score is decomposed so a rare event
 * cannot pass on the strength of never happening.
 */

/** One binary the model emits, its realised counterpart, and the rows it is defined on. */
interface BinarySpec {
  key: string;
  /** what the number means, in the report */
  label: string;
  predicted: (r: PredictionRow) => number;
  /** null = this row does not carry the outcome (a season without the category), so it is dropped */
  actual: (r: PredictionRow) => number | null;
  /** positions the term applies to at all; empty means every position */
  positions: string[];
  note: string;
}

interface CountSpec {
  key: string;
  label: string;
  predicted: (r: PredictionRow) => number;
  actual: (r: PredictionRow) => number | null;
  positions: string[];
  note: string;
}

const BINARIES: BinarySpec[] = [
  {
    key: 'start',
    label: 'P(start)',
    predicted: (r) => r.probabilities.start,
    actual: (r) => r.realised.started,
    positions: [],
    note: 'The term the guide calls the real model. Realised: `starts > 0`.',
  },
  {
    key: 'play',
    label: 'P(any appearance)',
    predicted: (r) => r.probabilities.play,
    actual: (r) => r.realised.played,
    positions: [],
    note: 'Bench order is `pPlay × EP`, so this one is load-bearing outside the points sum too.',
  },
  {
    key: 'sixtyPlus',
    label: 'P(60+ minutes)',
    predicted: (r) => r.probabilities.sixtyPlus,
    actual: (r) => r.realised.sixtyPlus,
    positions: [],
    note: 'Gates both the second appearance point and the clean sheet.',
  },
  {
    key: 'cleanSheet',
    label: 'P(clean sheet credited)',
    predicted: (r) => r.probabilities.cleanSheet,
    actual: (r) => r.realised.cleanSheet,
    positions: ['GKP', 'DEF', 'MID'],
    note:
      'FPL credits a clean sheet only to a player who was on for 60 minutes, so the model number ' +
      'compared here is `P(60+) × exp(−λ_against)` and not the shut-out probability alone. ' +
      'Forwards are excluded: they score nothing for it.',
  },
  {
    key: 'defcon',
    label: 'P(defensive contribution ≥ threshold)',
    predicted: (r) => r.probabilities.defcon,
    actual: (r) => r.realised.defcon,
    positions: ['DEF', 'MID', 'FWD'],
    note:
      'Defined only where the archive carries the category — 2025-26 — and only for positions with ' +
      'a threshold. This is the least-validated term in the model: its two parameters are the one ' +
      'exception to the season holdout.',
  },
  {
    key: 'bonusAtLeastOne',
    label: 'P(bonus ≥ 1)',
    predicted: (r) => r.probabilities.bonusAtLeastOne,
    actual: (r) => r.realised.bonusAtLeastOne,
    positions: [],
    note:
      'DERIVED from the expected bonus as `E[bonus] / 2`, not a number the model serves — the ' +
      'bonus term emits a mean. It is here because the shape of that term is exactly what is in ' +
      'question, and a probability is the only way to ask whether the shape is right.',
  },
];

const COUNTS: CountSpec[] = [
  {
    key: 'goals',
    label: 'E[goals]',
    predicted: (r) => r.expected.goals,
    actual: (r) => r.realised.goals,
    positions: [],
    note: '`xG per 90 × ninetieths × fixture factor × goalsPerXg`.',
  },
  {
    key: 'assists',
    label: 'E[assists]',
    predicted: (r) => r.expected.assists,
    actual: (r) => r.realised.assists,
    positions: [],
    note: '`assistsPerXa` fitted to 1.395 — assists land well above expected assists.',
  },
  {
    key: 'saves',
    label: 'E[saves]',
    predicted: (r) => r.expected.saves,
    actual: (r) => r.realised.saves,
    positions: ['GKP'],
    note: 'Keepers only. Scaled by fixture pressure from λ_against.',
  },
  {
    key: 'conceded',
    label: 'E[goals conceded while on the pitch]',
    predicted: (r) => r.expected.conceded,
    actual: (r) => r.realised.conceded,
    positions: ['GKP', 'DEF'],
    note: 'The positions the rule pays. Expectation scales with expected minutes, as FPL counts it.',
  },
  {
    key: 'bonus',
    label: 'E[bonus]',
    predicted: (r) => r.expected.bonus,
    actual: (r) => r.realised.bonus,
    positions: [],
    note: 'Fitted on 2023-24 and 2024-25 BPS distributions — two rule versions ago.',
  },
  {
    key: 'bps',
    label: 'E[BPS]',
    predicted: (r) => r.expected.bps,
    actual: (r) => r.realised.bps,
    positions: [],
    note: 'The input the bonus term is a function of. A wrong bonus with a right BPS is a shape error.',
  },
  {
    key: 'defconActions',
    label: 'E[defensive actions]',
    predicted: (r) => r.expected.defconActions,
    actual: (r) => r.realised.defconActions,
    positions: ['DEF', 'MID', 'FWD'],
    note: 'The count behind the threshold probability. 2025-26 only.',
  },
  {
    key: 'minutes',
    label: 'E[minutes]',
    predicted: (r) => r.expected.minutes,
    actual: (r) => r.realised.minutes,
    positions: [],
    note: 'The guide: minutes are the largest single source of variance.',
  },
];

export interface BinaryResult {
  key: string;
  label: string;
  note: string;
  overall: BrierScore;
  curve: ReliabilityBin[];
  byPosition: { position: string; brier: BrierScore }[];
  /** rows dropped because the outcome is not defined for them, and why */
  undefinedRows: number;
}

export interface CountResult {
  key: string;
  label: string;
  note: string;
  n: number;
  meanPredicted: number;
  meanActual: number;
  deciles: DecileRow[];
  byPosition: {
    position: string;
    n: number;
    meanPredicted: number;
    meanActual: number;
  }[];
}

export interface ComponentReport {
  label: string;
  path: string;
  rows: number;
  binaries: BinaryResult[];
  counts: CountResult[];
  /** the component the report accuses, or null when the miscalibration is spread */
  verdict: string;
}

const POSITIONS = ['GKP', 'DEF', 'MID', 'FWD'];

@Injectable()
export class ComponentCalibrationService {
  private readonly log = new Logger(ComponentCalibrationService.name);

  constructor(
    private readonly repo: CalibrationRepository,
    private readonly calibration: CalibrationService,
  ) {}

  async evaluate(
    label: string,
    params: FittedParams,
  ): Promise<ComponentReport> {
    const before = await this.repo.projectionCount();
    const scoringFor = await this.calibration.scoringResolver();
    const history = await this.repo.history([...TRAIN_SEASONS, TEST_SEASON]);

    const result = runBacktest(history, params, scoringFor, {
      evaluate: (row) => row.season === TEST_SEASON,
    });
    this.log.log(`scored ${result.rows.length} held-out rows term by term`);

    const binaries = BINARIES.map((spec) =>
      this.scoreBinary(spec, result.rows),
    );
    const counts = COUNTS.map((spec) => this.scoreCount(spec, result.rows));

    const after = await this.repo.projectionCount();
    if (after !== before) {
      // B-007 plan invariant 1. A backtest row in `projections` becomes the newest by `createdAt`
      // and is then served as the current model version.
      throw new Error(
        `the component harness wrote ${after - before} projection rows — it must write none`,
      );
    }

    const verdict = this.verdictFrom(binaries);
    const path = await this.write(
      label,
      result.rows.length,
      binaries,
      counts,
      verdict,
      params,
    );
    return { label, path, rows: result.rows.length, binaries, counts, verdict };
  }

  private scoreBinary(spec: BinarySpec, rows: PredictionRow[]): BinaryResult {
    const applicable = rows.filter(
      (r) => spec.positions.length === 0 || spec.positions.includes(r.position),
    );
    const pairs: BinaryPair[] = [];
    let undefinedRows = 0;
    for (const r of applicable) {
      const y = spec.actual(r);
      if (y === null) {
        undefinedRows++;
        continue;
      }
      pairs.push({ p: spec.predicted(r), y });
    }

    const byPosition = POSITIONS.filter(
      (p) => spec.positions.length === 0 || spec.positions.includes(p),
    ).map((position) => {
      const sub: BinaryPair[] = [];
      for (const r of applicable.filter((r) => r.position === position)) {
        const y = spec.actual(r);
        if (y === null) continue;
        sub.push({ p: spec.predicted(r), y });
      }
      return { position, brier: brierScore(sub) };
    });

    return {
      key: spec.key,
      label: spec.label,
      note: spec.note,
      overall: brierScore(pairs),
      curve: reliabilityCurve(pairs),
      byPosition,
      undefinedRows,
    };
  }

  private scoreCount(spec: CountSpec, rows: PredictionRow[]): CountResult {
    const applicable = rows.filter(
      (r) => spec.positions.length === 0 || spec.positions.includes(r.position),
    );
    const pairs: CountPair[] = [];
    for (const r of applicable) {
      const a = spec.actual(r);
      if (a === null) continue;
      pairs.push({ predicted: spec.predicted(r), actual: a });
    }

    const byPosition = POSITIONS.filter(
      (p) => spec.positions.length === 0 || spec.positions.includes(p),
    ).map((position) => {
      const sub: CountPair[] = [];
      for (const r of applicable.filter((r) => r.position === position)) {
        const a = spec.actual(r);
        if (a === null) continue;
        sub.push({ predicted: spec.predicted(r), actual: a });
      }
      return {
        position,
        n: sub.length,
        meanPredicted: avg(sub.map((s) => s.predicted)),
        meanActual: avg(sub.map((s) => s.actual)),
      };
    });

    return {
      key: spec.key,
      label: spec.label,
      note: spec.note,
      n: pairs.length,
      meanPredicted: avg(pairs.map((p) => p.predicted)),
      meanActual: avg(pairs.map((p) => p.actual)),
      deciles: decileTable(pairs),
      byPosition,
    };
  }

  /**
   * Which term the numbers accuse, stated as a sentence rather than left to the reader.
   *
   * Ranked by the *reliability* component of the Brier score — the calibration error — because that
   * is the one that is about shape. A term can carry a large raw Brier score purely because its
   * event is common, and ranking on that would convict `P(any appearance)` every time.
   */
  private verdictFrom(binaries: BinaryResult[]): string {
    const ranked = [...binaries]
      .filter((b) => b.overall.n > 0)
      .sort((a, b) => b.overall.reliability - a.overall.reliability);
    if (ranked.length === 0)
      return 'no binary had rows to score — nothing is claimed';

    const worst = ranked[0];
    const rest = ranked.slice(1);
    const restMean = rest.length
      ? rest.reduce((s, r) => s + r.overall.reliability, 0) / rest.length
      : 0;
    const ratio =
      restMean > 0 ? worst.overall.reliability / restMean : Infinity;

    if (ratio >= 3) {
      return (
        `${worst.label} carries the calibration error: reliability ${worst.overall.reliability.toFixed(4)}, ` +
        `${ratio.toFixed(1)}× the mean of the other terms (${restMean.toFixed(4)}).`
      );
    }
    return (
      `No single term dominates. Worst is ${worst.label} at reliability ` +
      `${worst.overall.reliability.toFixed(4)} against a mean of ${restMean.toFixed(4)} for the rest ` +
      `(${ratio.toFixed(1)}×) — the miscalibration is spread across components, which is a different ` +
      `and equally publishable answer.`
    );
  }

  private async write(
    label: string,
    rows: number,
    binaries: BinaryResult[],
    counts: CountResult[],
    verdict: string,
    params: FittedParams,
  ): Promise<string> {
    const l: string[] = [];
    const f = (x: number, d = 4) => x.toFixed(d);

    l.push(`# Per-component calibration — ${label}`);
    l.push('');
    l.push(
      `Generated by \`pnpm calibrate:components\`. Held-out season **${TEST_SEASON}**, ` +
        `${rows.toLocaleString()} scored player-rounds. Parameters fitted on ` +
        `${params.provenance.fittedOn.join(' + ') || '— (unfitted)'}.`,
    );
    l.push('');
    l.push(
      'Every table carries `n` and the base rate. A Brier score alone is a trap for a rare event: ' +
        'predicting "never" for a 2% event scores 0.0196 and knows nothing. `reliability` is the ' +
        'calibration error (0 is perfect), `resolution` is how far the model moves off the base rate ' +
        'when it is right, and `skill` is `1 − BS/uncertainty` — positive means better than always ' +
        'predicting the base rate.',
    );
    l.push('');
    l.push('## Verdict');
    l.push('');
    l.push(verdict);
    l.push('');

    l.push('## Binaries');
    l.push('');
    l.push(
      '| term | n | base rate | mean predicted | Brier | reliability | resolution | skill |',
    );
    l.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const b of binaries) {
      const o = b.overall;
      l.push(
        `| ${b.label} | ${o.n.toLocaleString()} | ${f(o.baseRate, 3)} | ${f(o.meanPredicted, 3)} | ` +
          `${f(o.score)} | **${f(o.reliability)}** | ${f(o.resolution)} | ${f(o.skillScore, 3)} |`,
      );
    }
    l.push('');

    for (const b of binaries) {
      l.push(`### ${b.label}`);
      l.push('');
      l.push(b.note);
      if (b.undefinedRows > 0) {
        l.push('');
        l.push(
          `${b.undefinedRows.toLocaleString()} applicable rows carry no outcome for this term and ` +
            `are dropped rather than scored as misses.`,
        );
      }
      l.push('');
      l.push('| predicted band | n | mean predicted | observed rate |');
      l.push('|---|---:|---:|---:|');
      for (const bin of b.curve) {
        if (bin.n === 0) continue;
        l.push(
          `| ${bin.lower.toFixed(1)}–${bin.upper.toFixed(1)} | ${bin.n.toLocaleString()} | ` +
            `${f(bin.meanPredicted, 3)} | ${f(bin.observedRate, 3)} |`,
        );
      }
      l.push('');
      l.push(
        '| position | n | base rate | mean predicted | Brier | reliability |',
      );
      l.push('|---|---:|---:|---:|---:|---:|');
      for (const p of b.byPosition) {
        if (p.brier.n === 0) continue;
        l.push(
          `| ${p.position} | ${p.brier.n.toLocaleString()} | ${f(p.brier.baseRate, 3)} | ` +
            `${f(p.brier.meanPredicted, 3)} | ${f(p.brier.score)} | ${f(p.brier.reliability)} |`,
        );
      }
      l.push('');
    }

    l.push('## Count terms');
    l.push('');
    l.push('| term | n | mean predicted | mean actual | bias |');
    l.push('|---|---:|---:|---:|---:|');
    for (const c of counts) {
      l.push(
        `| ${c.label} | ${c.n.toLocaleString()} | ${f(c.meanPredicted, 3)} | ${f(c.meanActual, 3)} | ` +
          `${f(c.meanPredicted - c.meanActual, 3)} |`,
      );
    }
    l.push('');

    for (const c of counts) {
      l.push(`### ${c.label}`);
      l.push('');
      l.push(c.note);
      l.push('');
      l.push('| decile | n | mean predicted | mean actual |');
      l.push('|---:|---:|---:|---:|');
      for (const d of c.deciles) {
        l.push(
          `| ${d.decile} | ${d.n.toLocaleString()} | ${f(d.meanPredicted, 3)} | ${f(d.meanActual, 3)} |`,
        );
      }
      l.push('');
      l.push('| position | n | mean predicted | mean actual |');
      l.push('|---|---:|---:|---:|');
      for (const p of c.byPosition) {
        if (p.n === 0) continue;
        l.push(
          `| ${p.position} | ${p.n.toLocaleString()} | ${f(p.meanPredicted, 3)} | ${f(p.meanActual, 3)} |`,
        );
      }
      l.push('');
    }

    l.push('---');
    l.push('');
    l.push(
      'This report scores probabilities the model computes internally. `P(bonus ≥ 1)` is derived ' +
        'rather than served, and is labelled so wherever it appears. Nothing here is a statement ' +
        'about decision quality — that is `reports/decision-quality.md` (D-020).',
    );

    const dir = 'reports';
    await mkdir(dir, { recursive: true });
    const path = join(
      dir,
      `calibration-components${label === 'fitted' ? '' : `-${label}`}.md`,
    );
    await writeFile(path, l.join('\n'), 'utf8');
    return path;
  }
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
