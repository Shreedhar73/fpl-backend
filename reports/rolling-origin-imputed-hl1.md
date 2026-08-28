# Rolling-origin referee

Generated 2026-08-28T15:22:59.655Z over 10 seasons (2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23, 2023-24, 2024-25, 2025-26), 253,568 archive rows. Training window: every earlier season. Season half-life: 1 season(s) — older seasons down-weighted. Imputed start labels: USED — the seasons before 2023-24 fit the minutes model on inferred probabilities (plan 027 task 6).

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

### What the refit actually moved

Carried because "refitted per fold" is a claim a report should be able to lose. Identical rows here would mean the folds shared a fit.

| eval season | startIntercept | startSlope | subAppearanceRate |
|---|---:|---:|---:|
| 2017-18 | -0.1912 | 0.1620 | 0.1512 |
| 2018-19 | -0.1904 | 0.1613 | 0.1503 |
| 2019-20 | -0.1793 | 0.1519 | 0.1557 |
| 2020-21 | -0.1724 | 0.1461 | 0.1570 |
| 2021-22 | -0.1905 | 0.1614 | 0.1512 |
| 2022-23 | -0.2124 | 0.1800 | 0.1408 |
| 2023-24 | -0.2339 | 0.1982 | 0.1487 |
| 2024-25 | 0.0595 | 0.4094 | 0.1510 |
| 2025-26 | 0.1240 | 0.4471 | 0.1576 |

## Paired per-round difference, within each fold

| comparison | eval season | rounds | mean Δ captured@11 | 1 se | clears 2se |
|---|---|---:|---:|---:|---|
| model vs form | 2017-18 | 37 | -16.0% | 2.2% | yes |
| model vs priorSeason | 2017-18 | 38 | -6.7% | 2.0% | yes |
| model vs form | 2018-19 | 37 | -8.3% | 1.7% | yes |
| model vs priorSeason | 2018-19 | 38 | +1.6% | 1.5% | no |
| model vs form | 2019-20 | 36 | -9.8% | 2.1% | yes |
| model vs priorSeason | 2019-20 | 38 | -1.4% | 1.9% | no |
| model vs form | 2020-21 | 37 | -15.4% | 2.4% | yes |
| model vs priorSeason | 2020-21 | 38 | -7.0% | 2.2% | yes |
| model vs form | 2021-22 | 37 | -14.6% | 1.7% | yes |
| model vs priorSeason | 2021-22 | 38 | -10.1% | 1.9% | yes |
| model vs form | 2022-23 | 36 | -18.6% | 1.9% | yes |
| model vs priorSeason | 2022-23 | 37 | -7.1% | 1.9% | yes |
| model vs form | 2023-24 | 37 | -1.1% | 1.8% | no |
| model vs priorSeason | 2023-24 | 38 | +16.5% | 1.7% | yes |
| model vs form | 2024-25 | 37 | +1.0% | 1.8% | no |
| model vs priorSeason | 2024-25 | 38 | +10.0% | 1.9% | yes |
| model imputed vs model recorded-only | 2024-25 | 37 | -1.2% | 0.6% | yes |
| model vs form | 2025-26 | 19 | +3.4% | 2.0% | no |
| model vs priorSeason | 2025-26 | 19 | +24.9% | 1.9% | yes |
| model imputed vs model recorded-only | 2025-26 | 19 | +0.0% | 1.2% | no |

## Across folds

The mean of the fold means, with the standard error of the spread BETWEEN folds. Expect it to be wider than the within-fold pairing: rounds inside one season share that season's weather, so pooling them understates the uncertainty of a claim about seasons not yet played. `reports/guards-009.md` says the same from the other end — one comparison came out −2.41, +2.34 and +0.97 across three seasons, a sign flip no within-season error predicted.

| comparison | folds | mean of fold means | se across folds | clears 2se | per fold |
|---|---:|---:|---:|---|---|
| model vs form | 9 | -8.8% | 2.7% | yes | 2017-18 -16.0%, 2018-19 -8.3%, 2019-20 -9.8%, 2020-21 -15.4%, 2021-22 -14.6%, 2022-23 -18.6%, 2023-24 -1.1%, 2024-25 +1.0%, 2025-26 +3.4% |
| model vs priorSeason | 9 | +2.3% | 4.1% | no | 2017-18 -6.7%, 2018-19 +1.6%, 2019-20 -1.4%, 2020-21 -7.0%, 2021-22 -10.1%, 2022-23 -7.1%, 2023-24 +16.5%, 2024-25 +10.0%, 2025-26 +24.9% |
| model imputed vs model recorded-only | 2 | -0.6% | 0.6% | no | 2024-25 -1.2%, 2025-26 +0.0% |

## What this run says

**Read the folds before 2022-23 with two confounds in front of them, and do not read them as a verdict on the model.** (1) Their training corpus has no expected goals — the column starts in 2022-23 — so the attack half of the model is running on its fallbacks while `form`, which needs nothing but last week's points, is unaffected. (2) Their start labels are imputed rather than recorded, and the seasons are pooled at EQUAL weight with no recency decay, which this repository has already measured as the worse of the two options (`fit.ts`: nine seasons unweighted 1895, with a one-season half-life 1959). A loss on these folds is a statement about a starved and unweighted fit, not about whether the minutes labels are any good.

9 of 9 planned folds ran. Every planned fold had a training corpus that could fit every component of the model.

**model vs form** — -8.8% captured@11 across 9 folds, se 2.7%. Clears twice the between-fold error. The per-fold means do not agree on a sign, which is the thing a single holdout cannot show you.

**model vs priorSeason** — +2.3% captured@11 across 9 folds, se 4.1%. Does NOT clear twice the between-fold error, so this comparison is undecided at this fold count however the mean points. The per-fold means do not agree on a sign, which is the thing a single holdout cannot show you.

**model imputed vs model recorded-only** — -0.6% captured@11 across 2 folds, se 0.6%. Does NOT clear twice the between-fold error, so this comparison is undecided at this fold count however the mean points. The per-fold means do not agree on a sign, which is the thing a single holdout cannot show you. **Read the clearance with the fold count in front of it: an error estimated from 2 numbers is itself barely estimated, and two folds that happen to agree produce a small standard error whether or not the effect is real. This is a direction, not a decision.**
