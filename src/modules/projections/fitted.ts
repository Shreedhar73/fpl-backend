import { StrengthParams } from './strength';

/**
 * Every number the projection model used to guess.
 *
 * v1's constants were first estimates written into `model.ts` and `minutes.ts` — `0.7` for the defcon
 * ramp, `0.15` per FDR step, `85` starter minutes, a `0.6` bonus coefficient. None was fitted to
 * anything, because until B-007 Phase 2b there was one gameweek of data to fit to.
 *
 * They live here rather than in a database table for the same reason the reconstructed scoring tables
 * do: **a fitted number has to be reviewable in a diff.** A constant that changes silently between
 * runs is indistinguishable from a bug, and `provenance` below is what makes a later session able to
 * tell whether a value was measured or typed.
 *
 * Regenerate with `pnpm fit:model`, which prints this file's contents and the objective it minimised.
 */

export interface MinutesParams {
  /** P(start) given a lagged start rate — a logistic on it, fitted rather than assumed to be identity */
  startIntercept: number;
  startSlope: number;
  /**
   * P(appearing at all | not starting), as ONE league-wide number.
   *
   * Kept as the fallback the sub curve collapses to, and as the number the report quotes for the
   * population. It is no longer what the model multiplies by: B-013 measured that constant as the
   * model's worst-calibrated shape, because it pays a never-used fringe player and a first substitute
   * the same 15.4%.
   */
  subAppearanceRate: number;
  /**
   * The sub curve — `P(appear | did not start)` as a logistic on the logit of the player's OWN lagged
   * rate, fitted the same way `startIntercept`/`startSlope` are (B-019).
   *
   * `subSlope: 0` reduces this exactly to the old constant behaviour with
   * `subIntercept = logit(subAppearanceRate)`, which is how the unfitted baseline states it.
   */
  subIntercept: number;
  subSlope: number;
  /** P(playing 60+ | started) — a starter is not a certainty to see the hour */
  sixtyGivenStart: number;
  /** P(playing 60+ | came off the bench) */
  sixtyGivenSub: number;
  /** E[minutes | started] and E[minutes | sub], for the expected-minutes report only */
  minutesGivenStart: number;
  minutesGivenSub: number;
  /**
   * Price a starter with his OWN minute record rather than the league constant (B-041, plan 028
   * task 3).
   *
   * Absent or false is the incumbent, exactly. True and the two constants above become fallbacks for
   * players with no start history — everyone else is priced on what he actually does when he starts,
   * which over 591 players with ten or more starts runs from 69.1 to 90.0 minutes against a single
   * fitted 82.8.
   */
  perPlayerStart?: boolean;
  /**
   * Pseudo-count of CAREER matches added to the season record when the lagged start rate is built
   * (B-042, plan 029 task 5).
   *
   * Absent or 0 is the incumbent: the season's own rate the moment it has one match, which after
   * round 1 is a step function on a single observation — a player who came off the bench once is
   * rated as a substitute (rate 0), one who started once as a certainty (rate 1), and the fitted
   * curve then regresses both toward the middle from opposite ends. A pseudo-count blends the season
   * toward the career rate the way `laggedSubRate` has since B-019: `(season starts + k × career
   * rate) / (season matches + k)`. The start curve is a regression ON this feature, so a candidate
   * value is a refit rather than a rescore.
   */
  startRateShrink?: number;
  /**
   * Keeper-specific minutes curves (B-021), absent in params fitted before they existed.
   *
   * Keepers are the one position whose bench behaviour is categorically different: a second-choice
   * keeper does not come on. B-013 measured `P(any appearance)` as their worst term — 0.353
   * predicted against a 0.225 base rate, the largest positional gap in the model — because the
   * global sub curve pays a benched keeper a midfielder's chance of a cameo. Fitted on GKP rows
   * alone by the same logistic machinery; the per-position n is printed beside the fit, so a number
   * from ~3,400 keeper rows is not read with the confidence of one from 29,000.
   */
  gkp?: {
    startIntercept: number;
    startSlope: number;
    subIntercept: number;
    subSlope: number;
    /** rows behind the fit, printed so thin samples read as thin */
    n: { start: number; sub: number };
  };
  /**
   * Fitted availability (plan 024, B-015) — absent in params fitted before the Wayback archive of
   * deadline-time flags existed.
   *
   * When present, the minutes model changes REGIME: deterministic statuses (`u`/`n`/`s`, effective
   * 0%) zero the distribution by rule; the uncertain band enters the start/sub logistics as
   * `inj = 1 − effective chance` terms fitted jointly with the base curves; and a row whose flags
   * are unknown gets its own fitted offset rather than a default of fit. The hand-drawn
   * `availabilityMultiplier()` is not applied in this regime.
   *
   * The coefficients are GLOBAL across positions (the flagged sample cannot support per-position
   * curves); the keeper block above keeps its own base curves and shares these terms.
   */
  availability?: {
    /** added to the start logit per unit of `inj` */
    startInj: number;
    /** interaction: `inj × logit(laggedStartRate)` — an injured regular's history overstates him */
    startInjX: number;
    /** offset applied when the row's flags are unknown (a Wayback gap), instead of a default */
    startUnknown: number;
    subInj: number;
    subUnknown: number;
    /** P(60+ | started, flagged) and E[minutes | started, flagged] — measured group constants */
    sixtyGivenStartFlagged: number;
    minutesGivenStartFlagged: number;
    /** rows behind each term, printed so thin samples read as thin */
    n: {
      startFlagged: number;
      subFlagged: number;
      unknown: number;
      flaggedStarts: number;
    };
  };
}

