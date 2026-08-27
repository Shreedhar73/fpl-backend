import { Scoring } from '../projections/scoring';
import { FittedParams } from '../projections/fitted';
import { availabilitySignal } from '../projections/model-v2';
import { HistoryRow } from '../projections/features';
import { PredictionRow, runBacktest } from './harness';
import { orderingByRound, summariseOrdering } from './ordering';

/**
 * The one TEST reading of plan 024's bar, leg by leg, for the minutes model's availability terms.
 *
 * Two arms over the same held-out rows: the incumbent (base curves + the hand multiplier applied to
 * the historical flags) and the candidate (the joint refit with fitted availability). Both read the
 * SAME Wayback flags — the arms differ in what they do with them, never in what they know.
 *
 * The decisive leg is the UNCERTAIN band — status `d`, or a 25/50/75 chance. `u`/`s` rows are
 * near-deterministic for both arms and a win made of them is the checks-that-cannot-fail shape the
 * bar exists to exclude; they are reported, and they carry no verdict.
 *
 * Every comparison is PAIRED: per-row Brier differences with the standard error of the mean
 * difference, so a sub-noise claim is visibly sub-noise (B-030's rule, applied to probabilities).
 */

interface BandStats {
  n: number;
  /** paired mean Brier per arm, and the paired difference with its standard error */
  incumbent: number;
  candidate: number;
  diff: number;
  se: number;
}

interface Band {
  label: string;
  member: (flags: { status: string; chance: number | null } | undefined) => boolean;
}

const BANDS: Band[] = [
  {
    label: 'uncertain band (d, or chance 25/50/75) — DECISIVE',
    member: (f) =>
      f !== undefined &&
      !availabilitySignal(f.status, f.chance).zero &&
      (f.status === 'd' ||
        f.chance === 25 ||
        f.chance === 50 ||
        f.chance === 75),
  },
  {
    label: 'all flagged (status != a)',
    member: (f) => f !== undefined && f.status !== 'a',
  },
  { label: 'unflagged (status a)', member: (f) => f !== undefined && f.status === 'a' },
  { label: 'unknown (no capture in bound)', member: (f) => f === undefined },
  { label: 'all rows', member: () => true },
];

export interface AvailabilityVerdict {
  report: string;
  /** the decisive leg: candidate beats incumbent on Brier P(start) AND P(play) in the uncertain band */
  decisiveLegMet: boolean;
}

