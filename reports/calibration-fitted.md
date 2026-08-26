# Calibration — fitted

Test season: **2025-26**, held out of the fit.
Trained on 2023-24 + 2024-25 (2024-25 rounds 20+ reserved for choosing shape parameters). Live 2026/27 is not touched here at all.

**The defensive-contribution parameters are the one exception to the holdout.** That category exists only in 2025-26, so its dispersion was fitted on rounds 1–12 of this very season and its rate parameter chosen on rounds 13–19. Those rows are passed to the fit separately and **no other parameter reads them**. Rounds 20–38 are untouched by the fit entirely. The defcon term's contribution to the headline below is therefore not held out; everything else is.

## Headline

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 29482 | 1.124 | 2.026 | -0.025 | 1.133 | 1.158 |
| baseline: form (trailing 4 rounds) | 28905 | 1.042 | 2.131 | 0.012 | 1.166 | 1.153 |
| baseline: last season points/90 | 11965 | 3.152 | 3.665 | 1.939 | 3.905 | 1.966 |

**Does NOT beat both baselines on MAE.** Recorded as it stands; the model version is not bumped on a negative result (B-007, maintainer decision 2026-08-26).

### Baseline availability

`ep_next` is **not** among the baselines here and cannot be: the archive's `xP` is FPL's `ep_this` scraped after each gameweek and is post-match contaminated, so it is not stored. `ep_next` is scored only against live gameweeks with a captured deadline snapshot (B-007 Phase 2).

## By position

| Position | n | MAE | RMSE | bias |
|---|---:|---:|---:|---:|
| DEF | 9653 | 1.277 | 2.197 | -0.040 |
| FWD | 3240 | 1.162 | 2.166 | -0.120 |
| GKP | 3396 | 0.774 | 1.479 | 0.120 |
| MID | 13193 | 1.093 | 1.981 | -0.028 |

## By price band

The known defect is head-specific — the premium head read 2–4× `ep_next` (archive B-004, finding 1) — so a single mean would hide exactly the thing this exists to measure.

| Band | n | MAE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|
| ≤ £5.0m | 20496 | 0.861 | 0.074 | 0.835 | 0.761 |
| £5.1–7.0m | 7717 | 1.599 | -0.216 | 1.668 | 1.884 |
| £7.1–9.0m | 1045 | 2.352 | -0.497 | 2.523 | 3.020 |
| £9.1–11.0m | 148 | 2.737 | -0.444 | 2.739 | 3.182 |
| > £11.0m | 76 | 3.757 | 0.080 | 4.843 | 4.763 |

## Calibration

Error says how far off a prediction is; calibration says whether the model means what it says. A model can carry a respectable MAE and still be systematically high everywhere, which for a squad optimiser is worse than noise — every comparison it makes is skewed the same way.

| Predicted band | n | mean predicted | mean actual |
|---|---:|---:|---:|
| 0–1 | 16296 | 0.343 | 0.200 |
| 1–2 | 7315 | 1.474 | 1.680 |
| 2–3 | 3467 | 2.419 | 2.878 |
| 3–4 | 2013 | 3.412 | 3.506 |
| 4–5 | 322 | 4.314 | 3.683 |
| 5–6 | 57 | 5.465 | 5.579 |
| 6–8 | 12 | 6.410 | 4.000 |

## Rows not scored

| Reason | n |
|---|---:|
| no prior appearance for this player | 265 |
| no form baseline (fewer than one trailing round) | 577 |
| no prior-season baseline (under 450 minutes last season) | 17517 |

## Parameters used

```json
{
  "strength": {
    "homeAdvantage": 1.1186408380003194,
    "confidenceMatches": 96,
    "leagueGoalsPerTeamMatch": 1.5486291739894333
  },
  "minutes": {
    "startIntercept": -0.18790070079541765,
    "startSlope": 0.4849268629262438,
    "subAppearanceRate": 0.15435726210350584,
    "sixtyGivenStart": 0.9339351334078926,
    "sixtyGivenSub": 0.013411204845338524,
    "minutesGivenStart": 82.83320019172392,
    "minutesGivenSub": 18.151633138654553
  },
  "attack": {
    "xgFixtureElasticity": 0,
    "xaFixtureElasticity": 0,
    "goalsPerXg": 0.9890259541292118,
    "assistsPerXa": 1.3951956123013418
  },
  "defcon": {
    "dispersion": 1.5,
    "ratePer90ToMatch": 0.9
  },
  "bonus": {
    "bonusPerBps": 0.04173248388494878,
    "bpsIntercept": -0.2839231900427406,
    "maxBonus": 3
  },
  "provenance": {
    "fittedOn": [
      "2023-24",
      "2024-25"
    ],
    "rows": 42468,
    "date": "2026-08-26",
    "objective": "frequencies measured directly; shape parameters by RMSE on held-out 2024-25 rounds 20+ (14,540 rows). RMSE deliberately, not MAE: MAE is minimised by the conditional median and this corpus is mostly near-zero rows, so an MAE search shrank every parameter toward predicting nobody scores.",
    "heldOut": "2025-26 rounds 13-38 entirely; rounds 1-12 (8,818 rows) are read by the defensive-contribution parameters and by nothing else. Live 2026/27 untouched.",
    "notes": [
      "The defensive-contribution parameters are the ONE exception to the holdout: that category exists only in 2025-26, so dispersion is fitted on rounds 1-12 and ratePer90ToMatch chosen on 13-19. Those rows are passed separately and no other parameter reads them — an earlier version folded them into the training set, where the frequency measurements iterated them too, so a quarter of the test season silently informed the whole fit while this note claimed otherwise.",
      "The availability multiplier is NOT fitted: the archive carries no per-gameweek status or chance_of_playing. It waits on player_deadline_snapshot (B-007 Phase 2) accumulating live gameweeks.",
      "strength.confidenceMatches reached the top of its search grid — the optimum is at or beyond 96, meaning held-out RMSE keeps improving as team strength is shrunk toward the league average.",
      "Both fixture elasticities fitted to 0 on single-gameweek RMSE. Team strength still drives clean sheets and goals conceded through lambda-against."
    ]
  }
}
```

Corpus: 86755 archive player-gameweeks. Nothing was written to `projections` — asserted, not assumed.
