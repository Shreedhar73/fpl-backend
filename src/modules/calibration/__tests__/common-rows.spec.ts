import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HistoryRow } from '../../projections/features';
import { UNFITTED_PARAMS } from '../../projections/fitted';
import { Scoring, RawScoring } from '../../projections/scoring';
import {
  commonRows,
  excludedRows,
  observationsFor,
  runBacktest,
} from '../harness';
import { describePopulation } from '../metrics';

/**
 * B-012 Phase 0 — the comparison artefact, and the one place fixing it must NOT reach.
 *
 * B-007's headline compared the model at n=29,482 with `form` at n=28,905. `form` cannot produce a
 * number for a player with no trailing round — a debut, a return from a long injury, a new signing —
 * so those rows appeared on one side of the comparison and not the other. Part of the MAE gap was
 * bookkeeping and nobody could say how much.
 *
 * The fix is to compare on the rows every predictor could reach. The danger in the fix is that the
 * same restriction, applied to the FIT, would silently move every fitted constant — and the tests
 * below are what stop that.
 */

const SCORING: RawScoring = {
  long_play: 2,
  short_play: 1,
  goals_scored: { GKP: 10, DEF: 6, MID: 5, FWD: 4 },
  clean_sheets: { GKP: 4, DEF: 4, MID: 1, FWD: 0 },
  goals_conceded: { GKP: -1, DEF: -1, MID: 0, FWD: 0 },
  defensive_contribution: { GKP: 0, DEF: 2, MID: 2, FWD: 2 },
  assists: 3,
  saves: 1,
  bonus: 1,
  own_goals: -2,
  penalties_saved: 5,
  penalties_missed: -2,
  yellow_cards: -1,
  red_cards: -3,
};

const scoringFor = () => Scoring.from(SCORING);

const row = (over: Partial<HistoryRow>): HistoryRow => ({
  season: '2024-25',
  round: 1,
  fixture: 1,
  playerCode: 100,
  webName: 'Test',
  position: 'MID',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
  minutes: 90,
  starts: 1,
  totalPoints: 5,
  goalsScored: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 0,
  saves: 0,
  bonus: 0,
  bps: 20,
  defensiveContribution: null,
  expectedGoals: 0.3,
  expectedAssists: 0.2,
  value: 70,
  ...over,
});

/**
 * A veteran with rounds behind him and a debutant appearing for the first time in the scored round.
 *
 * The debutant is the whole point: at round 3 the model can price him (he has one prior appearance,
 * from round 2) and `form` can too — so to build a row `form` genuinely cannot reach we need a player
 * whose only prior appearance is in a season that has ended, which is what `lastSeason` carries and
 * `form` does not.
 */
function corpus(): HistoryRow[] {
  return [
    // A veteran who plays every round of both seasons.
    ...[1, 2, 3].map((r) =>
      row({ season: '2023-24', round: r, playerCode: 1, webName: 'Veteran' }),
    ),
    ...[1, 2].map((r) =>
      row({ season: '2024-25', round: r, playerCode: 1, webName: 'Veteran' }),
    ),
    // A player with last season behind him and NO round of this season yet: the model can price him
    // from his career, and `form` — which is this season's trailing rounds only — cannot.
    ...[1, 2, 3].map((r) =>
      row({
        season: '2023-24',
        round: r,
        playerCode: 2,
        webName: 'Returner',
        fixture: 2,
        minutes: 90,
      }),
    ),
    row({ season: '2024-25', round: 1, playerCode: 2, webName: 'Returner', fixture: 2 }),
  ];
}

