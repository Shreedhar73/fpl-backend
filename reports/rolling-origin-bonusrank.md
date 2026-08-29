# Rolling-origin referee

Generated 2026-08-29T04:15:12.750Z over 10 seasons (2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23, 2023-24, 2024-25, 2025-26), 253,568 archive rows. Training window: every earlier season. Season half-life: none — every season counts equally. Imputed start labels: not used. Window and decay: fixed for every fold. Player rates: the flat career mean. Bonus: rank inside the fixture, temperature CHOSEN per fold (plan 028 task 4). Starter minutes: the two league constants. Availability: plan 024's fitted flags.

Each fold fits on the seasons BEFORE its evaluation season and scores that season once. The incumbent is refitted per fold like every other arm — scoring the served parameters, which were fitted on 2023-24 and 2024-25, against the 2024-25 fold would hand it its own training season. The quantity paired is points captured @11 per round (D-020), the pairing is per round (D-033), and the number a single holdout could never produce is the last table: the spread ACROSS folds.

## Folds

| eval season | trained on | train-season rows | start labels | imputed | defcon | scored rounds | ran |
|---|---|---:|---:|---:|---|---:|---|
| 2017-18 | 2016-17 | 23,679 | 0 | 23,679 | absent | 0 | no |
| 2018-19 | 2016-17, 2017-18 | 46,146 | 0 | 46,146 | absent | 0 | no |
| 2019-20 | 2016-17, 2017-18, 2018-19 | 67,936 | 0 | 67,936 | absent | 0 | no |
| 2020-21 | 2016-17, 2017-18, 2018-19, 2019-20 | 90,496 | 0 | 90,496 | absent | 0 | no |
| 2021-22 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21 | 114,861 | 0 | 114,861 | absent | 0 | no |
| 2022-23 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22 | 140,308 | 0 | 140,308 | absent | 0 | no |
| 2023-24 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23 | 166,813 | 0 | 166,813 | absent | 0 | no |
| 2024-25 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23, 2023-24 | 196,538 | 29,725 | 166,813 | absent | 37 | yes |
| 2025-26 | 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23, 2023-24, 2024-25 | 223,821 | 57,008 | 166,813 | within-season | 19 | yes |

### Folds that were refused, and why

A refused fold is a result. The minutes curves fall back to their unfitted defaults on an empty sample without complaining, so a fold with no start labels in its training seasons would emit a complete set of plausible numbers from a model that was never fitted.

- **2017-18** — no start labels in 2016-17 — the minutes curves would fall back to their unfitted defaults and the fold would report a number from a model that was never fitted
- **2018-19** — no start labels in 2016-17, 2017-18 — the minutes curves would fall back to their unfitted defaults and the fold would report a number from a model that was never fitted
- **2019-20** — no start labels in 2016-17, 2017-18, 2018-19 — the minutes curves would fall back to their unfitted defaults and the fold would report a number from a model that was never fitted
- **2020-21** — no start labels in 2016-17, 2017-18, 2018-19, 2019-20 — the minutes curves would fall back to their unfitted defaults and the fold would report a number from a model that was never fitted
- **2021-22** — no start labels in 2016-17, 2017-18, 2018-19, 2019-20, 2020-21 — the minutes curves would fall back to their unfitted defaults and the fold would report a number from a model that was never fitted
- **2022-23** — no start labels in 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22 — the minutes curves would fall back to their unfitted defaults and the fold would report a number from a model that was never fitted
- **2023-24** — no start labels in 2016-17, 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23 — the minutes curves would fall back to their unfitted defaults and the fold would report a number from a model that was never fitted

### What each fold chose for the bonus term

A fixture has six bonus points and always has. The incumbent term hands out 8.15–8.72 on average and up to 16.56 in one match, because it reads a player's own BPS and nothing else; the rank model pays exactly six by construction. The incumbent is in the grid, so it can win.

| eval season | chosen | validate captured | spread |
|---|---|---:|---:|
| 2024-25 | the incumbent clipped-linear term | 42.1% | 2.92pp |
| 2025-26 | rank model, tau 16 | 40.4% | 1.58pp |

**2024-25 — every bonus candidate**

