# Rolling-origin referee

Generated 2026-08-28T15:58:12.028Z over 10 seasons (2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23, 2023-24, 2024-25, 2025-26), 253,568 archive rows. Training window: every earlier season. Season half-life: none — every season counts equally. Imputed start labels: USED — the seasons before 2023-24 fit the minutes model on inferred probabilities (plan 027 task 6).

Each fold fits on the seasons BEFORE its evaluation season and scores that season once. The incumbent is refitted per fold like every other arm — scoring the served parameters, which were fitted on 2023-24 and 2024-25, against the 2024-25 fold would hand it its own training season. The quantity paired is points captured @11 per round (D-020), the pairing is per round (D-033), and the number a single holdout could never produce is the last table: the spread ACROSS folds.

## Folds

| eval season | trained on | train-season rows | start labels | imputed | defcon | scored rounds | ran |
|---|---|---:|---:|---:|---|---:|---|
| 2017-18 | 2016-17 | 23,679 | 0 | 23,679 | absent | 37 | yes |
| 2018-19 | 2016-17, 2017-18 | 46,146 | 0 | 46,146 | absent | 37 | yes |
| 2019-20 | 2016-17, 2017-18, 2018-19 | 67,936 | 0 | 67,936 | absent | 36 | yes |
| 2020-21 | 2016-17, 2017-18, 2018-19, 2019-20 | 90,496 | 0 | 90,496 | absent | 37 | yes |
| 2021-22 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21 | 114,861 | 0 | 114,861 | absent | 37 | yes |
| 2022-23 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22 | 140,308 | 0 | 140,308 | absent | 36 | yes |
| 2023-24 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23 | 166,813 | 0 | 166,813 | absent | 37 | yes |
| 2024-25 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23, 2023-24 | 196,538 | 29,725 | 166,813 | absent | 37 | yes |
| 2025-26 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23, 2023-24, 2024-25 | 223,821 | 57,008 | 166,813 | within-season | 19 | yes |

### What each fold chose, and on what

The training window and the recency half-life are chosen INSIDE each fold, on the season before it, and the fold is then scored once under the winner. `spread` is best minus worst across the candidates on that validation season: a flat grid means the objective could not tell them apart and the winner is noise, whatever it is called.

| eval season | chosen | trained on | validate captured | spread | candidates |
|---|---|---|---:|---:|---:|
| 2017-18 | 1 season, no decay | 2016-17 | 21.8% | 0.00pp | 8 |
| 2018-19 | all seasons, half-life 0.5 | 2016-17, 2017-18 | 18.6% | 0.45pp | 8 |
| 2019-20 | 2 seasons, no decay | 2017-18, 2018-19 | 23.8% | 0.93pp | 8 |
| 2020-21 | 1 season, no decay | 2019-20 | 26.2% | 0.91pp | 8 |
| 2021-22 | 2 seasons, no decay | 2019-20, 2020-21 | 21.9% | 0.65pp | 8 |
| 2022-23 | 2 seasons, no decay | 2020-21, 2021-22 | 18.5% | 1.85pp | 8 |
| 2023-24 | 1 season, no decay | 2022-23 | 19.1% | 0.00pp | 8 |
| 2024-25 | 2 seasons, no decay | 2022-23, 2023-24 | 41.4% | 2.41pp | 8 |
| 2025-26 | 2 seasons, no decay | 2023-24, 2024-25 | 39.7% | 2.03pp | 8 |

**2017-18 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 19 | 21.8% |
| 2 seasons, no decay | 1 | 19 | 21.8% |
| 2 seasons, half-life 1 | 1 | 19 | 21.8% |
| 3 seasons, no decay | 1 | 19 | 21.8% |
| 3 seasons, half-life 1 | 1 | 19 | 21.8% |
| all seasons, no decay | 1 | 19 | 21.8% |
| all seasons, half-life 1 | 1 | 19 | 21.8% |
| all seasons, half-life 0.5 | 1 | 19 | 21.8% |

**2018-19 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 19 | 18.5% |
| 2 seasons, no decay | 2 | 19 | 18.2% |
| 2 seasons, half-life 1 | 2 | 19 | 18.2% |
| 3 seasons, no decay | 2 | 19 | 18.2% |
| 3 seasons, half-life 1 | 2 | 19 | 18.2% |
| all seasons, no decay | 2 | 19 | 18.2% |
| all seasons, half-life 1 | 2 | 19 | 18.2% |
| all seasons, half-life 0.5 | 2 | 19 | 18.6% |

