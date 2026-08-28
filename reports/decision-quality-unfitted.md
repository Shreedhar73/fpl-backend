# Decision quality — unfitted

Test season **2025-26**, held out of the fit. This is the report B-012 exists for: `calibration-*.md` says how far each prediction was from the outcome, and this one says whether the ordering those predictions imply is any better than the alternatives.

## Why not MAE

MAE is minimised by the conditional median. Most player-gameweeks are players who barely feature, so a predictor that says near-zero for everyone wins MAE and tells a squad optimiser nothing — it never asks what a player will score, it asks which fifteen, which eleven of those, and who takes the armband. Every one of those is an ordering question. Recorded as D-020.

## The defensive-contribution caveat, on this verdict too

The season scored here is 2025-26, and 2025-26 rounds 1–19 are where the defensive-contribution parameters were fitted — that category exists in no earlier season, so it cannot be held out across seasons. Those rows are passed to the fit separately and no other parameter reads them, but the defcon term's contribution below is **not** held out. Every calibration report carries this; the verdict carries it too, or it claims a cleaner holdout than it has.

## Ordering

Scored **per round and then averaged**, never pooled: pooling conflates ranking a deadline's players well with knowing which rounds were high-scoring, and only the first is a job the product does. Rounds where nobody scored produce no number and are dropped rather than counted as zero.

**Spearman is tie-corrected**, and it cannot reach 1 here: FPL outcomes are massively tied, so the outcome itself carries no order to recover among the players on 0, 1 or 2. The ceiling is the data's, not the model's. **Points captured @ k** is the primary top-k metric — the realised points of a predictor's top *k* over the realised points of the true top *k*, which a tie at the boundary cannot move. **Precision@k** is reported beside it and is the fragile one.

Population: **11648** of 29482 player-gameweeks — the rows every predictor could score, so the ranking each produced is over the same field.

### whole field

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.621 | 34.6% | 7.6% | 36.3% | 11.7% | 42.0% | 22.0% |
| form | 37 | 0.574 | 33.6% | 10.8% | 34.8% | 13.2% | 40.2% | 19.9% |
| priorSeason | 37 | 0.052 | 12.6% | 3.2% | 17.3% | 6.3% | 22.8% | 11.4% |
| v4 | 37 | 0.611 | 36.8% | 12.3% | 39.2% | 15.0% | 45.1% | 25.9% |

### top 100 by price

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.644 | 44.5% | 21.4% | 48.7% | 29.5% | 64.1% | 53.2% |
| form | 37 | 0.548 | 43.4% | 22.9% | 47.3% | 28.8% | 61.1% | 49.3% |
| priorSeason | 37 | -0.017 | 25.0% | 13.3% | 26.2% | 16.6% | 36.6% | 28.8% |
| v4 | 37 | 0.607 | 47.8% | 27.0% | 51.3% | 33.3% | 64.5% | 52.9% |

### top 100 by predicted

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.095 | 39.1% | 16.0% | 41.6% | 21.8% | 50.4% | 40.2% |
| form | 37 | 0.090 | 37.8% | 18.4% | 39.7% | 21.4% | 48.8% | 36.0% |
| priorSeason | 37 | 0.023 | 16.1% | 9.1% | 23.3% | 16.0% | 37.5% | 38.6% |
| v4 | 37 | 0.132 | 40.3% | 18.7% | 43.5% | 22.5% | 52.5% | 38.7% |

## What the ordering says

Against `form`, over the whole field: Spearman **0.621** against **0.574**, and points captured @11 **34.6%** against **33.6%**.

**Beats `form` on rank correlation and on points captured at every k.**

`priorSeason` is far behind on every measure, which is the sanity check on the metric itself: a baseline that cannot see this season should not rank this season's rounds.

## v4 against the bar (B-036)

The gradient-boosted candidate — one XGBoost per position over 1/3/5/10/38-match window features, the OpenFPL recipe — scored on the same rows as every other predictor. **The bar below was committed to the register before the first training run**, so it cannot have been written to fit the numbers. Known handicap, stated: the archive carries no per-gameweek availability, so v4 trains without OpenFPL's match-status features — the same ceiling the incumbent lives under (B-015).