export interface SavesParams {
  /**
   * How expected saves scale with fixture pressure (B-021): `(λ_against / 1.4)^elasticity`, still
   * clamped to the old [0.3, 2.5] band. 1 reproduces the hand-drawn linear ratio this replaces;
   * 0 says the opponent does not matter. Grid-searched on the validation split beside the other
   * shape parameters — the pressure ratio was the one term in the save model nobody had ever fitted.
   */
  elasticity: number;
}

export interface AttackParams {
  /** how much of a fixture's goal-rate advantage carries into an individual's xG — 1 = fully */
  xgFixtureElasticity: number;
  xaFixtureElasticity: number;
  /** finishing conversion: realised goals per unit of xG, ~1 if xG is unbiased */
  goalsPerXg: number;
  assistsPerXa: number;
}

export interface DefconParams {
  /** overdispersion of the qualifying-action count relative to Poisson; 1 is pure Poisson */
  dispersion: number;
  /** how a player's per-90 rate scales with minutes actually played */
  ratePer90ToMatch: number;
}

export interface BonusParams {
  /**
   * The Plackett–Luce temperature for rank-based bonus (B-041, plan 028 task 4), in BPS.
   *
   * Absent is the incumbent — the clipped linear term below, which hands out about 8.5 bonus points
   * in a fixture that has 6 to give. Present, the three awards are drawn in proportion to
   * `P(play) × exp(E[BPS | played] / τ)` and a fixture pays exactly 6 by construction. Large τ
   * flattens the field toward a lottery; small τ hands the bonus to the highest projected BPS with
   * near-certainty. Chosen on validation, never assumed.
   */
  tau?: number;
  /** expected bonus points per BPS above the match's typical bonus line */
  bonusPerBps: number;
  bpsIntercept: number;
  /** cap, since only three players in a match receive bonus at all */
  maxBonus: number;
}

/**
 * How a player's own history is turned into a rate (B-041, plan 028 task 1).
 *
 * **Optional, and its absence is the incumbent.** Without this block `features.ts` pools a whole
 * career at equal weight and shrinks it toward the positional mean at a hand-written 270 minutes —
 * which is what every number in this repository was produced under. Both defaults are reproduced
 * exactly by `halfLifeRounds: Infinity, shrinkMinutes: 270`, and a test asserts it.
 *
 * The asymmetry this exists to close: team strength has had a fitted recency half-life since B-014,
 * and the substitute-appearance rate has been season-first since B-019, while `xg90`, `xa90`,
 * `bps90` and `saves90` count a player's football from three seasons ago exactly as heavily as last
 * week's. Nothing measured that; D-035 measured a decay on the TRAINING CORPUS, which is a different
 * lever — how much an old season counts when fitting global parameters, not how much an old match
 * counts toward the player it was played by.
 */
