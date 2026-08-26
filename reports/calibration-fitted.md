# Calibration — fitted

Test season: **2025-26**, held out of the fit.
Trained on 2023-24 + 2024-25 (2024-25 rounds 20+ reserved for choosing shape parameters). Live 2026/27 is not touched here at all.

**The defensive-contribution parameters are the one exception to the holdout.** That category exists only in 2025-26, so its dispersion was fitted on rounds 1–12 of this very season and its rate parameter chosen on rounds 13–19. Those rows are passed to the fit separately and **no other parameter reads them**. Rounds 20–38 are untouched by the fit entirely. The defcon term's contribution to the headline below is therefore not held out; everything else is.

## Headline

**Each comparison runs on the rows both of its predictors could score.** That restriction is B-012's, and it changes the answer: a baseline scored over a different population is not a comparison. `form` produces no number for a player with no trailing round — a season debut, a return from a long injury, a new signing — and those are the hardest rows in the corpus, so leaving them on one side of the comparison only made part of the gap bookkeeping.

**Pairwise rather than one three-way intersection**, because `priorSeason` needs 450 minutes last season and intersecting all three at once would answer "does this model beat `form`" on a population chosen by a third predictor the question does not involve.

### Against `form` — trailing 4 rounds

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 28905 | 1.119 | 2.021 | -0.022 | 1.132 | 1.153 |
| baseline: form | 28905 | 1.042 | 2.131 | 0.012 | 1.166 | 1.153 |

**Does not beat `form` on MAE** (it does on RMSE).

### Against last season's points per 90

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 11965 | 1.705 | 2.651 | -0.203 | 1.763 | 1.966 |
| baseline: last season points/90 | 11965 | 3.152 | 3.665 | 1.939 | 3.905 | 1.966 |

**Beats last season's points per 90 on MAE.**

### Against `form`, restricted to established players

The same two predictors on the rows that also carry a prior-season baseline — which is a filter for **450+ minutes last season**, so it is a filter for players who actually play. This is not a third baseline; it is the same `form` comparison on a different population, and the gap between this table and the one above is the most useful number in the report.

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 11648 | 1.699 | 2.646 | -0.197 | 1.764 | 1.961 |
| baseline: form | 11648 | 1.742 | 2.813 | 0.019 | 1.980 | 1.961 |

**Beats `form` here**, on rows where it loses over the full field. The difference between the two populations is fringe players: rows where the outcome is usually zero, where a near-zero prediction is very hard to beat on MAE, and which a squad optimiser never chooses between. That is the case for reading MAE over the whole field as the wrong verdict (D-020) — measured rather than argued.

### The same three on every row each could reach

Not a comparison — three different populations. Kept because it is what was reported before B-012, so the effect of the restriction is visible rather than described.

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 29482 | 1.124 | 2.026 | -0.025 | 1.133 | 1.158 |
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
| DEF | 9463 | 1.270 | 2.189 | -0.032 |
| FWD | 3183 | 1.154 | 2.152 | -0.121 |
| GKP | 3330 | 0.766 | 1.462 | 0.125 |
| MID | 12929 | 1.091 | 1.984 | -0.028 |

## By price band

A single mean hides a directional error, which is the kind that matters most to an optimiser — every comparison it makes is skewed the same way. B-004's finding 1 said the premium head read 2–4× `ep_next`; **that was measured against FPL's own model rather than against realised points, and against realised points it is false** (D-020). The bands below are the record of what the error actually is.

| Band | n | MAE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|
| ≤ £5.0m | 20111 | 0.856 | 0.076 | 0.835 | 0.758 |
| £5.1–7.0m | 7550 | 1.593 | -0.211 | 1.667 | 1.877 |
| £7.1–9.0m | 1025 | 2.355 | -0.510 | 2.518 | 3.028 |
| £9.1–11.0m | 145 | 2.760 | -0.486 | 2.721 | 3.207 |
| > £11.0m | 74 | 3.685 | 0.256 | 4.864 | 4.608 |

## Calibration

Error says how far off a prediction is; calibration says whether the model means what it says. A model can carry a respectable MAE and still be systematically high everywhere, which for a squad optimiser is worse than noise — every comparison it makes is skewed the same way.

| Predicted band | n | mean predicted | mean actual |
|---|---:|---:|---:|
| 0–1 | 16048 | 0.341 | 0.196 |
| 1–2 | 7085 | 1.475 | 1.675 |
| 2–3 | 3383 | 2.420 | 2.885 |
| 3–4 | 2000 | 3.413 | 3.509 |
| 4–5 | 320 | 4.314 | 3.672 |
| 5–6 | 57 | 5.465 | 5.579 |
| 6–8 | 12 | 6.410 | 4.000 |

## Rows not scored

| Reason | n |
|---|---:|
| no prior appearance for this player | 265 |

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