**2019-20 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 19 | 23.7% |
| 2 seasons, no decay | 2 | 19 | 23.8% |
| 2 seasons, half-life 1 | 2 | 19 | 23.8% |
| 3 seasons, no decay | 3 | 19 | 22.8% |
| 3 seasons, half-life 1 | 3 | 19 | 23.8% |
| all seasons, no decay | 3 | 19 | 22.8% |
| all seasons, half-life 1 | 3 | 19 | 23.8% |
| all seasons, half-life 0.5 | 3 | 19 | 23.8% |

**2020-21 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 18 | 26.2% |
| 2 seasons, no decay | 2 | 18 | 26.2% |
| 2 seasons, half-life 1 | 2 | 18 | 26.2% |
| 3 seasons, no decay | 3 | 18 | 25.5% |
| 3 seasons, half-life 1 | 3 | 18 | 26.2% |
| all seasons, no decay | 4 | 18 | 25.3% |
| all seasons, half-life 1 | 4 | 18 | 26.2% |
| all seasons, half-life 0.5 | 4 | 18 | 26.2% |

**2021-22 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 19 | 21.3% |
| 2 seasons, no decay | 2 | 19 | 21.9% |
| 2 seasons, half-life 1 | 2 | 19 | 21.3% |
| 3 seasons, no decay | 3 | 19 | 21.3% |
| 3 seasons, half-life 1 | 3 | 19 | 21.3% |
| all seasons, no decay | 5 | 19 | 21.3% |
| all seasons, half-life 1 | 5 | 19 | 21.3% |
| all seasons, half-life 0.5 | 5 | 19 | 21.3% |

**2022-23 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 19 | 16.6% |
| 2 seasons, no decay | 2 | 19 | 18.5% |
| 2 seasons, half-life 1 | 2 | 19 | 18.5% |
| 3 seasons, no decay | 3 | 19 | 17.1% |
| 3 seasons, half-life 1 | 3 | 19 | 17.1% |
| all seasons, no decay | 6 | 19 | 16.6% |
| all seasons, half-life 1 | 6 | 19 | 16.6% |
| all seasons, half-life 0.5 | 6 | 19 | 16.6% |

**2023-24 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 19 | 19.1% |
| 2 seasons, no decay | 2 | 19 | 19.1% |
| 2 seasons, half-life 1 | 2 | 19 | 19.1% |
| 3 seasons, no decay | 3 | 19 | 19.1% |
| 3 seasons, half-life 1 | 3 | 19 | 19.1% |
| all seasons, no decay | 7 | 19 | 19.1% |
| all seasons, half-life 1 | 7 | 19 | 19.1% |
| all seasons, half-life 0.5 | 7 | 19 | 19.1% |

**2024-25 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 19 | 40.2% |
| 2 seasons, no decay | 2 | 19 | 41.4% |
| 2 seasons, half-life 1 | 2 | 19 | 39.0% |
| 3 seasons, no decay | 3 | 19 | 40.8% |
| 3 seasons, half-life 1 | 3 | 19 | 39.4% |
| all seasons, no decay | 8 | 19 | 40.0% |
| all seasons, half-life 1 | 8 | 19 | 39.4% |
| all seasons, half-life 0.5 | 8 | 19 | 40.1% |

**2025-26 — every candidate**

| candidate | seasons | rounds | validate captured |
|---|---:|---:|---:|
| 1 season, no decay | 1 | 19 | 38.2% |
| 2 seasons, no decay | 2 | 19 | 39.7% |
| 2 seasons, half-life 1 | 2 | 19 | 39.6% |
| 3 seasons, no decay | 3 | 19 | 38.5% |
| 3 seasons, half-life 1 | 3 | 19 | 38.7% |
| all seasons, no decay | 9 | 19 | 38.7% |
| all seasons, half-life 1 | 9 | 19 | 38.0% |
| all seasons, half-life 0.5 | 9 | 19 | 37.7% |

### What the refit actually moved

Carried because "refitted per fold" is a claim a report should be able to lose. Identical rows here would mean the folds shared a fit.

| eval season | startIntercept | startSlope | subAppearanceRate |
|---|---:|---:|---:|
| 2017-18 | -0.1912 | 0.1620 | 0.1512 |
| 2018-19 | -0.1791 | 0.1517 | 0.1549 |
| 2019-20 | -0.1764 | 0.1495 | 0.1564 |
| 2020-21 | -0.1512 | 0.1281 | 0.1657 |
| 2021-22 | -0.1940 | 0.1644 | 0.1534 |
| 2022-23 | -0.2298 | 0.1947 | 0.1319 |
| 2023-24 | -0.2325 | 0.1970 | 0.1848 |
| 2024-25 | 0.1633 | 0.4186 | 0.1607 |
| 2025-26 | 0.2833 | 0.4759 | 0.1544 |

## Paired per-round difference, within each fold

