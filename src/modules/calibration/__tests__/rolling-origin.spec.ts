import { HistoryRow } from '../../projections/features';
import {
  acrossFolds,
  assertNoLeak,
  capabilityOf,
  pairedByRound,
  planFolds,
  splitForFold,
} from '../rolling-origin';
import { renderReport, verdict } from '../rolling-origin.service';

const row = (
  over: Partial<HistoryRow> & { season: string; round: number },
): HistoryRow => ({
  fixture: over.round * 100 + (over.playerCode ?? 1),
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
  minutes: 90,
  starts: 1,
  totalPoints: 2,
  goalsScored: 0,
  ownGoals: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 1,
  saves: 0,
  bonus: 0,
  bps: 15,
  defensiveContribution: null,
  expectedGoals: null,
  expectedAssists: null,
  expectedGoalsConceded: null,
  ictIndex: 0,
  influence: null,
  creativity: null,
  threat: null,
  value: 50,
  ...over,
});

/** `rounds` rounds of one season, with whatever per-season shape the case needs. */
const season = (
  label: string,
  rounds: number,
  over: Partial<HistoryRow> = {},
): HistoryRow[] =>
  Array.from({ length: rounds }, (_, i) =>
    row({ season: label, round: i + 1, ...over }),
  );

/**
 * The archive's real shape, in miniature: no start label before 2023-24, no defensive-contribution
 * category before 2025-26. Every fold-planning claim in this file is about that shape, so inventing
 * a rectangular corpus here would test a database this project does not have.
 */
const archive = (): HistoryRow[] => [
  ...season('2021-22', 4, { starts: null }),
  ...season('2022-23', 4, { starts: null }),
  ...season('2023-24', 4, { starts: 1 }),
  ...season('2024-25', 4, { starts: 1 }),
  ...season('2025-26', 4, { starts: 1, defensiveContribution: 3 }),
];

describe('capabilityOf', () => {
  it('counts what a corpus can fit rather than which seasons it names', () => {
    const c = capabilityOf(season('2021-22', 3, { starts: null }));
    expect(c.trainRows).toBe(3);
    expect(c.startLabelRows).toBe(0);
    expect(c.fittable.minutes).toBe(false);
    expect(c.fittable.rates).toBe(true);
  });

  it('treats a single start label as fittable and says how thin it was', () => {
    const rows = [
      ...season('2021-22', 3, { starts: null }),
      row({ season: '2022-23', round: 1, starts: 1 }),
    ];
    const c = capabilityOf(rows);
    expect(c.startLabelRows).toBe(1);
    expect(c.fittable.minutes).toBe(true);
  });
});

describe('planFolds', () => {
  it('refuses the folds whose training seasons carry no start label, by name', () => {
    const plans = planFolds(archive());
    const bySeason = new Map(plans.map((p) => [p.evalSeason, p]));

    // 2022-23 and 2023-24 train only on seasons the archive never recorded `starts` for.
    expect(bySeason.get('2022-23')!.blockers.length).toBeGreaterThan(0);
    expect(bySeason.get('2023-24')!.blockers[0]).toMatch(/no start labels/);
    // 2024-25 trains on 2023-24, which has them.
    expect(bySeason.get('2024-25')!.blockers).toEqual([]);
    expect(bySeason.get('2025-26')!.blockers).toEqual([]);
    // The first season can never be a fold — nothing precedes it.
    expect(bySeason.has('2021-22')).toBe(false);
  });

  it('takes the defensive-contribution parameters from the past when the past has them', () => {
    const rows = [
      ...archive(),
      ...season('2026-27', 4, { starts: 1, defensiveContribution: 2 }),
    ];
    const plans = planFolds(rows);
    const bySeason = new Map(plans.map((p) => [p.evalSeason, p]));
    // 2025-26 is the first season with the category, so its own early rounds have to fit it and the
    // rounds they read are not scored.
    expect(bySeason.get('2025-26')!.defcon).toBe('within-season');
    expect(bySeason.get('2025-26')!.evalFromRound).toBeGreaterThan(1);
    // 2026-27 has 2025-26 behind it, so nothing of its own is read and every round is scored.
    expect(bySeason.get('2026-27')!.defcon).toBe('prior-seasons');
    expect(bySeason.get('2026-27')!.evalFromRound).toBe(1);
    // A season before the category existed reads no parameter at all.
    expect(bySeason.get('2024-25')!.defcon).toBe('absent');
  });

  it('honours a finite training window', () => {
    const plans = planFolds(archive(), { trainWindow: 1 });
    const fold = plans.find((p) => p.evalSeason === '2025-26')!;
    expect(fold.trainSeasons).toEqual(['2024-25']);
  });
});