export interface RateParams {
  /**
   * Half-life in ROUNDS for a player's own rate evidence; `Infinity` is the flat career mean.
   *
   * Rounds ELAPSED, not matches played, and the difference is a choice rather than an oversight: a
   * player who misses eight weeks injured comes back with evidence eight rounds old under this
   * bookkeeping, and with evidence as fresh as the day he was hurt under the alternative. Staleness
   * is what a rate is at risk of; sample size is what the shrinkage already handles. The alternative
   * — decay per match played — is recorded here rather than tried, so a later session can weigh it
   * without re-deriving the distinction.
   *
   * The summer between seasons costs exactly one round of decay under this scheme, which understates
   * it. Charging the break explicitly is a second knob and was not added.
   */
  halfLifeRounds: number;
  /**
   * Minutes of a player's own record before it outweighs the positional prior — a pseudo-count.
   *
   * 270 (three matches) was written by hand and never fitted. Under decay this is a weight rather
   * than a count of minutes, so it is denominated in the same decayed units as the numerator.
   */
  shrinkMinutes: number;
}

/**
 * The market blend (B-043, plan 029 task 3).
 *
 * `epNextWeight` is the share of the served number that comes from FPL's own `ep_next`, the rest
 * from this model — with `ep_next` first rescaled to the model's mean level over the round, so the
 * blend changes the ORDERING and not the level (the horizon tail has no `ep_next` and must not be
 * tilted against the near round). Absent, the model is exactly what it was.
 *
 * This is not the thing `fpl-optimizer` forbids. The rule there is that `ep_next` is never a
 * TARGET and never the TRUTH; here it is one input among others to a forecast that is then scored
 * on realised points, and its weight was chosen per fold on the season before, with 0 in the grid.
 */
export interface CrowdParams {
  epNextWeight: number;
}

export interface FittedParams {
  strength: StrengthParams;
  minutes: MinutesParams;
  /** absent in every params set before plan 029; absent means no market blend */
  crowd?: CrowdParams;
  /** absent in every params set fitted before B-041; absent means the flat career mean */
  rates?: RateParams;
  saves: SavesParams;
  attack: AttackParams;
  defcon: DefconParams;
  bonus: BonusParams;
  provenance: {
    fittedOn: string[];
    rows: number;
    date: string;
    objective: string;
    heldOut: string;
    notes: string[];
  };
}

/**
 * The starting point: v1's guesses, restated in the v2 shape.
 *
 * This is not a fit and does not pretend to be. It exists so the harness has something to score before
 * anything is fitted — the baseline the fitted parameters have to beat, on the same held-out rows. A
 * v2 that cannot beat these is a v2 that changed the code and nothing else.
 */
export const UNFITTED_PARAMS: FittedParams = {
  strength: {
    homeAdvantage: 1.15,
    confidenceMatches: 4,
    leagueGoalsPerTeamMatch: 1.4,
    goalsWeight: 0,
    decayHalfLife: 0,
  },
  minutes: {
    startIntercept: 0,
    startSlope: 1,
    subAppearanceRate: 0.35,
    // slope 0 => the curve is flat at the constant, which is exactly what v1 did.
    subIntercept: Math.log(0.35 / 0.65),
    subSlope: 0,
    sixtyGivenStart: 0.85,
    sixtyGivenSub: 0.05,
    minutesGivenStart: 85,
    minutesGivenSub: 25,
  },
  saves: { elasticity: 1 },
  attack: {
    xgFixtureElasticity: 1,
    xaFixtureElasticity: 1,
    goalsPerXg: 1,
    assistsPerXa: 1,
  },
  defcon: { dispersion: 1, ratePer90ToMatch: 1 },
  bonus: { bonusPerBps: 0, bpsIntercept: 0, maxBonus: 3 },
  provenance: {
    fittedOn: [],
    rows: 0,
    date: '—',
    objective: 'none — these are v1 guesses restated, not a fit',
    heldOut: '—',
    notes: [
      'The baseline the fitted parameters must beat on held-out rows.',
      'subAppearanceRate 0.35, minutes 85/25 and the 1.15 home advantage are v1 values.',
    ],
  },
};