Population for the ordering comparison: **29482** rows both could score. Spearman v4 **0.701** vs incumbent **0.708**.

**Two populations, named so the columns are not cross-read** (B-012 invariant 3): the v4-vs-incumbent columns and their paired noise are on the rows BOTH could score; the `form` column is on the smaller three-way intersection and is context, not a leg of the bar. "paired Δse" is the per-round-paired difference in squared error (v4 − incumbent): negative favours v4, and a difference that does not clear two standard errors is not a result — the same rule every season comparison in this report obeys (B-030).

| category | n | v4 RMSE | incumbent RMSE | paired Δse ± s.e. | clears | form RMSE (3-way, n) |
|---|---:|---:|---:|---:|---|---:|
| Zeros | 18073 | 0.848 | 0.745 | +0.171 ± 0.024 | **yes** | 0.879 (17753) |
| Blanks | 7213 | 1.582 | 1.569 | +0.040 ± 0.048 | no | 2.144 (7062) |
| Tickers | 1690 | 1.406 | 1.577 | -0.516 ± 0.061 | **yes** | 2.068 (1645) |
| Haulers | 2506 | 5.528 | 5.822 | -3.381 ± 0.322 | **yes** | 5.652 (2445) |

**Ordering — beat the incumbent on points captured at every k:** @11 34.9% vs 33.0%, @15 36.8% vs 33.0%, @30 41.3% vs 37.8% — **met**.

**High-return accuracy — improve Tickers and Haulers:** Tickers 1.406 vs 1.577 (n=1690, clears its paired noise), Haulers 5.528 vs 5.822 (n=2506, clears its paired noise) — **met**.

**Low-return accuracy — no material (>5%) degradation:** Zeros 0.848 vs 0.745 (n=18073, clears its paired noise), Blanks 1.582 vs 1.569 (n=7213, inside its paired noise) — **not held**.

**The bar is not met, and the archive holdout is retired.** `modelVersion` does not move. This cycle measured the direct fit, the residual-on-incumbent fit, and finally the composite — per-position blend weights chosen on VALIDATE by a bar-shaped rule, its one TEST reading pre-registered as final. The composite came one leg short: ordering met at every k, low-return held, Haulers improved inside its noise — and the Tickers regression, halved from the direct fit's, still clears its paired noise. No member of this family passes all three legs on this holdout, and the holdout has now been read too often to referee further selection. The next verdict comes from the untouched prospective holdout accumulating on its own — the live 2026-27 season, scored week by week by `pnpm score:gameweek` (B-016) for the incumbent and the candidate alike. Enrichment stays blocked at the source (probed 2026-08-27). All recorded in B-037.

## The XI and the armband

Every predictor is handed **the same fifteen players** and picks an XI, a bench order and a captain from them. If each picked its own squad the XI comparison would be confounded by the squad comparison, and a model could field a worse XI out of a better fifteen and look better for it.

The squads are chosen once, at **round 1**, by rules that read no model: the **template** is the legal fifteen maximising `selectedBy` — an integer program, because the top fifteen by ownership breaks the position quotas, the three-per-club cap and the budget all at once — plus **4 seeded random legal squads** (seed `20260827`) so the verdict does not rest on one squad's quirks.

**XI efficiency** is the share of the points that squad *could* have delivered that the predictor's selections actually took — so squads of different quality can be read side by side. **Captain regret** is the mean gap per round between the best realised score among the players fielded and the captain's; a bench player's haul is an XI decision, not an armband one, so it is deliberately not in the denominator.

**The squads are built at round 1 and scored from round 2.** `form` has no trailing round at a season's first deadline, so round 1 is absent from the comparison population entirely — which means the squads are picked at opening-day prices and opening-day ownership, before a round of transfers has moved the crowd, and the season measured here is 37 rounds rather than 38.