describe('splitForFold', () => {
  it('reserves the tail of the season before the fold for shape parameters only', () => {
    const rows = [
      ...season('2023-24', 30, { starts: 1 }),
      ...season('2024-25', 30, { starts: 1 }),
      ...season('2025-26', 30, { starts: 1, defensiveContribution: 3 }),
    ];
    const plan = planFolds(rows).find((p) => p.evalSeason === '2025-26')!;
    const split = splitForFold(rows, plan);

    expect(plan.validateSeason).toBe('2024-25');
    expect(split.validate.every((r) => r.season === '2024-25')).toBe(true);
    expect(split.validate.every((r) => r.round >= 20)).toBe(true);
    // A row cannot be in both.
    expect(
      split.train.some((r) => r.season === '2024-25' && r.round >= 20),
    ).toBe(false);
  });
});

describe('assertNoLeak — the sabotage that must go red', () => {
  const rows = [
    ...season('2023-24', 30, { starts: 1 }),
    ...season('2024-25', 30, { starts: 1 }),
    ...season('2025-26', 30, { starts: 1, defensiveContribution: 3 }),
  ];
  const plan = () => planFolds(rows).find((p) => p.evalSeason === '2025-26')!;

  it('passes on an honest split', () => {
    expect(() =>
      assertNoLeak(plan(), splitForFold(rows, plan())),
    ).not.toThrow();
  });

  /**
   * Sabotage 1 of plan 027 task 2: add the evaluation season to its own training set. Without this
   * assertion the fold produces a complete, plausible, better-looking set of numbers — the failure
   * mode is invisible in the output, which is the whole reason it is asserted rather than reviewed.
   */
  it('throws when the evaluation season reaches the training set', () => {
    const p = plan();
    const split = splitForFold(rows, p);
    split.train.push(row({ season: '2025-26', round: 1, starts: 1 }));
    expect(() => assertNoLeak(p, split)).toThrow(/reached the training set/);
  });

  it('throws when the evaluation season reaches the validation set', () => {
    const p = plan();
    const split = splitForFold(rows, p);
    split.validate.push(row({ season: '2025-26', round: 2, starts: 1 }));
    expect(() => assertNoLeak(p, split)).toThrow(/reached the validation set/);
  });

  /**
   * The one admitted exception, bounded: when the defensive-contribution category exists nowhere
   * earlier, its parameters are fitted on the evaluation season's early rounds — and those rounds
   * are then outside the scored window. A fold that reads a round AND scores it is the leak wearing
   * the exception's clothes.
   */
  it('throws when a round read by the defcon fit is also scored', () => {
    const p = { ...plan(), evalFromRound: 1 };
    const split = splitForFold(rows, p);
    expect(split.defconTrain.length).toBeGreaterThan(0);
    expect(() => assertNoLeak(p, split)).toThrow(/is inside the scored window/);
  });

  it('throws when a fold that did not need the evaluation season reads it for defcon anyway', () => {
    const p = { ...plan(), defcon: 'absent' as const };
    const split = splitForFold(rows, p);
    split.defconTrain.push(row({ season: '2025-26', round: 1 }));
    expect(() => assertNoLeak(p, split)).toThrow(
      /reached the defensive-contribution fit/,
    );
  });
});

describe('pairedByRound', () => {
  const rv = (round: number, value: number) => ({
    season: '2025-26',
    round,
    value,
  });

  /**
   * Sabotage 2 of plan 027 task 2, in its pure form: an arm scored against itself must produce
   * exactly zero, not a plausible small number. If a fake fold ever returns the incumbent's own
   * predictions, this is the arithmetic that makes it obvious.
   */
  it('is exactly zero for an arm paired against itself', () => {
    const a = [rv(1, 0.4), rv(2, 0.6), rv(3, 0.51)];
    const p = pairedByRound(a, a)!;
    expect(p.meanDifference).toBe(0);
    expect(p.standardError).toBe(0);
    expect(p.clearsNoise).toBe(false);
  });

  it('drops a round only one arm produced, rather than scoring it as zero for the other', () => {
    const p = pairedByRound(
      [rv(1, 0.5), rv(2, 0.5), rv(3, 0.5)],
      [rv(1, 0.4), rv(2, 0.4)],
    )!;
    expect(p.rounds).toBe(2);
    expect(p.meanDifference).toBeCloseTo(0.1, 12);
  });

  it('returns null rather than a difference from a single round', () => {
    expect(pairedByRound([rv(1, 0.5)], [rv(1, 0.4)])).toBeNull();
  });
});