/**
 * The v3 incumbent as it served from 2026-08-27 to 2026-09-02 — fitted on 2023-24 + 2024-25 with
 * 2025-26 held out. Superseded by `FITTED_PARAMS` below (D-037) and KEPT, projected weekly under its
 * own version, because "never delete the serving model version until its successor has beaten it"
 * needs the predecessor to still be producing rows (D-020).
 *
 * **What changed from the guesses, and what it means:**
 *
 * | knob | v1 guess | fitted | what the data said |
 * |---|---|---|---|
 * | `subAppearanceRate` | 0.35 | 0.154 | a benched player appears less than half as often as assumed |
 * | `sixtyGivenStart` | 0.85 | 0.934 | a starter sees the hour more often than assumed |
 * | `sixtyGivenSub` | 0.05 | 0.013 | a substitute almost never does |
 * | `minutesGivenSub` | 25 | 18.2 | substitutes get less than assumed |
 * | `startSlope` | 1 (identity) | 0.485 | **the opposite of the expected direction** |
 * | `homeAdvantage` | 1.15 | 1.119 | close to the guess |
 * | `assistsPerXa` | 1 | 1.395 | assists land well above expected assists |
 * | `defcon.dispersion` | 1 (Poisson) | 1.5 | defensive actions cluster, as suspected |
 * | `xgFixtureElasticity` | 1 | **0** | see below |
 * | `subSlope` | — (a flat 0.154) | **1.384** | the sub term is a curve now, see below |
 *
 * Three results worth reading before trusting anything built on this:
 *
 * - **`startSlope` 0.485, not 1.** v1 used a player's lagged start rate directly as P(start). The
 *   fitted curve is much flatter: a player who started every recent match is *not* a certainty, and
 *   one who started none is not hopeless. The first attempt at this fit returned a slope of 7.3e8 —
 *   complete separation running away to a step function — which is why the fit now carries a ridge
 *   penalty and a sanity bound.
 * - **The substitute-appearance term is a curve now, and it was the model's worst shape.** B-013
 *   scored every term on its own and `P(any appearance)` carried a Brier reliability of 0.0121
 *   against a mean of 0.0012 for every other binary: one global `subAppearanceRate` paid a
 *   never-used fringe player and a first substitute the same 15.4%. `subSlope` **1.384** is steeper
 *   than 1, the opposite direction to `startSlope` — the lagged sub rate is heavily smoothed toward
 *   the population prior before the model sees it, so the fit un-shrinks it.
 * - **The fixture elasticities are non-zero now, and the reason they were zero was the input.**
 *   B-007 fitted both to 0 with `confidenceMatches` at the top of its grid, and read it as "the
 *   fixture signal does not survive single-gameweek variance". B-014 rebuilt team strength off
 *   decay-weighted ACTUAL goals blended half-and-half with the old expected-goals sum, and every one
 *   of those numbers moved: `goalsWeight` 0.5 on an interior optimum, `decayHalfLife` 6 rounds,
 *   `confidenceMatches` **64 rather than the grid edge** — the shrinkage stops running away, because
 *   there is now something worth not shrinking. On top of that, `xaFixtureElasticity` fits to
 *   **2.5** and `xgFixtureElasticity` to **0.25**.
 *
 *   State the asymmetry honestly: the assist elasticity is a clear win (1.9470 at 0 against 1.9453
 *   at 2.5), and the goal elasticity is barely identified — 0, 0.25 and 0.5 all score 1.9459-1.9461,
 *   and only the far end of the grid is clearly worse. An elasticity fitted on top of an
 *   uninformative strength estimate fits to zero whatever the truth is, which is what happened
 *   before; that does not make every non-zero number that follows a strong one.
 */
