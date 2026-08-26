# Calibration — unfitted

Test season: **2025-26**, held out of the fit.
Trained on 2023-24 + 2024-25 (2024-25 rounds 20+ reserved for choosing shape parameters). Live 2026/27 is not touched here at all.

**The defensive-contribution parameters are the one exception to the holdout.** That category exists only in 2025-26, so its dispersion was fitted on rounds 1–12 of this very season and its rate parameter chosen on rounds 13–19. Those rows are passed to the fit separately and **no other parameter reads them**. Rounds 20–38 are untouched by the fit entirely. The defcon term's contribution to the headline below is therefore not held out; everything else is.

## Headline

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 29482 | 1.232 | 2.073 | 0.158 | 1.316 | 1.158 |
| baseline: form (trailing 4 rounds) | 28905 | 1.042 | 2.131 | 0.012 | 1.166 | 1.153 |
| baseline: last season points/90 | 11965 | 3.152 | 3.665 | 1.939 | 3.905 | 1.966 |

**Does NOT beat both baselines on MAE.** Recorded as it stands; the model version is not bumped on a negative result (B-007, maintainer decision 2026-08-26).

### Baseline availability

`ep_next` is **not** among the baselines here and cannot be: the archive's `xP` is FPL's `ep_this` scraped after each gameweek and is post-match contaminated, so it is not stored. `ep_next` is scored only against live gameweeks with a captured deadline snapshot (B-007 Phase 2).

## By position

| Position | n | MAE | RMSE | bias |
|---|---:|---:|---:|---:|
| DEF | 9653 | 1.494 | 2.268 | 0.456 |
| FWD | 3240 | 1.153 | 2.252 | -0.310 |
| GKP | 3396 | 0.984 | 1.561 | 0.471 |
| MID | 13193 | 1.124 | 1.992 | -0.026 |

## By price band

The known defect is head-specific — the premium head read 2–4× `ep_next` (archive B-004, finding 1) — so a single mean would hide exactly the thing this exists to measure.

| Band | n | MAE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|
| ≤ £5.0m | 20496 | 1.014 | 0.335 | 1.097 | 0.761 |
| £5.1–7.0m | 7717 | 1.625 | -0.134 | 1.750 | 1.884 |
| £7.1–9.0m | 1045 | 2.243 | -0.903 | 2.118 | 3.020 |
| £9.1–11.0m | 148 | 2.668 | -0.827 | 2.355 | 3.182 |
| > £11.0m | 76 | 3.473 | -1.545 | 3.218 | 4.763 |

## Calibration

Error says how far off a prediction is; calibration says whether the model means what it says. A model can carry a respectable MAE and still be systematically high everywhere, which for a squad optimiser is worse than noise — every comparison it makes is skewed the same way.

| Predicted band | n | mean predicted | mean actual |
|---|---:|---:|---:|
| 0–1 | 17027 | 0.476 | 0.250 |
| 1–2 | 5213 | 1.482 | 1.699 |
| 2–3 | 3776 | 2.470 | 2.643 |
| 3–4 | 2055 | 3.444 | 2.973 |
| 4–5 | 1104 | 4.442 | 3.386 |
| 5–6 | 289 | 5.304 | 3.900 |
| 6–8 | 18 | 6.112 | 3.389 |

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
    "homeAdvantage": 1.15,
    "confidenceMatches": 4,
    "leagueGoalsPerTeamMatch": 1.4
  },
  "minutes": {
    "startIntercept": 0,
    "startSlope": 1,
    "subAppearanceRate": 0.35,
    "sixtyGivenStart": 0.85,
    "sixtyGivenSub": 0.05,
    "minutesGivenStart": 85,
    "minutesGivenSub": 25
  },
  "attack": {
    "xgFixtureElasticity": 1,
    "xaFixtureElasticity": 1,
    "goalsPerXg": 1,
    "assistsPerXa": 1
  },
  "defcon": {
    "dispersion": 1,
    "ratePer90ToMatch": 1
  },
  "bonus": {
    "bonusPerBps": 0,
    "bpsIntercept": 0,
    "maxBonus": 3
  },
  "provenance": {
    "fittedOn": [],
    "rows": 0,
    "date": "—",
    "objective": "none — these are v1 guesses restated, not a fit",
    "heldOut": "—",
    "notes": [
      "The baseline the fitted parameters must beat on held-out rows.",
      "subAppearanceRate 0.35, minutes 85/25 and the 1.15 home advantage are v1 values."
    ]
  }
}
```

Corpus: 86755 archive player-gameweeks. Nothing was written to `projections` — asserted, not assumed.