describe('acrossFolds', () => {
  const paired = (meanDifference: number) => ({
    rounds: 38,
    meanDifference,
    standardError: 0.001,
    clearsNoise: true,
  });

  /**
   * The number one holdout cannot produce. `reports/guards-009.md` measured the same comparison at
   * −2.41, +2.34 and +0.97 across three seasons; within any one of those the error bar said the
   * result was solid.
   */
  it('reports no standard error from a single fold', () => {
    const a = acrossFolds([{ season: '2025-26', paired: paired(0.05) }])!;
    expect(a.folds).toBe(1);
    expect(a.standardError).toBeNull();
    expect(a.clearsNoise).toBe(false);
  });

  it('widens when the folds disagree, and keeps every fold visible', () => {
    const agree = acrossFolds([
      { season: '2023-24', paired: paired(0.05) },
      { season: '2024-25', paired: paired(0.055) },
      { season: '2025-26', paired: paired(0.045) },
    ])!;
    const disagree = acrossFolds([
      { season: '2023-24', paired: paired(0.05) },
      { season: '2024-25', paired: paired(-0.04) },
      { season: '2025-26', paired: paired(0.14) },
    ])!;
    expect(agree.clearsNoise).toBe(true);
    expect(disagree.standardError!).toBeGreaterThan(agree.standardError!);
    expect(disagree.clearsNoise).toBe(false);
    expect(disagree.perFold.map((f) => f.season)).toEqual([
      '2023-24',
      '2024-25',
      '2025-26',
    ]);
  });

  it('is null when no fold produced a pairing', () => {
    expect(acrossFolds([{ season: '2025-26', paired: null }])).toBeNull();
  });
});

/**
 * The verdict is prose generated from numbers, and the test for it is a DIFF of the prose under two
 * different inputs — `sim-verdict.ts` earned this rule by emitting the same paragraph whatever the
 * run produced. A test that only checked the numbers would pass against exactly that bug.
 */
describe('verdict', () => {
  const report = (
    perFold: number[],
    refusedSeasons: string[] = [],
  ): Parameters<typeof verdict>[0] => {
    const plans = planFolds(archive());
    const mk = (season: string, meanDifference: number, ran: boolean) => ({
      plan: plans.find((p) => p.evalSeason === season) ?? plans[0],
      ran,
      paired: {
        'model vs form': {
          rounds: 38,
          meanDifference,
          standardError: 0.001,
          clearsNoise: true,
        },
      },
      rounds: 38,
      scoredRows: 100,
    });
    const seasons = ['2022-23', '2023-24', '2024-25', '2025-26'];
    return {
      generated: '2026-08-28T00:00:00.000Z',
      seasons,
      totalRows: 100,
      k: 11,
      imputedStarts: false,
      seasonHalfLife: Infinity,
      selectedWindow: false,
      availabilityMode: 'joint' as const,
      selectedRates: false,
      perPlayerStart: false,
      selectedBonusTau: false,
    crowd: false,
    prior: false,
    startShrink: false,
    confidence: false,
      trainWindow: null,
      folds: [
        ...perFold.map((d, i) => mk(seasons[i], d, true)),
        ...refusedSeasons.map((s) => mk(s, 0, false)),
      ],
      across: {
        'model vs form': acrossFolds(
          perFold.map((d, i) => ({
            season: seasons[i],
            paired: {
              rounds: 38,
              meanDifference: d,
              standardError: 0.001,
              clearsNoise: true,
            },
          })),
        ),
      },
    };
  };

  it('says something different when the folds disagree about the sign', () => {
    const agreeing = verdict(report([0.05, 0.055, 0.045])).join('\n');
    const flipping = verdict(report([0.05, -0.04, 0.14])).join('\n');
    expect(agreeing).not.toEqual(flipping);
    expect(agreeing).toMatch(/Every fold agrees on the sign/);
    expect(flipping).toMatch(/do not agree on a sign/);
    expect(flipping).toMatch(/does NOT clear/i);
  });

  it('names the refused folds instead of reporting a fold count that flatters the run', () => {
    const text = verdict(report([0.05, 0.05], ['2022-23'])).join('\n');
    expect(text).toMatch(/2 of 3 planned folds ran/);
    expect(text).toMatch(/2022-23/);
  });

  it('says a two-fold clearance is a direction, and stops saying it once there are enough folds', () => {
    const two = verdict(report([0.05, 0.055])).join('\n');
    const four = verdict(report([0.05, 0.055, 0.045, 0.05])).join('\n');
    expect(two).toMatch(/direction, not a decision/);
    expect(four).not.toMatch(/direction, not a decision/);
  });

  it('labels the metric it actually paired on', () => {
    const at15 = { ...report([0.05, 0.05]), k: 15 };
    expect(verdict(at15).join('\n')).toMatch(/captured@15/);
    expect(renderReport(at15)).toMatch(/mean Δ captured@15/);
    expect(renderReport(at15)).not.toMatch(/captured@11/);
  });

  it('refuses to call one fold a result', () => {
    const text = verdict(report([0.05])).join('\n');
    expect(text).toMatch(/point estimate with no scale/);
  });

  it('renders a report that carries the refusals and the per-fold means', () => {
    const md = renderReport(report([0.05, -0.04], ['2025-26']));
    expect(md).toMatch(/Folds that were refused/);
    expect(md).toMatch(/2022-23 \+5\.0%/);
    expect(md).toMatch(/2023-24 -4\.0%/);
  });
});