| candidate | rounds | validate captured |
|---|---:|---:|
| the incumbent clipped-linear term | 19 | 42.1% |
| rank model, tau 3 | 19 | 39.1% |
| rank model, tau 6 | 19 | 40.7% |
| rank model, tau 10 | 19 | 41.3% |
| rank model, tau 16 | 19 | 41.0% |
| rank model, tau 30 | 19 | 40.9% |

**2025-26 — every bonus candidate**

| candidate | rounds | validate captured |
|---|---:|---:|
| the incumbent clipped-linear term | 19 | 39.2% |
| rank model, tau 3 | 19 | 38.8% |
| rank model, tau 6 | 19 | 40.2% |
| rank model, tau 10 | 19 | 40.2% |
| rank model, tau 16 | 19 | 40.4% |
| rank model, tau 30 | 19 | 40.0% |

### What the refit actually moved

Carried because "refitted per fold" is a claim a report should be able to lose. Identical rows here would mean the folds shared a fit.

| eval season | startIntercept | startSlope | subAppearanceRate |
|---|---:|---:|---:|
| 2024-25 | 0.2299 | 0.4252 | 0.1544 |
| 2025-26 | 0.2738 | 0.4761 | 0.1544 |

## Paired per-round difference, within each fold

| comparison | eval season | rounds | mean Δ captured@11 | 1 se | clears 2se |
|---|---|---:|---:|---:|---|
| model vs form | 2024-25 | 37 | +2.9% | 1.7% | no |
| model vs priorSeason | 2024-25 | 38 | +11.9% | 1.7% | yes |
| plan 028 model shape vs the incumbent | 2024-25 | 37 | +0.0% | 0.0% | no |
| model vs form | 2025-26 | 19 | +3.7% | 2.1% | no |
| model vs priorSeason | 2025-26 | 19 | +25.3% | 2.1% | yes |
| plan 028 model shape vs the incumbent | 2025-26 | 19 | -0.4% | 0.8% | no |

## Across folds

The mean of the fold means, with the standard error of the spread BETWEEN folds. Expect it to be wider than the within-fold pairing: rounds inside one season share that season's weather, so pooling them understates the uncertainty of a claim about seasons not yet played. `reports/guards-009.md` says the same from the other end — one comparison came out −2.41, +2.34 and +0.97 across three seasons, a sign flip no within-season error predicted.

| comparison | folds | mean of fold means | se across folds | clears 2se | per fold |
|---|---:|---:|---:|---|---|
| model vs form | 2 | +3.3% | 0.4% | yes | 2024-25 +2.9%, 2025-26 +3.7% |
| model vs priorSeason | 2 | +18.6% | 6.7% | yes | 2024-25 +11.9%, 2025-26 +25.3% |
| plan 028 model shape vs the incumbent | 2 | -0.2% | 0.2% | no | 2024-25 +0.0%, 2025-26 -0.4% |

## What this run says

2 of 9 planned folds ran. 7 were refused: 2017-18, 2018-19, 2019-20, 2020-21, 2021-22, 2022-23, 2023-24. Until the archive carries a start label for those seasons, the referee is 2-fold for anything the minutes model touches, whatever it is for the rate components.

**model vs form** — +3.3% captured@11 across 2 folds, se 0.4%. Clears twice the between-fold error. Every fold agrees on the sign. **Read the clearance with the fold count in front of it: an error estimated from 2 numbers is itself barely estimated, and two folds that happen to agree produce a small standard error whether or not the effect is real. This is a direction, not a decision.**

**model vs priorSeason** — +18.6% captured@11 across 2 folds, se 6.7%. Clears twice the between-fold error. Every fold agrees on the sign. **Read the clearance with the fold count in front of it: an error estimated from 2 numbers is itself barely estimated, and two folds that happen to agree produce a small standard error whether or not the effect is real. This is a direction, not a decision.**

**plan 028 model shape vs the incumbent** — -0.2% captured@11 across 2 folds, se 0.2%. Does NOT clear twice the between-fold error, so this comparison is undecided at this fold count however the mean points. The per-fold means do not agree on a sign, which is the thing a single holdout cannot show you. **Read the clearance with the fold count in front of it: an error estimated from 2 numbers is itself barely estimated, and two folds that happen to agree produce a small standard error whether or not the effect is real. This is a direction, not a decision.**