| comparison | eval season | rounds | mean Δ captured@11 | 1 se | clears 2se |
|---|---|---:|---:|---:|---|
| model vs form | 2017-18 | 37 | -16.0% | 2.2% | yes |
| model vs priorSeason | 2017-18 | 38 | -6.7% | 2.0% | yes |
| model vs form | 2018-19 | 37 | -8.7% | 1.7% | yes |
| model vs priorSeason | 2018-19 | 38 | +0.9% | 1.5% | no |
| model vs form | 2019-20 | 36 | -9.8% | 2.1% | yes |
| model vs priorSeason | 2019-20 | 38 | -1.4% | 1.9% | no |
| model vs form | 2020-21 | 37 | -15.4% | 2.4% | yes |
| model vs priorSeason | 2020-21 | 38 | -7.1% | 2.2% | yes |
| model vs form | 2021-22 | 37 | -14.6% | 1.7% | yes |
| model vs priorSeason | 2021-22 | 38 | -10.0% | 2.0% | yes |
| model vs form | 2022-23 | 36 | -18.1% | 1.8% | yes |
| model vs priorSeason | 2022-23 | 37 | -6.8% | 2.0% | yes |
| model vs form | 2023-24 | 37 | -1.1% | 1.8% | no |
| model vs priorSeason | 2023-24 | 38 | +16.6% | 1.7% | yes |
| model vs form | 2024-25 | 37 | +2.1% | 1.8% | no |
| model vs priorSeason | 2024-25 | 38 | +11.5% | 1.7% | yes |
| model imputed vs model recorded-only | 2024-25 | 37 | -0.7% | 0.5% | no |
| model vs form | 2025-26 | 19 | +3.9% | 2.1% | no |
| model vs priorSeason | 2025-26 | 19 | +25.1% | 1.9% | yes |
| model imputed vs model recorded-only | 2025-26 | 19 | -0.2% | 1.5% | no |

## Across folds

The mean of the fold means, with the standard error of the spread BETWEEN folds. Expect it to be wider than the within-fold pairing: rounds inside one season share that season's weather, so pooling them understates the uncertainty of a claim about seasons not yet played. `reports/guards-009.md` says the same from the other end — one comparison came out −2.41, +2.34 and +0.97 across three seasons, a sign flip no within-season error predicted.

| comparison | folds | mean of fold means | se across folds | clears 2se | per fold |
|---|---:|---:|---:|---|---|
| model vs form | 9 | -8.6% | 2.8% | yes | 2017-18 -16.0%, 2018-19 -8.7%, 2019-20 -9.8%, 2020-21 -15.4%, 2021-22 -14.6%, 2022-23 -18.1%, 2023-24 -1.1%, 2024-25 +2.1%, 2025-26 +3.9% |
| model vs priorSeason | 9 | +2.5% | 4.1% | no | 2017-18 -6.7%, 2018-19 +0.9%, 2019-20 -1.4%, 2020-21 -7.1%, 2021-22 -10.0%, 2022-23 -6.8%, 2023-24 +16.6%, 2024-25 +11.5%, 2025-26 +25.1% |
| model imputed vs model recorded-only | 2 | -0.4% | 0.3% | no | 2024-25 -0.7%, 2025-26 -0.2% |

## What this run says

**Read the folds before 2022-23 with two confounds in front of them, and do not read them as a verdict on the model.** (1) Their training corpus has no expected goals — the column starts in 2022-23 — so the attack half of the model is running on its fallbacks while `form`, which needs nothing but last week's points, is unaffected. (2) Their start labels are imputed rather than recorded, and the seasons are pooled at EQUAL weight with no recency decay, which this repository has already measured as the worse of the two options (`fit.ts`: nine seasons unweighted 1895, with a one-season half-life 1959). A loss on these folds is a statement about a starved and unweighted fit, not about whether the minutes labels are any good.

9 of 9 planned folds ran. Every planned fold had a training corpus that could fit every component of the model.

**model vs form** — -8.6% captured@11 across 9 folds, se 2.8%. Clears twice the between-fold error. The per-fold means do not agree on a sign, which is the thing a single holdout cannot show you.

**model vs priorSeason** — +2.5% captured@11 across 9 folds, se 4.1%. Does NOT clear twice the between-fold error, so this comparison is undecided at this fold count however the mean points. The per-fold means do not agree on a sign, which is the thing a single holdout cannot show you.

**model imputed vs model recorded-only** — -0.4% captured@11 across 2 folds, se 0.3%. Does NOT clear twice the between-fold error, so this comparison is undecided at this fold count however the mean points. Every fold agrees on the sign. **Read the clearance with the fold count in front of it: an error estimated from 2 numbers is itself barely estimated, and two folds that happen to agree produce a small standard error whether or not the effect is real. This is a direction, not a decision.**