| Squad | Predictor | rounds | points | XI efficiency | captain regret |
|---|---|---:|---:|---:|---:|
| template (most-owned legal fifteen) | model | 37 | 1665 | 83.3% | 7.973 |
| template (most-owned legal fifteen) | form | 37 | 1735 | 86.8% | 6.162 |
| template (most-owned legal fifteen) | priorSeason | 37 | 1696 | 84.8% | 7.081 |
| template (most-owned legal fifteen) | v4 | 37 | 1768 | 88.4% | 5.459 |
| random #1 (seed 20260827) | model | 37 | 723 | 86.5% | 2.946 |
| random #1 (seed 20260827) | form | 37 | 714 | 85.4% | 3.189 |
| random #1 (seed 20260827) | priorSeason | 37 | 643 | 76.9% | 5.108 |
| random #1 (seed 20260827) | v4 | 37 | 748 | 89.5% | 2.270 |
| random #2 (seed 20260827) | model | 37 | 868 | 86.4% | 3.703 |
| random #2 (seed 20260827) | form | 37 | 872 | 86.8% | 3.595 |
| random #2 (seed 20260827) | priorSeason | 37 | 863 | 85.9% | 3.838 |
| random #2 (seed 20260827) | v4 | 37 | 891 | 88.7% | 3.081 |
| random #3 (seed 20260827) | model | 37 | 940 | 83.0% | 5.108 |
| random #3 (seed 20260827) | form | 37 | 962 | 84.9% | 4.514 |
| random #3 (seed 20260827) | priorSeason | 37 | 941 | 83.1% | 5.081 |
| random #3 (seed 20260827) | v4 | 37 | 967 | 85.3% | 4.378 |
| random #4 (seed 20260827) | model | 37 | 525 | 92.4% | 1.108 |
| random #4 (seed 20260827) | form | 37 | 504 | 88.7% | 1.676 |
| random #4 (seed 20260827) | priorSeason | 37 | 396 | 69.7% | 4.595 |
| random #4 (seed 20260827) | v4 | 37 | 524 | 92.3% | 1.135 |

### Is the difference bigger than the noise?

**A mean difference over 38 rounds is not a result on its own.** Measured on the B-011 collision sweep next door (`reports/guards-009.md`, 103 archived gameweeks): a paired per-round difference of +0.59 realised points carried a standard deviation of 0.92, and the per-season sign flipped — −2.41, +2.34, +0.97 across three seasons of the same comparison. A season does not contain enough rounds to resolve effects of a couple of points a week.

So each row below is **paired by round** — both predictors faced the same fixtures, blanks and hauls, so the round-to-round variance that dominates the totals cancels — and carries the standard error of that pairing. "Clears noise" is |mean| > 2 standard errors, which is a crude bar and is meant to be.

| Squad | comparison | rounds | mean difference | ± s.e. | clears noise |
|---|---|---:|---:|---:|---|
| template (most-owned legal fifteen) | model − form | 37 | -1.89 | 0.89 | **yes** |
| template (most-owned legal fifteen) | model − priorSeason | 37 | -0.84 | 0.83 | no |
| random #1 (seed 20260827) | model − form | 37 | +0.24 | 0.63 | no |
| random #1 (seed 20260827) | model − priorSeason | 37 | +2.16 | 0.48 | **yes** |
| random #2 (seed 20260827) | model − form | 37 | -0.11 | 0.71 | no |
| random #2 (seed 20260827) | model − priorSeason | 37 | +0.14 | 0.97 | no |
| random #3 (seed 20260827) | model − form | 37 | -0.59 | 0.60 | no |
| random #3 (seed 20260827) | model − priorSeason | 37 | -0.03 | 0.60 | no |
| random #4 (seed 20260827) | model − form | 37 | +0.57 | 0.37 | no |
| random #4 (seed 20260827) | model − priorSeason | 37 | +3.49 | 0.63 | **yes** |


**1 of 5** model-versus-`form` comparisons clear two standard errors: template (most-owned legal fifteen) (-1.89).

## The simulated season

Each predictor picks its **own** opening fifteen and walks the season under the real rules — one free transfer a round banked to 5, the 50% sell-on fee, auto-substitutions on 0 minutes only, the vice taking the armband when the captain blanks and nobody doubling when both do. **This is the first metric where *which* fifteen you own is part of what is measured**, which is exactly where the ordering advantage should show up if it is real.

**Two of the policies below are deliberately weak, and their totals are floors rather than estimates.** `no-transfer` holds the opening squad for the whole season. `greedy-1ft` takes at most one free transfer a round, on this round's projection, and **never takes a hit**.