export const V3_INCUMBENT_PARAMS: FittedParams = {
  strength: {
    homeAdvantage: 1.118640838000319,
    confidenceMatches: 64,
    leagueGoalsPerTeamMatch: 1.5486291739894331,
    goalsWeight: 0.5,
    decayHalfLife: 6,
  },
  minutes: {
    startIntercept: -0.187900700795416,
    startSlope: 0.4849268629262445,
    subAppearanceRate: 0.15435726210350584,
    subIntercept: 0.574677247015025,
    subSlope: 1.384130123390548,
    sixtyGivenStart: 0.9339351334078926,
    sixtyGivenSub: 0.013411204845338524,
    minutesGivenStart: 82.83320019172392,
    minutesGivenSub: 18.151633138654553,
    gkp: {
      startIntercept: -0.26501428563368706,
      startSlope: 0.5598803671683812,
      subIntercept: -1.0818460458418615,
      subSlope: 1.4470795639568321,
      n: {
        start: 4627,
        sub: 3514,
      },
    },
  },
  saves: {
    elasticity: 0.5,
  },
  attack: {
    xgFixtureElasticity: 0.75,
    xaFixtureElasticity: 2,
    goalsPerXg: 0.9890259541292117,
    assistsPerXa: 1.3951956123013414,
  },
  defcon: {
    dispersion: 1.5,
    ratePer90ToMatch: 1,
  },
  bonus: {
    bonusPerBps: 0.04173248388494878,
    bpsIntercept: -0.2839231900427406,
    maxBonus: 3,
  },
  provenance: {
    fittedOn: ['2023-24', '2024-25'],
    rows: 56133,
    date: '2026-08-27-gkp',
    objective:
      'frequencies measured directly; shape parameters by MAE on held-out 2024-25 rounds 20+',
    heldOut: '2025-26 (whole season), live 2026/27 (untouched)',
    notes: [
      'defensive contribution is fitted on 2025-26 rounds 1-19 \u2014 the category exists in no earlier season, so that term alone is not held out',
      'the availability multiplier is NOT fitted: the archive carries no per-gameweek status or chance_of_playing (B-007 Phase 2 must accumulate first)',
      'B-021: keeper minutes curves fitted on GKP rows alone (n start 4627, sub 3514) and saves elasticity 0.5 - an interior optimum on keeper validation rows; every global parameter reproduced the incumbent byte-for-byte',
    ],
  },
};

/**
 * The served parameters — v5 (D-037, plan 029), regenerated by `pnpm fit:model -- --train
 * 2024-25,2025-26` and pasted here so the fit is reviewable in a diff.
 *
 * Three things differ from `V3_INCUMBENT_PARAMS` above, and each has a number behind it:
 *
 * - **the corpus is the two most recent seasons.** D-035 chose a two-season window on both folds of
 *   the referee, and the incumbent's window ended at 2024-25 — one season stale, with a
 *   defensive-contribution term fitted on 2025-26 rounds 1-12 where a whole season now exists;
 * - **the plan 028 shape is on** — `rates` and `minutes.perPlayerStart` — measured at +1.0% ± 0.7%
 *   captured@11 against the incumbent across two folds (D-036), and running as a candidate since;
 * - **the base minutes curves are conditional on "not ruled out"**: `startIntercept` +0.203 against
 *   −0.188, because rows a rule already decides (u/n/s, 0%) are excluded from the regression and
 *   zeroed by the hand rule at prediction — the incumbent counted them as non-starts and then zeroed
 *   them again.
 *
 * What was measured the same day and NOT taken is listed in `provenance.notes`. Two folds is a
 * direction; `pnpm score:gameweek` on 2026-27 is what settles this against the v3 rows that keep
 * landing beside it.
 */