describe('the comparison artefact', () => {
  const result = runBacktest(corpus(), UNFITTED_PARAMS, scoringFor, {
    evaluate: (r) => r.season === '2024-25',
  });

  it('predicts rows a baseline cannot reach, instead of dropping them from one side', () => {
    // The shape B-007 had: three parallel arrays, each missing different rows. The shape now: one
    // row per player-round, with `null` where a predictor had nothing to say.
    const withoutForm = result.rows.filter((r) => r.predicted.form === null);
    expect(withoutForm.length).toBeGreaterThan(0);
    // The model priced every one of them — that is precisely why they used to skew the comparison.
    for (const r of withoutForm) expect(r.predicted.model).not.toBeNull();
  });

  it('null is not zero — an unreachable row is absent, not predicted as 0', () => {
    // A predictor with nothing to say has not said zero. Coercing would be the quiet version of the
    // bug this phase fixes: form would score every row, the populations would match, and its MAE
    // would be flattered by free zeros on rows where the outcome is usually zero too.
    const unreachable = result.rows.filter((r) => r.predicted.form === null);
    expect(unreachable.length).toBeGreaterThan(0);

    const formObservations = observationsFor(result.rows, 'form');
    expect(formObservations.length).toBe(result.rows.length - unreachable.length);

    // and specifically: none of the unreachable players appears in form's observations for its round
    for (const missing of unreachable) {
      expect(
        formObservations.some(
          (o) =>
            o.playerCode === missing.playerCode && o.round === missing.round,
        ),
      ).toBe(false);
    }
  });

  it('the restriction actually bites, so the headline it produces is a different number', () => {
    const common = commonRows(result.rows);
    const excluded = excludedRows(result.rows);
    expect(common.length + excluded.length).toBe(result.rows.length);
    expect(excluded.length).toBeGreaterThan(0);
  });

  it('describes the excluded rows rather than only counting them', () => {
    // "577 rows excluded" invites the reader to assume they were unremarkable. They are the rows
    // nobody had a trailing number for, and they score differently.
    const summary = describePopulation(excludedRows(result.rows));
    expect(summary.n).toBeGreaterThan(0);
    expect(summary.byPosition.length).toBeGreaterThan(0);
    expect(summary.byPriceBand.some((b) => b.n > 0)).toBe(true);
  });

  it('every observation can be traced back to a player', () => {
    // Without this the metrics support a mean and nothing else — no ranking, no squad, no naming.
    for (const o of observationsFor(result.rows, 'model')) {
      expect(o.playerCode).toBeGreaterThan(0);
      expect(o.webName).toBeTruthy();
    }
  });
});

describe('the appearance count the walk accumulates', () => {
  it('counts rows with minutes, not rows — they are different numbers', () => {
    // `matchesSample` counts every row including unused-sub zeros; `appearancesSample` counts only
    // rows where the player featured. B-010's floor is defined on the second, and the names are
    // close enough that taking the wrong one would pass review.
    const rows = [
      row({ season: '2024-25', round: 1, playerCode: 9, minutes: 0, starts: 0 }),
      row({ season: '2024-25', round: 2, playerCode: 9, minutes: 90 }),
      row({ season: '2024-25', round: 3, playerCode: 9, minutes: 0, starts: 0 }),
      row({ season: '2024-25', round: 4, playerCode: 9, minutes: 90 }),
    ];
    const result = runBacktest(rows, UNFITTED_PARAMS, scoringFor, {
      evaluate: (r) => r.round === 4,
    });
    // Three prior rows, one of which was a real appearance... two, at rounds 2 and 4 — but round 4
    // is the one being predicted, so only round 2 counts.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].appearances).toBe(1);
  });

  it('cannot see an appearance from the round it is predicting', () => {
    // The leak this counter exists to avoid: `appearanceCounts()` reads current state, so a squad
    // built at round 1 of a past season would be told how often each player would GO ON to feature.
    const rows = [1, 2, 3, 4, 5].map((r) =>
      row({ season: '2024-25', round: r, playerCode: 9, minutes: 90 }),
    );
    const result = runBacktest(rows, UNFITTED_PARAMS, scoringFor, {
      evaluate: () => true,
    });
    // Round 1 is scored with nothing behind it and is skipped for having no prior appearance; each
    // later round sees exactly the rounds before it, never its own and never the season's total.
    expect(result.rows.map((r) => `${r.round}:${r.appearances}`)).toEqual([
      '2:1',
      '3:2',
      '4:3',
      '5:4',
    ]);
  });
});

describe('the fit must not inherit the restriction', () => {
  const root = join(__dirname, '../../../..');
  const source = readFileSync(
    join(root, 'src/modules/calibration/fit.ts'),
    'utf8',
  );

  it('scores its grid search on the model\'s own rows, not the common ones', () => {
    // `fit.ts` runs its shape-parameter grid search THROUGH `runBacktest` — the plan for this work
    // claimed it did not, and it does. So the reshape reaches the fit, and a well-meaning tidy-up
    // that swapped `observationsFor(run.rows, 'model')` for `commonRows` would throw away the
    // hardest rows in the training corpus and move every fitted constant, with no error and no
    // wrong-looking output. A grid search compares one predictor against itself; there is no second
    // population to hold in common.
    expect(source).toContain("observationsFor(run.rows, 'model')");
    expect(source).not.toContain('commonRows');
  });

  it('is scored on more rows than a common-row restriction would leave it', () => {
    // The behavioural half of the same claim: the two populations are genuinely different, so the
    // structural check above is protecting a real difference rather than a stylistic one.
    const result = runBacktest(corpus(), UNFITTED_PARAMS, scoringFor, {
      evaluate: (r) => r.season === '2024-25',
    });
    const fitPopulation = observationsFor(result.rows, 'model');
    const comparisonPopulation = observationsFor(
      commonRows(result.rows),
      'model',
    );
    expect(fitPopulation.length).toBeGreaterThan(comparisonPopulation.length);
  });
});