**`planner` is not a floor — it is the transfer planner the product actually ships (B-008), walking a season for the first time (B-032).** It plans over a 5-gameweek discounted horizon with the −4 inside the objective, and its horizon is built at each deadline with the accumulators frozen there, never read off a later round's own context. It runs for the model only: `horizonEp` is the model's horizon, and inventing one for a baseline would be the planner competing with itself under another name.

**Chips are unused.** A wildcard or free hit is a transfer policy (B-008); bench boost and triple captain are single-week variance bets needing B-017's distributions. An unused chip is a handicap applied equally to every predictor. A guessed one is a confound.

**`form` cannot choose an opening squad** — it is this season's trailing rounds and there are none at the first deadline. It falls back to last season's points per 90, the only signal knowable then and the charter's own naive baseline, and takes over from round 2. A baseline handed a better opening squad than it could have chosen is not a baseline.

**The season totals below are a reference figure, not a result. Do not read a difference between two of them.** Each is one sample of one path: a single choice made differently in round 3 changes who is owned for the rest of the season, and the total moves by far more than the effects this report is used to argue about. The verdict is the **paired per-round** table in the next section, where both arms face the same fixtures, blanks and hauls and the round-to-round variance cancels. B-039 is why this is stated rather than assumed: before it, two runs of this script over an unchanged database put one arm 165 points apart, and three claims were published off differences smaller than that.

| Policy | Squad picked by | rounds | points (reference) | transfers | hits | final team value |
|---|---|---:|---:|---:|---:|---:|
| no-transfer | model | 37 | 1310 | 0 | 0 | £96.0m |
| no-transfer | form | 37 | 1077 | 0 | 0 | £97.8m |
| no-transfer | priorSeason | 37 | 1038 | 0 | 0 | £97.8m |
| no-transfer | v4 | 37 | 1603 | 0 | 0 | £97.2m |
| no-transfer | template (crowd proxy) | 37 | 1665 | 0 | 0 | £98.2m |
| greedy-1ft | model | 37 | 1765 | 37 | 0 | £95.1m |
| greedy-1ft | form | 37 | 1812 | 37 | 0 | £96.9m |
| greedy-1ft | priorSeason | 37 | 1041 | 4 | 0 | £97.8m |
| greedy-1ft | v4 | 37 | 2002 | 37 | 0 | £97.4m |
| greedy-1ft + chips | model | 37 | 1789 | 37 | 0 | £95.1m |
| greedy-1ft | template (crowd proxy) | 37 | 1896 | 37 | 0 | £97.2m |
| planner | model | 37 | 1787 | 47 | 40 | £96.9m |
| planner (pre-B-024 objective) | model | 37 | 1825 | 49 | 48 | £98.0m |
| planner (no hits) | model | 37 | 1768 | 37 | 0 | £95.9m |

### The verdict — paired by round

**This is the table to read.** The totals above are a reference; these rows are the comparison. Every row is **paired by round** — both arms faced the same fixtures, blanks and hauls, so the round-to-round variance that dominates a season total cancels. "Clears noise" is |mean| > 2 standard errors, a crude bar and meant to be.

**The last column is what the comparison could have detected at all** — 2 × s.e. × rounds, in points of season. A season difference smaller than that number is not a result, whichever way it points. It is printed beside every row rather than left to be worked out, because every argument in this project's register turns on season totals and none of them carried this number (B-030).

**The template comparison is in this table now.** It used to be printed as a bare season difference with no standard error, directly under a paragraph calling it the headline finding — the one comparison in the report exempt from the report's own noise test.

