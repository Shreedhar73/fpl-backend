# Calibration — unfitted

Test season: **2025-26**, held out of the fit.
Trained on 2023-24 + 2024-25 (2024-25 rounds 20+ reserved for choosing shape parameters). Live 2026/27 is not touched here at all.

**The defensive-contribution parameters are the one exception to the holdout.** That category exists only in 2025-26, so its dispersion was fitted on rounds 1–12 of this very season and its rate parameter chosen on rounds 13–19. Those rows are passed to the fit separately and **no other parameter reads them**. Rounds 20–38 are untouched by the fit entirely. The defcon term's contribution to the headline below is therefore not held out; everything else is.

## Headline

**Each comparison runs on the rows both of its predictors could score.** That restriction is B-012's, and it changes the answer: a baseline scored over a different population is not a comparison. `form` produces no number for a player with no trailing round — a season debut, a return from a long injury, a new signing — and those are the hardest rows in the corpus, so leaving them on one side of the comparison only made part of the gap bookkeeping.

**Pairwise rather than one three-way intersection**, because `priorSeason` needs 450 minutes last season and intersecting all three at once would answer "does this model beat `form`" on a population chosen by a third predictor the question does not involve.

### Against `form` — trailing 4 rounds

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 28905 | 1.228 | 2.070 | 0.161 | 1.314 | 1.153 |
| baseline: form | 28905 | 1.042 | 2.131 | 0.012 | 1.166 | 1.153 |

**Does not beat `form` on MAE** (it does on RMSE).

### Against last season's points per 90

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 11965 | 1.811 | 2.706 | 0.047 | 2.013 | 1.966 |
| baseline: last season points/90 | 11965 | 3.152 | 3.665 | 1.939 | 3.905 | 1.966 |

**Beats last season's points per 90 on MAE.**

### Against `form`, restricted to established players

The same two predictors on the rows that also carry a prior-season baseline — which is a filter for **450+ minutes last season**, so it is a filter for players who actually play. This is not a third baseline; it is the same `form` comparison on a different population, and the gap between this table and the one above is the most useful number in the report.

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 11648 | 1.806 | 2.703 | 0.052 | 2.013 | 1.961 |
| baseline: form | 11648 | 1.742 | 2.813 | 0.019 | 1.980 | 1.961 |

**Does not beat `form` here either**, which removes the "MAE is dominated by fringe players" explanation for the headline. That explanation is D-020's, and this is the test of it.

### The same three on every row each could reach

Not a comparison — three different populations. Kept because it is what was reported before B-012, so the effect of the restriction is visible rather than described.

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 29482 | 1.232 | 2.073 | 0.158 | 1.316 | 1.158 |
| baseline: form (trailing 4 rounds) | 28905 | 1.042 | 2.131 | 0.012 | 1.166 | 1.153 |
| baseline: last season points/90 | 11965 | 3.152 | 3.665 | 1.939 | 3.905 | 1.966 |

### The rows the restriction costs

The rows the `form` comparison had to leave out. A count invites the reader to assume they were unremarkable; they are not — they are the players nobody had a trailing number for.

**577 rows**, mean actual **1.383**, **55.5%** of them zero minutes.

| Split | n | mean actual |
|---|---:|---:|
| DEF | 190 | 1.579 |
| FWD | 57 | 1.439 |
| GKP | 66 | 1.015 |
| MID | 264 | 1.322 |
| ≤ £5.0m | 385 | 0.925 |
| £5.1–7.0m | 167 | 2.174 |
| £7.1–9.0m | 20 | 2.600 |
| £9.1–11.0m | 3 | 2.000 |
| > £11.0m | 2 | 10.500 |

**MAE over the whole field is not the verdict** (D-020, and B-012 replaces it). It is minimised by the conditional median, and most rows are players who barely feature, so a predictor that says near-zero for everyone wins it while telling a squad optimiser nothing. The decision metrics — ordering, XI and captain choice, a simulated season — live in `reports/decision-quality.md`. Whatever this file says, the model version is not bumped on a negative result there, and the serving version is not deleted until its successor beats it.

### Baseline availability

`ep_next` is **not** among the baselines here and cannot be: the archive's `xP` is FPL's `ep_this` scraped after each gameweek and is post-match contaminated, so it is not stored. `ep_next` is scored only against live gameweeks with a captured deadline snapshot (B-007 Phase 2).

## By position

| Position | n | MAE | RMSE | bias |
|---|---:|---:|---:|---:|
| DEF | 9463 | 1.490 | 2.262 | 0.469 |
| FWD | 3183 | 1.142 | 2.239 | -0.318 |
| GKP | 3330 | 0.979 | 1.548 | 0.479 |
| MID | 12929 | 1.121 | 1.995 | -0.029 |

## By price band

A single mean hides a directional error, which is the kind that matters most to an optimiser — every comparison it makes is skewed the same way. B-004's finding 1 said the premium head read 2–4× `ep_next`; **that was measured against FPL's own model rather than against realised points, and against realised points it is false** (D-020). The bands below are the record of what the error actually is.

| Band | n | MAE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|
| ≤ £5.0m | 20111 | 1.011 | 0.340 | 1.098 | 0.758 |
| £5.1–7.0m | 7550 | 1.619 | -0.131 | 1.746 | 1.877 |
| £7.1–9.0m | 1025 | 2.238 | -0.934 | 2.094 | 3.028 |
| £9.1–11.0m | 145 | 2.679 | -0.888 | 2.319 | 3.207 |
| > £11.0m | 74 | 3.416 | -1.435 | 3.173 | 4.608 |

## Calibration

Error says how far off a prediction is; calibration says whether the model means what it says. A model can carry a respectable MAE and still be systematically high everywhere, which for a squad optimiser is worse than noise — every comparison it makes is skewed the same way.

| Predicted band | n | mean predicted | mean actual |
|---|---:|---:|---:|
| 0–1 | 16761 | 0.475 | 0.248 |
| 1–2 | 5057 | 1.483 | 1.697 |
| 2–3 | 3656 | 2.469 | 2.649 |
| 3–4 | 2025 | 3.446 | 2.967 |
| 4–5 | 1101 | 4.443 | 3.391 |
| 5–6 | 287 | 5.303 | 3.889 |
| 6–8 | 18 | 6.112 | 3.389 |

## Rows not scored

| Reason | n |
|---|---:|
| no prior appearance for this player | 265 |

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
