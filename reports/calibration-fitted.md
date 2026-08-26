# Calibration — fitted

Test season: **2025-26**, held out of the fit.
Trained on 2023-24 + 2024-25 (2024-25 rounds 20+ reserved for choosing shape parameters). Live 2026/27 is not touched here at all.

**The defensive-contribution term is the exception.** That category exists only in 2025-26, so it was fitted on rounds 1–19 of this very season. Its contribution to the headline below is therefore not held out, and no reading of this report should treat it as though it were.

## Headline

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 29482 | 1.130 | 2.027 | -0.019 | 1.139 | 1.158 |
| baseline: form (trailing 4 rounds) | 28905 | 1.042 | 2.131 | 0.012 | 1.166 | 1.153 |
| baseline: last season points/90 | 11965 | 3.152 | 3.665 | 1.939 | 3.905 | 1.966 |

**Does NOT beat both baselines on MAE.** Recorded as it stands; the model version is not bumped on a negative result (B-007, maintainer decision 2026-08-26).

### Baseline availability

`ep_next` is **not** among the baselines here and cannot be: the archive's `xP` is FPL's `ep_this` scraped after each gameweek and is post-match contaminated, so it is not stored. `ep_next` is scored only against live gameweeks with a captured deadline snapshot (B-007 Phase 2).

## By position

| Position | n | MAE | RMSE | bias |
|---|---:|---:|---:|---:|
| DEF | 9653 | 1.284 | 2.198 | -0.029 |
| FWD | 3240 | 1.166 | 2.168 | -0.118 |
| GKP | 3396 | 0.782 | 1.480 | 0.128 |
| MID | 13193 | 1.098 | 1.983 | -0.026 |

## By price band

The known defect is head-specific — the premium head read 2–4× `ep_next` (archive B-004, finding 1) — so a single mean would hide exactly the thing this exists to measure.

| Band | n | MAE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|
| ≤ £5.0m | 20496 | 0.870 | 0.084 | 0.845 | 0.761 |
| £5.1–7.0m | 7717 | 1.601 | -0.218 | 1.666 | 1.884 |
| £7.1–9.0m | 1045 | 2.349 | -0.515 | 2.505 | 3.020 |
| £9.1–11.0m | 148 | 2.738 | -0.460 | 2.723 | 3.182 |
| > £11.0m | 76 | 3.753 | 0.033 | 4.796 | 4.763 |

## Calibration

Error says how far off a prediction is; calibration says whether the model means what it says. A model can carry a respectable MAE and still be systematically high everywhere, which for a squad optimiser is worse than noise — every comparison it makes is skewed the same way.

| Predicted band | n | mean predicted | mean actual |
|---|---:|---:|---:|
| 0–1 | 16158 | 0.352 | 0.192 |
| 1–2 | 7515 | 1.473 | 1.678 |
| 2–3 | 3439 | 2.414 | 2.886 |
| 3–4 | 1983 | 3.411 | 3.499 |
| 4–5 | 319 | 4.301 | 3.724 |
| 5–6 | 56 | 5.439 | 5.661 |
| 6–8 | 12 | 6.374 | 4.000 |

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
    "homeAdvantage": 1.1233471839072462,
    "confidenceMatches": 96,
    "leagueGoalsPerTeamMatch": 1.5127213352684714
  },
  "minutes": {
    "startIntercept": -0.2022931365788607,
    "startSlope": 0.46737973110430747,
    "subAppearanceRate": 0.15655447298494243,
    "sixtyGivenStart": 0.932378941812904,
    "sixtyGivenSub": 0.014674681753889675,
    "minutesGivenStart": 82.68637023354005,
    "minutesGivenSub": 18.337871287128714
  },
  "attack": {
    "xgFixtureElasticity": 0,
    "xaFixtureElasticity": 0,
    "goalsPerXg": 0.9877526348865678,
    "assistsPerXa": 1.4152728373573016
  },
  "defcon": {
    "dispersion": 1.5,
    "ratePer90ToMatch": 0.9
  },
  "bonus": {
    "bonusPerBps": 0.04146475197005556,
    "bpsIntercept": -0.2790571016939038,
    "maxBonus": 3
  },
  "provenance": {
    "fittedOn": [
      "2023-24",
      "2024-25"
    ],
    "rows": 51286,
    "date": "2026-08-26",
    "objective": "frequencies measured directly; shape parameters by RMSE on held-out 2024-25 rounds 20+ (14,540 rows). RMSE deliberately, not MAE: MAE is minimised by the conditional median and this corpus is mostly near-zero rows, so an MAE search shrank every parameter toward predicting nobody scores.",
    "heldOut": "2025-26 (whole season, 29,747 rows), live 2026/27 (untouched)",
    "notes": [
      "The defensive-contribution term is NOT held out across seasons — the category exists only in 2025-26. It is fitted on rounds 1-12 of that season and its shape parameter chosen on rounds 13-19, leaving 20-38 unused by it.",
      "The availability multiplier is NOT fitted: the archive carries no per-gameweek status or chance_of_playing. It waits on player_deadline_snapshot (B-007 Phase 2) accumulating live gameweeks.",
      "strength.confidenceMatches reached the top of its search grid — the optimum is at or beyond 96, meaning held-out RMSE keeps improving as team strength is shrunk toward the league average.",
      "Both fixture elasticities fitted to 0 on single-gameweek RMSE. Team strength still drives clean sheets and goals conceded through lambda-against."
    ]
  }
}
```

Corpus: 86755 archive player-gameweeks. Nothing was written to `projections` — asserted, not assumed.
