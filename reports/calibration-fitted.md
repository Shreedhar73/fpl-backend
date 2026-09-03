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
| this model | 28905 | 0.943 | 1.937 | -0.106 | 1.047 | 1.153 |
| baseline: form | 28905 | 1.042 | 2.131 | 0.012 | 1.166 | 1.153 |

**Beats `form` on MAE** (and on RMSE).

### Against last season's points per 90

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 11965 | 1.524 | 2.543 | -0.232 | 1.734 | 1.966 |
| baseline: last season points/90 | 11965 | 3.152 | 3.665 | 1.939 | 3.905 | 1.966 |

**Beats last season's points per 90 on MAE.**

### Against `form`, restricted to established players

The same two predictors on the rows that also carry a prior-season baseline — which is a filter for **450+ minutes last season**, so it is a filter for players who actually play. This is not a third baseline; it is the same `form` comparison on a different population, and the gap between this table and the one above is the most useful number in the report.

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 11648 | 1.517 | 2.539 | -0.231 | 1.730 | 1.961 |
| baseline: form | 11648 | 1.742 | 2.813 | 0.019 | 1.980 | 1.961 |

**Beats `form` here**, on rows where it loses over the full field. The difference between the two populations is fringe players: rows where the outcome is usually zero, where a near-zero prediction is very hard to beat on MAE, and which a squad optimiser never chooses between. That is the case for reading MAE over the whole field as the wrong verdict (D-020) — measured rather than argued.

### The same three on every row each could reach

Not a comparison — three different populations. Kept because it is what was reported before B-012, so the effect of the restriction is visible rather than described.

| Model | n | MAE | RMSE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|---:|
| this model | 29482 | 0.949 | 1.941 | -0.107 | 1.050 | 1.158 |
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
| DEF | 9463 | 1.114 | 2.112 | -0.108 |
| FWD | 3183 | 0.979 | 2.066 | -0.202 |
| GKP | 3330 | 0.622 | 1.443 | -0.014 |
| MID | 12929 | 0.892 | 1.880 | -0.105 |

## By price band

A single mean hides a directional error, which is the kind that matters most to an optimiser — every comparison it makes is skewed the same way. B-004's finding 1 said the premium head read 2–4× `ep_next`; **that was measured against FPL's own model rather than against realised points, and against realised points it is false** (D-020). The bands below are the record of what the error actually is.

| Band | n | MAE | bias | mean predicted | mean actual |
|---|---:|---:|---:|---:|---:|
| ≤ £5.0m | 20111 | 0.692 | -0.028 | 0.731 | 0.758 |
| £5.1–7.0m | 7550 | 1.403 | -0.234 | 1.643 | 1.877 |
| £7.1–9.0m | 1025 | 2.145 | -0.596 | 2.432 | 3.028 |
| £9.1–11.0m | 145 | 2.193 | -0.896 | 2.311 | 3.207 |
| > £11.0m | 74 | 3.338 | -0.167 | 4.441 | 4.608 |

## Calibration

Error says how far off a prediction is; calibration says whether the model means what it says. A model can carry a respectable MAE and still be systematically high everywhere, which for a squad optimiser is worse than noise — every comparison it makes is skewed the same way.

| Predicted band | n | mean predicted | mean actual |
|---|---:|---:|---:|
| 0–1 | 16810 | 0.125 | 0.128 |
| 1–2 | 5131 | 1.548 | 1.683 |
| 2–3 | 4288 | 2.444 | 2.929 |
| 3–4 | 2177 | 3.425 | 3.647 |
| 4–5 | 413 | 4.330 | 3.956 |
| 5–6 | 64 | 5.309 | 5.109 |
| 6–8 | 19 | 6.437 | 4.684 |
| 8–10 | 2 | 9.160 | 1.500 |
| 10–∞ | 1 | 13.247 | 5.000 |

## Rows not scored

| Reason | n |
|---|---:|
| no prior appearance for this player | 265 |

## Parameters used

```json
{
  "strength": {
    "homeAdvantage": 1.118640838000319,
    "confidenceMatches": 64,
    "leagueGoalsPerTeamMatch": 1.5486291739894331,
    "goalsWeight": 0.5,
    "decayHalfLife": 6
  },
  "minutes": {
    "startIntercept": -0.187900700795416,
    "startSlope": 0.4849268629262445,
    "subAppearanceRate": 0.15435726210350584,
    "subIntercept": 0.574677247015025,
    "subSlope": 1.384130123390548,
    "sixtyGivenStart": 0.9339351334078926,
    "sixtyGivenSub": 0.013411204845338524,
    "minutesGivenStart": 82.83320019172392,
    "minutesGivenSub": 18.151633138654553,
    "gkp": {
      "startIntercept": -0.26501428563368706,
      "startSlope": 0.5598803671683812,
      "subIntercept": -1.0818460458418615,
      "subSlope": 1.4470795639568321,
      "n": {
        "start": 4627,
        "sub": 3514
      }
    }
  },
  "saves": {
    "elasticity": 0.5
  },
  "attack": {
    "xgFixtureElasticity": 0.75,
    "xaFixtureElasticity": 2,
    "goalsPerXg": 0.9890259541292117,
    "assistsPerXa": 1.3951956123013414
  },
  "defcon": {
    "dispersion": 1.5,
    "ratePer90ToMatch": 1
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
    "rows": 56133,
    "date": "2026-08-27-gkp",
    "objective": "frequencies measured directly; shape parameters by MAE on held-out 2024-25 rounds 20+",
    "heldOut": "2025-26 (whole season), live 2026/27 (untouched)",
    "notes": [
      "defensive contribution is fitted on 2025-26 rounds 1-19 — the category exists in no earlier season, so that term alone is not held out",
      "the availability multiplier is NOT fitted: the archive carries no per-gameweek status or chance_of_playing (B-007 Phase 2 must accumulate first)",
      "B-021: keeper minutes curves fitted on GKP rows alone (n start 4627, sub 3514) and saves elasticity 0.5 - an interior optimum on keeper validation rows; every global parameter reproduced the incumbent byte-for-byte"
    ]
  }
}
```

Corpus: 86755 archive player-gameweeks. Nothing was written to `projections` — asserted, not assumed.