| Policy | comparison | rounds | mean difference | ± s.e. | clears noise | detectable at |
|---|---|---:|---:|---:|---|---:|
| no-transfer | model − form | 37 | +6.30 | 2.42 | **yes** | 179 pts |
| no-transfer | model − priorSeason | 37 | +7.35 | 2.27 | **yes** | 168 pts |
| no-transfer | model − v4 | 37 | -7.92 | 2.78 | **yes** | 206 pts |
| no-transfer | model − template (crowd proxy) | 37 | -9.59 | 1.75 | **yes** | 130 pts |
| greedy-1ft | model − form | 37 | -1.27 | 2.36 | no | 175 pts |
| greedy-1ft | model − priorSeason | 37 | +19.57 | 2.66 | **yes** | 197 pts |
| greedy-1ft | model − v4 | 37 | -6.41 | 3.19 | **yes** | 236 pts |
| greedy-1ft | model − template (crowd proxy) | 37 | -3.54 | 1.47 | **yes** | 108 pts |
| planner | planner − greedy-1ft, same opening fifteen | 37 | +0.59 | 1.54 | no | 114 pts |
| planner (pre-B-024 objective) | pre-B-024 planner − greedy-1ft, same opening fifteen | 37 | +1.62 | 1.57 | no | 116 pts |
| planner | **B-024 − the objective it replaced**, same opening fifteen | 37 | -1.03 | 0.94 | no | 70 pts |

### What the simulated season says

**Held all season, the model's opening fifteen is worth 1310 points against 1077** — a gap of 233 over the season, which clears this comparison's noise floor of 179 points. Note what the `form` row actually is: form cannot pick an opening squad, so that squad was chosen by last season's points per 90.

**Give both a transfer a week.** `form` goes from 1077 to 1812; the model goes from 1310 to 1765, a remaining gap of **-47** — most of the 233 the two started with has closed, which does **not** clear the noise floor. A weekly transfer is a powerful error-correction mechanism, and it corrects a weak opening squad faster than it improves a strong one.

**The crowd's opening fifteen, run under the same policy and the same projections, scores 1896 against the model's 1765 — 131 points better, and the gap clears this comparison's noise floor of 108 points.** The only difference between those two runs is the opening squad, so this is a defect in the squad solve rather than a season's luck. It is a proxy for the FPL average rather than the average itself, and it is not a flattering one.

The next question is not "is the model better" but **"why is a squad built from its own projections worse than the crowd's"**. **B-031** is the measurement that could name a cause — it A/Bs the current squad objective against the all-fifteen-equal one it replaced, on this same season, where both arms hold mostly the same players and the pairing is tight enough to resolve an effect this size. **B-013**'s per-component tables say which term feeds it.

**The transfer planner the product actually ships has now walked a season, for the first time.** It scores 1787 against `greedy-1ft`'s 1765 from **the same opening fifteen** — 22 ahead, against a noise floor of 114 points, which it does not clear. It made 47 transfers and paid 40 points in hits, so the −4 path is exercised by a walked season rather than by a unit test alone.

**B-024 — the planner and the recommendation now optimise one objective — costs 38 points of season against the objective it replaced, at a floor of 70.** That does not clear the floor: on points this change is neither better nor worse, and the report will not pretend otherwise. What it does change is checkable rather than measurable — the plan and the recommendation agree about who starts and who takes the armband, which they need not have before and which nothing checked. The two arms start from the identical fifteen, so nothing but the planner's objective separates them.

**The bar B-012 set was: beat `form` on ordering AND on simulated season points, or say plainly that we did not.** Ordering: yes, on points captured at every k. Season points, once both sides may transfer: no — the difference does not clear the noise floor.

**Both halves of the bar are not met on this run.** A model version is adopted or retired in `docs/decisions.md`, never by this file — what this report supplies is the number that decision needs, and on this run that number does not support adopting a version on season points. The serving version is not deleted either way: B-007 (D-020) established that rule and it holds whatever a run says.


### The baseline that does not exist

**The real FPL average is unavailable for archive seasons.** `Gameweek.averageScore` exists for the live season only, upstream serves no past season's `bootstrap-static`, and the archive carries no per-round average. The **template squad** row above — the legal fifteen maximising ownership, held under the same policy — is the closest thing available and is a **proxy**, not the average. Recording the absence rather than quietly dropping it: an unavailable baseline left out of a table reads as a baseline that was beaten.

## Still to come in this report

B-012's phases are complete. What is **not** measured here, and is named rather than implied: the transfer planner the product actually ships (B-032 wires it in as a policy), the squad objective against the one it replaced (B-031), chips, uncertainty on any projection (B-017), and the per-component calibration that would say *which* term drives what is measured here (B-013).

Nothing was written to `projections` — asserted, not assumed.
