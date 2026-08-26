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
| this model | 28905 | 1.107 | 2.008 | 0.059 | 1.212 | 1.153 |
| baseline: form | 28905 | 1.042 | 2.131 | 0.012 | 1.166 | 1.153 |

**Does not beat `form` on MAE** (it does on RMSE).

### Against last season's points per 90

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 11965 | 1.760 | 2.642 | 0.009 | 1.975 | 1.966 |
| baseline: last season points/90 | 11965 | 3.152 | 3.665 | 1.939 | 3.905 | 1.966 |

**Beats last season's points per 90 on MAE.**

### Against `form`, restricted to established players

The same two predictors on the rows that also carry a prior-season baseline — which is a filter for **450+ minutes last season**, so it is a filter for players who actually play. This is not a third baseline; it is the same `form` comparison on a different population, and the gap between this table and the one above is the most useful number in the report.

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 11648 | 1.753 | 2.638 | 0.012 | 1.973 | 1.961 |
| baseline: form | 11648 | 1.742 | 2.813 | 0.019 | 1.980 | 1.961 |

**Does not beat `form` here either**, which removes the "MAE is dominated by fringe players" explanation for the headline. That explanation is D-020's, and this is the test of it.

### The same three on every row each could reach

Not a comparison — three different populations. Kept because it is what was reported before B-012, so the effect of the restriction is visible rather than described.

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 29482 | 1.113 | 2.013 | 0.058 | 1.215 | 1.158 |
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
| DEF | 9463 | 1.274 | 2.181 | 0.058 |
| FWD | 3183 | 1.133 | 2.121 | -0.050 |
| GKP | 3330 | 0.694 | 1.459 | 0.054 |
| MID | 12929 | 1.085 | 1.970 | 0.088 |

## By price band

A single mean hides a directional error, which is the kind that matters most to an optimiser — every comparison it makes is skewed the same way. B-004's finding 1 said the premium head read 2–4× `ep_next`; **that was measured against FPL's own model rather than against realised points, and against realised points it is false** (D-020). The bands below are the record of what the error actually is.

| Band | n | MAE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|
| ≤ £5.0m | 20111 | 0.818 | 0.100 | 0.859 | 0.758 |
| £5.1–7.0m | 7550 | 1.645 | 0.008 | 1.886 | 1.877 |
| £7.1–9.0m | 1025 | 2.375 | -0.355 | 2.673 | 3.028 |
| £9.1–11.0m | 145 | 2.803 | -0.261 | 2.946 | 3.207 |
| > £11.0m | 74 | 3.819 | 0.328 | 4.936 | 4.608 |

## Calibration

Error says how far off a prediction is; calibration says whether the model means what it says. A model can carry a respectable MAE and still be systematically high everywhere, which for a squad optimiser is worse than noise — every comparison it makes is skewed the same way.

| Predicted band | n | mean predicted | mean actual |
|---|---:|---:|---:|
| 0–1 | 15095 | 0.230 | 0.139 |
| 1–2 | 6246 | 1.531 | 1.421 |
| 2–3 | 4677 | 2.431 | 2.590 |
| 3–4 | 2244 | 3.427 | 3.459 |
| 4–5 | 531 | 4.328 | 3.778 |
| 5–6 | 90 | 5.380 | 4.256 |
| 6–8 | 18 | 6.469 | 4.778 |
| 8–10 | 1 | 8.497 | 0.000 |
| 10–∞ | 3 | 11.655 | 2.667 |

## Rows not scored

| Reason | n |
|---|---:|
| no prior appearance for this player | 265 |

## Parameters used