export const FITTED_PARAMS: FittedParams = {
    strength: {
      homeAdvantage: 1.0762446941515706,
      confidenceMatches: 96,
      leagueGoalsPerTeamMatch: 1.429061403508753,
      goalsWeight: 0.5,
      decayHalfLife: 0,
    },
    minutes: {
      startIntercept: 0.20330093126883272,
      startSlope: 0.47611011463184616,
      subAppearanceRate: 0.16626322705581298,
      subIntercept: 1.0354019364714864,
      subSlope: 1.3097664584438815,
      sixtyGivenStart: 0.9301435406698565,
      sixtyGivenSub: 0.013519134775374376,
      minutesGivenStart: 82.49322169059012,
      minutesGivenSub: 18.35440931780366,
      gkp: {
        startIntercept: -0.08904769778234282,
        startSlope: 0.5916154676230905,
        subIntercept: -1.2831304177023968,
        subSlope: 1.478501950293856,
        n: {
          start: 3694,
          sub: 2581,
        },
      },
      perPlayerStart: true,
    },
    saves: {
      elasticity: 0.75,
    },
    attack: {
      xgFixtureElasticity: 1,
      xaFixtureElasticity: 1.25,
      goalsPerXg: 0.9729119223144091,
      assistsPerXa: 1.4036851568996382,
    },
    defcon: {
      dispersion: 1.5,
      ratePer90ToMatch: 1,
    },
    bonus: {
      bonusPerBps: 0.040344104766678074,
      bpsIntercept: -0.2500904838179279,
      maxBonus: 3,
    },
    rates: {
      halfLifeRounds: 19,
      shrinkMinutes: 270,
    },
    provenance: {
      fittedOn: ['2024-25', '2025-26'],
      rows: 41458,
      date: '2026-09-02',
      objective: 'frequencies measured directly; shape parameters by RMSE on held-out 2025-26 rounds 20+; base minutes curves conditional on not-ruled-out (u/n/s and effective-0% rows excluded, zeroed by the hand rule at prediction)',
      heldOut: 'nothing archived — the live 2026-27 season, scored weekly by pnpm score:gameweek',
      notes: ['D-037 (plan 029): the two most recent seasons, the window D-035 chose on both folds; the served fit had stopped at 2024-25 and its defensive-contribution term rested on half a season', 'the plan 028 shape is ON: rate half-life 19 rounds at shrink 270 (pre-committed in D-036), and per-player E[minutes | started] / P(60+ | started) (+0.7% to +1.0% captured@11 across folds)', 'strength.decayHalfLife 0 and confidenceMatches 96 both sit at a grid edge under RMSE; the ordering-chosen confidence disagreed between folds (16, 96), so the RMSE choice stands and the fixture term is muted as it was', 'NOT adopted, measured on the referee the same day: an ep_next blend (-0.3% +/- 0.3%), a season-start strength prior (-0.6% to -0.9%), a shrunk season start rate (-0.8% on the one fold that chose it)', 'the availability multiplier is NOT fitted: the hand rule stands (D-032, D-035)'],
    },
  };

/**
 * The availability candidate (plan 024, B-015) — the full minutes refit with deadline-time flags as
 * a fitted input, from the Wayback archive of `bootstrap-static` captures.
 *
 * NOT the serving model. Serving stays pinned to `FITTED_PARAMS`; these ride `pnpm project` under
 * their own version (`v3-avail-…`), scored weekly beside the incumbent by `pnpm score:gameweek`,
 * and adoption is a D-numbered call against the pre-committed bar in plan 024.
 *
 * What moved and why it should have:
 *
 * - `startIntercept` −0.188 → +0.283: the base curves are now fitted EXCLUDING rows a rule already
 *   decides (u/n/s, effective 0%), so they answer "P(start | not ruled out)" — a higher intercept is
 *   the population changing, not a contradiction.
 * - `availability.startInj` −2.70 with interaction −0.34: a 75% doubt costs ~0.68 start-logit, and
 *   costs a nailed starter more than a fringe one.
 * - `availability.startUnknown` −0.39 on 2,026 unknown rows (the Wayback-dark 2024-25 GW8–10): the
 *   unknown population really does start less, which is exactly why unknown must never default to fit.
 * - `sixtyGivenStartFlagged` 0.925 vs 0.934 global (n=332): a flagged player who starts anyway is
 *   nearly a normal starter — the doubt is about whether he plays, not how long.
 */
/**
 * The plan 028 shape candidate (B-041, D-036) — the incumbent's fitted numbers, with the two model
 * shapes that measured positive switched on.
 *
 * **Why this exists at all.** D-036 says the live season is what settles a two-fold direction. A
 * candidate that is not projected weekly cannot be settled by anything: "the prospective record will
 * judge it" is a check that cannot fail unless something is actually running. This is that something,
 * riding `pnpm project` beside the incumbent and the availability candidate, scored by
 * `pnpm score:gameweek` under its own version. Serving stays pinned to the incumbent.
 *
 * **What is on, and what is deliberately off.**
 *
 * - `rates` — a 19-round half-life at the incumbent's 270-minute shrinkage. The two folds disagreed
 *   (2024-25 chose the flat career mean at 540, 2025-26 chose this), so the choice is PRE-COMMITTED
 *   here with its reason: 2025-26 is the fold adjacent to the season that will referee it, and there
 *   is no season-before-this-one to select on at serve time. Recorded so the next session reads a
 *   decision rather than a leftover.
 * - `minutes.perPlayerStart` — on. +0.7% ± 0.3% across folds, the one reading that cleared twice the
 *   between-fold error, and it improves `P(60+)` on its own reliability curve.
 * - `bonus.tau` — **off**. The rank model is right by construction and measured −0.19% ± 0.19%; it is
 *   not in the candidate. It also cannot be served without wiring the fixture pre-pass into
 *   `forecast.service` and the `v3ep` export, which is the second reason not to put it here.
 */