export function availabilityReport(
  rows: HistoryRow[],
  testSeason: string,
  incumbent: FittedParams,
  candidate: FittedParams,
  scoringFor: (season: string) => Scoring,
): AvailabilityVerdict {
  const evaluate = (row: HistoryRow) => row.season === testSeason;
  const incRun = runBacktest(rows, incumbent, scoringFor, { evaluate });
  const candRun = runBacktest(rows, candidate, scoringFor, { evaluate });

  // Pair rows by natural key. The two runs walk identical rows, but pairing by construction rather
  // than by index means a future skip-rule change cannot silently misalign the arms.
  const key = (r: PredictionRow) =>
    `${r.season}|${r.round}|${r.playerCode}|${r.opponentTeamCode}`;
  const candByKey = new Map(candRun.rows.map((r) => [key(r), r]));

  const flagsByKey = new Map<string, { status: string; chance: number | null }>();
  for (const r of rows) {
    if (r.season !== testSeason) continue;
    if (r.deadlineStatus === null || r.deadlineStatus === undefined) continue;
    flagsByKey.set(`${r.season}|${r.round}|${r.playerCode}`, {
      status: r.deadlineStatus,
      chance: r.deadlineChance ?? null,
    });
  }

  const pairs: {
    flags: { status: string; chance: number | null } | undefined;
    inc: PredictionRow;
    cand: PredictionRow;
  }[] = [];
  for (const inc of incRun.rows) {
    const cand = candByKey.get(key(inc));
    if (!cand) continue;
    pairs.push({
      flags: flagsByKey.get(`${inc.season}|${inc.round}|${inc.playerCode}`),
      inc,
      cand,
    });
  }

  const brierBand = (
    band: Band,
    p: (r: PredictionRow) => number,
    y: (r: PredictionRow) => number,
  ): BandStats => {
    const diffs: number[] = [];
    let incSum = 0;
    let candSum = 0;
    for (const { flags, inc, cand } of pairs) {
      if (!band.member(flags)) continue;
      const target = y(inc);
      const bi = (p(inc) - target) ** 2;
      const bc = (p(cand) - target) ** 2;
      incSum += bi;
      candSum += bc;
      diffs.push(bc - bi);
    }
    const n = diffs.length;
    if (n === 0) return { n, incumbent: NaN, candidate: NaN, diff: NaN, se: NaN };
    const mean = diffs.reduce((a, b) => a + b, 0) / n;
    const varSum = diffs.reduce((a, b) => a + (b - mean) ** 2, 0);
    const se = n > 1 ? Math.sqrt(varSum / (n - 1) / n) : NaN;
    return { n, incumbent: incSum / n, candidate: candSum / n, diff: mean, se };
  };

  const lines: string[] = [
    `# Availability fit — one TEST reading (${testSeason}), plan 024`,
    '',
    `Paired rows: ${pairs.length} (incumbent run ${incRun.rows.length}, candidate ${candRun.rows.length}).`,
    'Brier differences are candidate − incumbent: NEGATIVE means the candidate is better.',
    '`±` is the standard error of the paired mean difference; a diff inside ±2se is noise, and says so.',
    '',
  ];

  let decisiveStart = false;
  let decisivePlay = false;

  for (const [what, p, y] of [
    [
      'P(start)',
      (r: PredictionRow) => r.probabilities.start,
      (r: PredictionRow) => r.realised.started,
    ],
    [
      'P(play)',
      (r: PredictionRow) => r.probabilities.play,
      (r: PredictionRow) => r.realised.played,
    ],
  ] as const) {
    lines.push(`## Brier ${what}`, '', '| band | n | incumbent | candidate | diff ± se | verdict |', '|---|---|---|---|---|---|');
    for (const band of BANDS) {
      const s = brierBand(band, p, y);
      const clears = Number.isFinite(s.se) && s.diff < 0 && Math.abs(s.diff) > 2 * s.se;
      const worse = Number.isFinite(s.se) && s.diff > 0 && s.diff > 2 * s.se;
      const verdict =
        s.n === 0 ? '—' : clears ? 'candidate better' : worse ? 'candidate WORSE' : 'noise';
      lines.push(
        `| ${band.label} | ${s.n} | ${s.incumbent.toFixed(5)} | ${s.candidate.toFixed(5)} | ` +
          `${s.diff >= 0 ? '+' : ''}${s.diff.toFixed(5)} ± ${s.se.toFixed(5)} | ${verdict} |`,
      );
      if (band.label.includes('DECISIVE')) {
        if (what === 'P(start)') decisiveStart = clears;
        else decisivePlay = clears;
      }
    }
    lines.push('');
  }

  // Leg 2 — overall points RMSE, paired. The candidate must be no worse: a positive diff past 2se
  // is a fail, anything else holds.
  const sqDiffs: number[] = [];
  let incSq = 0;
  let candSq = 0;
  for (const { inc, cand } of pairs) {
    const ei = ((inc.predicted.model ?? 0) - inc.actual) ** 2;
    const ec = ((cand.predicted.model ?? 0) - cand.actual) ** 2;
    incSq += ei;
    candSq += ec;
    sqDiffs.push(ec - ei);
  }
  const mseDiff = sqDiffs.reduce((a, b) => a + b, 0) / sqDiffs.length;
  const mseMean = mseDiff;
  const mseSe = Math.sqrt(
    sqDiffs.reduce((a, b) => a + (b - mseMean) ** 2, 0) /
      (sqDiffs.length - 1) /
      sqDiffs.length,
  );
  const rmseWorse = mseDiff > 0 && mseDiff > 2 * mseSe;
  lines.push(
    '## Points RMSE (paired, whole test season)',
    '',
    `incumbent ${Math.sqrt(incSq / pairs.length).toFixed(4)}, candidate ${Math.sqrt(candSq / pairs.length).toFixed(4)}; ` +
      `paired MSE diff ${mseDiff >= 0 ? '+' : ''}${mseDiff.toFixed(5)} ± ${mseSe.toFixed(5)} — ` +
      (rmseWorse ? 'candidate WORSE (leg fails)' : mseDiff < -2 * mseSe ? 'candidate better' : 'noise (leg holds)'),
    '',
  );

  // Leg 3 — ordering, each arm ranking with its own numbers over the same rows.
  const ks = [11, 15, 20];
  lines.push('## Ordering (precision@k, mean over rounds)', '', '| arm | ' + ks.map((k) => `@${k}`).join(' | ') + ' | spearman |', '|---|---|---|---|---|');
  const orderingRow = (label: string, rows: PredictionRow[]) => {
    const summary = summariseOrdering(orderingByRound(rows, 'model', undefined, ks), ks);
    lines.push(
      `| ${label} | ` +
        ks.map((k) => `${(100 * (summary.meanPrecision.get(k) ?? 0)).toFixed(1)}%`).join(' | ') +
        ` | ${(summary.meanSpearman ?? 0).toFixed(4)} |`,
    );
    return summary;
  };
  const incOrd = orderingRow('incumbent', incRun.rows);
  const candOrd = orderingRow('candidate', candRun.rows);
  const orderingHolds = ks.every(
    (k) => (candOrd.meanPrecision.get(k) ?? 0) >= (incOrd.meanPrecision.get(k) ?? 0) - 0.02,
  );
  lines.push(
    '',
    `Ordering leg (no worse than incumbent within 2 points of precision at every k): ${orderingHolds ? 'holds' : 'FAILS'}.`,
    '',
  );

  const decisiveLegMet = decisiveStart && decisivePlay;
  lines.push(
    '## Decisive leg (plan 024)',
    '',
    `Uncertain-band Brier must clear 2se in the candidate's favour for BOTH P(start) and P(play):`,
    `- P(start): ${decisiveStart ? 'CLEARS' : 'does not clear'}`,
    `- P(play): ${decisivePlay ? 'CLEARS' : 'does not clear'}`,
    '',
    `**Decisive leg ${decisiveLegMet ? 'MET' : 'NOT MET'}; RMSE leg ${rmseWorse ? 'FAILS' : 'holds'}; ordering leg ${orderingHolds ? 'holds' : 'FAILS'}.**`,
    'The bar needs all three. The leak-guard leg is the test suite, run separately.',
  );

  return {
    report: lines.join('\n'),
    decisiveLegMet: decisiveLegMet && !rmseWorse && orderingHolds,
  };
}