```json
{
  "strength": {
    "homeAdvantage": 1.1186408380003194,
    "confidenceMatches": 64,
    "leagueGoalsPerTeamMatch": 1.5486291739894333,
    "goalsWeight": 0.5,
    "decayHalfLife": 6
  },
  "minutes": {
    "startIntercept": -0.18790070079541765,
    "startSlope": 0.4849268629262438,
    "subAppearanceRate": 0.15435726210350584,
    "subIntercept": 0.5746772470150242,
    "subSlope": 1.3841301233905476,
    "sixtyGivenStart": 0.9339351334078926,
    "sixtyGivenSub": 0.013411204845338524,
    "minutesGivenStart": 82.83320019172392,
    "minutesGivenSub": 18.151633138654553
  },
  "attack": {
    "xgFixtureElasticity": 0.25,
    "xaFixtureElasticity": 2.5,
    "goalsPerXg": 0.9890259541292118,
    "assistsPerXa": 1.3951956123013418
  },
  "defcon": {
    "dispersion": 1.5,
    "ratePer90ToMatch": 1.1
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
    "date": "2026-08-27",
    "objective": "frequencies measured directly; shape parameters by RMSE on held-out 2024-25 rounds 20+ (14,540 rows). RMSE deliberately, not MAE: MAE is minimised by the conditional median and this corpus is mostly near-zero rows, so an MAE search shrank every parameter toward predicting nobody scores.",
    "heldOut": "2025-26 rounds 13-38 entirely; rounds 1-12 (8,818 rows) are read by the defensive-contribution parameters and by nothing else. Live 2026/27 untouched.",
    "notes": [
      "The defensive-contribution parameters are the ONE exception to the holdout: that category exists only in 2025-26, so dispersion is fitted on rounds 1-12 and ratePer90ToMatch chosen on 13-19. Those rows are passed separately and no other parameter reads them — an earlier version folded them into the training set, where the frequency measurements iterated them too, so a quarter of the test season silently informed the whole fit while this note claimed otherwise.",
      "The availability multiplier is NOT fitted: the archive carries no per-gameweek status or chance_of_playing. It waits on player_deadline_snapshot (B-007 Phase 2) accumulating live gameweeks.",
      "strength: rebuilt in B-014. A team goals for a fixture are the sum of its players goalsScored plus the opponent ownGoals — neither source carries a team score, so this rollup IS the definition and it is the same rollup on both sides. goalsWeight 0.5 blends that with the old expected-goals sum ON THE RATIO rather than on the raw rates, because the two have different league means. decayHalfLife 6 rounds applies to the goals side only, so goalsWeight 0 reproduces the incumbent model exactly and the search is a comparison rather than two changes at once.",
      "strength.confidenceMatches is 64 and NO LONGER at the grid edge. Under the old definition the search ran to 96 and kept improving — held-out RMSE preferred shrinking team strength away entirely, because the signal it was shrinking was not worth keeping. An interior optimum is the direct evidence that the rebuilt estimate carries information.",
      "The fixture elasticities are non-zero for the first time: xa 2.5, xg 0.25. The assist result is clear (1.9470 at zero against 1.9453 at 2.5); the goal result is weak — 0, 0.25 and 0.5 are within 0.0002 RMSE of each other and only the top of the grid is clearly worse.",
      "xaFixtureElasticity: the grid was FLAT — every value from 1.0 to 2.0 scored 1.9497 and the whole grid spanned 0.0007 RMSE. A grid search returns a winner whether or not its objective can tell the candidates apart, so the search now takes the NULL candidate (no effect) when the spread is under 0.001, and says so. Without that rule this parameter would have shipped as 1.5 — a claim that the fixture moves assists by half again, on evidence of seven ten-thousandths of a point.",
      "defcon.ratePer90ToMatch moved 0.9 -> 1.0 when the non-linear terms began integrating over the MINUTES distribution as well as the count (B-020). It had been absorbing part of that error: with the threshold evaluated once at average minutes, a lower rate was the least-bad compromise across nailed and rotated players. Any parameter fitted against a wrong shape is partly a correction for it.",
      "subIntercept/subSlope replace the scalar subAppearanceRate (B-019). Fitted on non-start rows only — the population the term is asked about at prediction time. subAppearanceRate is kept as the population rate the report quotes and as the flat-curve fallback."
    ]
  }
}
```

Corpus: 86755 archive player-gameweeks. Nothing was written to `projections` — asserted, not assumed.