export const SHAPE_CANDIDATE_PARAMS: FittedParams = {
  ...V3_INCUMBENT_PARAMS,
  rates: { halfLifeRounds: 19, shrinkMinutes: 270 },
  minutes: { ...V3_INCUMBENT_PARAMS.minutes, perPlayerStart: true },
  provenance: {
    ...V3_INCUMBENT_PARAMS.provenance,
    notes: [
      ...V3_INCUMBENT_PARAMS.provenance.notes,
      'plan 028 shape candidate (D-036): rate half-life 19 rounds at shrink 270, and per-player ' +
        'E[minutes | started] / P(60+ | started). The bonus rank model is NOT included — it ' +
        'measured -0.19% +/- 0.19% and is not served anywhere.',
    ],
  },
};

export const AVAILABILITY_CANDIDATE_PARAMS: FittedParams = {
  strength: {
    homeAdvantage: 1.1186408380003192,
    confidenceMatches: 64,
    leagueGoalsPerTeamMatch: 1.5486291739894333,
    goalsWeight: 0.5,
    decayHalfLife: 6,
  },
  minutes: {
    startIntercept: 0.28333945570574204,
    startSlope: 0.4759093585027032,
    subAppearanceRate: 0.15435726210350584,
    subIntercept: 0.9838312990192988,
    subSlope: 1.2696915951918024,
    sixtyGivenStart: 0.9339351334078926,
    sixtyGivenSub: 0.013411204845338524,
    minutesGivenStart: 82.83320019172392,
    minutesGivenSub: 18.151633138654553,
    gkp: {
      startIntercept: -0.039863485257263825,
      startSlope: 0.5656804586773112,
      subIntercept: -1.1918864772747522,
      subSlope: 1.311291115267632,
      n: {
        start: 3711,
        sub: 2599,
      },
    },
    availability: {
      startInj: -2.699156183864384,
      startInjX: -0.33553083469134565,
      startUnknown: -0.3896037181756922,
      subInj: -1.291664062643681,
      subUnknown: -0.46557321183438605,
      sixtyGivenStartFlagged: 0.9246987951807228,
      minutesGivenStartFlagged: 82.36144578313252,
      n: {
        startFlagged: 1762,
        subFlagged: 1430,
        unknown: 2026,
        flaggedStarts: 332,
      },
    },
  },
  saves: {
    elasticity: 0.75,
  },
  attack: {
    xgFixtureElasticity: 0.5,
    xaFixtureElasticity: 2,
    goalsPerXg: 0.9890259541292121,
    assistsPerXa: 1.3951956123013414,
  },
  defcon: {
    dispersion: 1.5,
    ratePer90ToMatch: 1.1,
  },
  bonus: {
    bonusPerBps: 0.04173248388494878,
    bpsIntercept: -0.2839231900427406,
    maxBonus: 3,
  },
  provenance: {
    fittedOn: ['2023-24', '2024-25'],
    rows: 56133,
    date: '2026-08-27-avail',
    objective:
      'frequencies measured directly; minutes curves refit jointly with availability terms (fitLogisticK); shape parameters by RMSE on held-out 2024-25 rounds 20+',
    heldOut: '2025-26 (whole season), live 2026/27 (untouched)',
    notes: [
      'defensive contribution is fitted on 2025-26 rounds 1-19 — the category exists in no earlier season, so that term alone is not held out',
      'availability IS fitted here (plan 024): deadline-time flags from Wayback captures of bootstrap-static, joined within a 72h staleness bound; 2024-25 GW8-10 have no capture in bound and trained as unknown',
      'base minutes curves are conditional on not-ruled-out — u/n/s and effective-0% rows are excluded from the fit and zeroed by rule at prediction',
      "NOT SERVED: candidate rows ride pnpm project under v3-avail; the adoption call is plan 024's bar, one TEST reading",
    ],
  },
};
