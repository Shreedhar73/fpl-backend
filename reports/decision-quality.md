# Decision quality — fitted

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
| model | 37 | 0.528 | 35.3% | 12.3% | 38.5% | 15.7% | 42.0% | 21.2% |
| form | 37 | 0.574 | 33.5% | 11.5% | 34.5% | 12.6% | 40.1% | 20.1% |
| priorSeason | 37 | 0.052 | 12.6% | 2.5% | 17.3% | 5.9% | 22.8% | 11.7% |
| v4 | 37 | 0.629 | 40.0% | 14.3% | 40.3% | 18.6% | 46.0% | 25.7% |

### top 100 by price

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.497 | 45.9% | 26.5% | 46.3% | 29.4% | 62.1% | 50.2% |
| form | 37 | 0.544 | 42.9% | 22.4% | 47.1% | 28.8% | 61.1% | 49.1% |
| priorSeason | 37 | -0.024 | 24.9% | 13.3% | 26.0% | 16.4% | 36.4% | 28.6% |
| v4 | 37 | 0.602 | 47.9% | 29.7% | 50.1% | 32.4% | 64.3% | 51.7% |

### top 100 by predicted

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.135 | 38.6% | 18.9% | 42.8% | 24.0% | 49.5% | 36.6% |
| form | 37 | 0.081 | 37.8% | 18.7% | 39.4% | 20.5% | 48.7% | 35.3% |
| priorSeason | 37 | 0.023 | 16.1% | 9.1% | 23.3% | 16.0% | 37.5% | 38.6% |
| v4 | 37 | 0.120 | 43.5% | 24.1% | 44.4% | 25.8% | 53.1% | 37.7% |

## What the ordering says

Against `form`, over the whole field: Spearman **0.528** against **0.574**, and points captured @11 **35.3%** against **33.5%**.

**A split, and the split is the finding.** `form` orders the *whole field* better, and this model captures more points in the *top k* at every k measured. Those are not in conflict: a whole-field rank correlation is dominated by the mass of players who score nothing, which `form` ranks well by predicting nothing for them — and a squad optimiser never chooses between two players who will both blank. It chooses at the top, which is what points-captured@k measures. **On the part of the ranking the product uses, the model is ahead.**

That is a claim about ordering, not about points. It becomes a claim about points when the season simulation lands (Phases 3–4), and not before.

`priorSeason` is far behind on every measure, which is the sanity check on the metric itself: a baseline that cannot see this season should not rank this season's rounds.

## v4 against the bar (B-036)

The gradient-boosted candidate — one XGBoost per position over 1/3/5/10/38-match window features, the OpenFPL recipe — scored on the same rows as every other predictor. **The bar below was committed to the register before the first training run**, so it cannot have been written to fit the numbers. Known handicap, stated: the archive carries no per-gameweek availability, so v4 trains without OpenFPL's match-status features — the same ceiling the incumbent lives under (B-015).

Population for the ordering comparison: **29482** rows both could score. Spearman v4 **0.713** vs incumbent **0.664**.

| category | n | v4 RMSE | incumbent RMSE | form RMSE |
|---|---:|---:|---:|---:|
| Zeros | 17753 | 0.729 | 0.989 | 0.879 |
| Blanks | 7062 | 1.374 | 1.445 | 2.144 |
| Tickers | 1645 | 1.506 | 1.413 | 2.068 |
| Haulers | 2445 | 5.765 | 5.766 | 5.652 |

**Ordering — beat the incumbent on points captured at every k:** @11 37.5% vs 32.7%, @15 39.2% vs 36.1%, @30 41.6% vs 38.0% — **met**.

**High-return accuracy — improve Tickers and Haulers:** Tickers 1.516 vs 1.421 (n=1690), Haulers 5.766 vs 5.765 (n=2506) — **not met**.

**Low-return accuracy — no material (>5%) degradation:** Zeros 0.742 vs 0.996 (n=18073), Blanks 1.367 vs 1.440 (n=7213) — **held**.

**The bar is not met on this run.** `modelVersion` does not move. The named next step is feature enrichment — the Understat/vaastav groups OpenFPL uses that the archive lacks (I/C/T split, xGChain, xGBuildup, key passes, team Deep and PPDA) — and the negative result stands in this report rather than being rerun until it passes.

## The XI and the armband

Every predictor is handed **the same fifteen players** and picks an XI, a bench order and a captain from them. If each picked its own squad the XI comparison would be confounded by the squad comparison, and a model could field a worse XI out of a better fifteen and look better for it.

The squads are chosen once, at **round 1**, by rules that read no model: the **template** is the legal fifteen maximising `selectedBy` — an integer program, because the top fifteen by ownership breaks the position quotas, the three-per-club cap and the budget all at once — plus **4 seeded random legal squads** (seed `20260827`) so the verdict does not rest on one squad's quirks.

**XI efficiency** is the share of the points that squad *could* have delivered that the predictor's selections actually took — so squads of different quality can be read side by side. **Captain regret** is the mean gap per round between the best realised score among the players fielded and the captain's; a bench player's haul is an XI decision, not an armband one, so it is deliberately not in the denominator.

**The squads are built at round 1 and scored from round 2.** `form` has no trailing round at a season's first deadline, so round 1 is absent from the comparison population entirely — which means the squads are picked at opening-day prices and opening-day ownership, before a round of transfers has moved the crowd, and the season measured here is 37 rounds rather than 38.

| Squad | Predictor | rounds | points | XI efficiency | captain regret |
|---|---|---:|---:|---:|---:|
| template (most-owned legal fifteen) | model | 37 | 1717 | 85.9% | 6.162 |
| template (most-owned legal fifteen) | form | 37 | 1731 | 86.6% | 6.162 |
| template (most-owned legal fifteen) | priorSeason | 37 | 1696 | 84.8% | 7.081 |
| template (most-owned legal fifteen) | v4 | 37 | 1734 | 86.7% | 6.297 |
| random #1 (seed 20260827) | model | 37 | 495 | 85.5% | 2.081 |
| random #1 (seed 20260827) | form | 37 | 505 | 87.2% | 1.811 |
| random #1 (seed 20260827) | priorSeason | 37 | 455 | 78.6% | 3.162 |
| random #1 (seed 20260827) | v4 | 37 | 484 | 83.6% | 2.378 |
| random #2 (seed 20260827) | model | 37 | 989 | 83.5% | 5.216 |
| random #2 (seed 20260827) | form | 37 | 995 | 84.0% | 5.054 |
| random #2 (seed 20260827) | priorSeason | 37 | 1031 | 87.0% | 4.081 |
| random #2 (seed 20260827) | v4 | 37 | 995 | 84.0% | 5.054 |
| random #3 (seed 20260827) | model | 37 | 740 | 83.1% | 4.081 |
| random #3 (seed 20260827) | form | 37 | 775 | 87.0% | 3.135 |
| random #3 (seed 20260827) | priorSeason | 37 | 778 | 87.3% | 3.054 |
| random #3 (seed 20260827) | v4 | 37 | 775 | 87.0% | 3.135 |
| random #4 (seed 20260827) | model | 37 | 980 | 83.8% | 5.000 |
| random #4 (seed 20260827) | form | 37 | 963 | 82.4% | 5.459 |
| random #4 (seed 20260827) | priorSeason | 37 | 977 | 83.6% | 5.081 |
| random #4 (seed 20260827) | v4 | 37 | 980 | 83.8% | 5.000 |

### Is the difference bigger than the noise?

**A mean difference over 38 rounds is not a result on its own.** Measured on the B-011 collision sweep next door (`reports/guards-009.md`, 103 archived gameweeks): a paired per-round difference of +0.59 realised points carried a standard deviation of 0.92, and the per-season sign flipped — −2.41, +2.34, +0.97 across three seasons of the same comparison. A season does not contain enough rounds to resolve effects of a couple of points a week.

So each row below is **paired by round** — both predictors faced the same fixtures, blanks and hauls, so the round-to-round variance that dominates the totals cancels — and carries the standard error of that pairing. "Clears noise" is |mean| > 2 standard errors, which is a crude bar and is meant to be.

| Squad | comparison | rounds | mean difference | ± s.e. | clears noise |
|---|---|---:|---:|---:|---|
| template (most-owned legal fifteen) | model − form | 37 | -0.38 | 0.84 | no |
| template (most-owned legal fifteen) | model − priorSeason | 37 | +0.57 | 0.89 | no |
| random #1 (seed 20260827) | model − form | 37 | -0.27 | 0.33 | no |
| random #1 (seed 20260827) | model − priorSeason | 37 | +1.08 | 0.63 | no |
| random #2 (seed 20260827) | model − form | 37 | -0.16 | 0.68 | no |
| random #2 (seed 20260827) | model − priorSeason | 37 | -1.14 | 0.56 | **yes** |
| random #3 (seed 20260827) | model − form | 37 | -0.95 | 0.46 | **yes** |
| random #3 (seed 20260827) | model − priorSeason | 37 | -1.03 | 0.65 | no |
| random #4 (seed 20260827) | model − form | 37 | +0.46 | 0.73 | no |
| random #4 (seed 20260827) | model − priorSeason | 37 | +0.08 | 0.65 | no |


**1 of 5** model-versus-`form` comparisons clear two standard errors: random #3 (seed 20260827) (-0.95).

## The simulated season

Each predictor picks its **own** opening fifteen and walks the season under the real rules — one free transfer a round banked to 5, the 50% sell-on fee, auto-substitutions on 0 minutes only, the vice taking the armband when the captain blanks and nobody doubling when both do. **This is the first metric where *which* fifteen you own is part of what is measured**, which is exactly where the ordering advantage should show up if it is real.

**Two of the policies below are deliberately weak, and their totals are floors rather than estimates.** `no-transfer` holds the opening squad for the whole season. `greedy-1ft` takes at most one free transfer a round, on this round's projection, and **never takes a hit**.

**`planner` is not a floor — it is the transfer planner the product actually ships (B-008), walking a season for the first time (B-032).** It plans over a 5-gameweek discounted horizon with the −4 inside the objective, and its horizon is built at each deadline with the accumulators frozen there, never read off a later round's own context. It runs for the model only: `horizonEp` is the model's horizon, and inventing one for a baseline would be the planner competing with itself under another name.

**Chips are unused.** A wildcard or free hit is a transfer policy (B-008); bench boost and triple captain are single-week variance bets needing B-017's distributions. An unused chip is a handicap applied equally to every predictor. A guessed one is a confound.

**`form` cannot choose an opening squad** — it is this season's trailing rounds and there are none at the first deadline. It falls back to last season's points per 90, the only signal knowable then and the charter's own naive baseline, and takes over from round 2. A baseline handed a better opening squad than it could have chosen is not a baseline.

| Policy | Squad picked by | rounds | **points** | transfers | hits | final team value |
|---|---|---:|---:|---:|---:|---:|
| no-transfer | model | 37 | **1635** | 0 | 0 | £98.9m |
| no-transfer | form | 37 | **1086** | 0 | 0 | £97.8m |
| no-transfer | priorSeason | 37 | **1034** | 0 | 0 | £97.8m |
| no-transfer | v4 | 37 | **1395** | 0 | 0 | £98.1m |
| no-transfer | template (crowd proxy) | 37 | **1717** | 0 | 0 | £98.2m |
| greedy-1ft | model | 37 | **1881** | 37 | 0 | £97.5m |
| greedy-1ft | form | 37 | **1761** | 37 | 0 | £97.5m |
| greedy-1ft | priorSeason | 37 | **1037** | 4 | 0 | £97.8m |
| greedy-1ft | v4 | 37 | **1779** | 37 | 0 | £95.1m |
| greedy-1ft | template (crowd proxy) | 37 | **1928** | 37 | 0 | £97.8m |
| planner | model | 37 | **1814** | 48 | 44 | £97.4m |
| planner (pre-B-024 objective) | model | 37 | **1846** | 47 | 40 | £98.8m |

### Is the difference bigger than the noise?

Every row is **paired by round** — both arms faced the same fixtures, blanks and hauls, so the round-to-round variance that dominates a season total cancels. "Clears noise" is |mean| > 2 standard errors, a crude bar and meant to be.

**The last column is what the comparison could have detected at all** — 2 × s.e. × rounds, in points of season. A season difference smaller than that number is not a result, whichever way it points. It is printed beside every row rather than left to be worked out, because every argument in this project's register turns on season totals and none of them carried this number (B-030).

**The template comparison is in this table now.** It used to be printed as a bare season difference with no standard error, directly under a paragraph calling it the headline finding — the one comparison in the report exempt from the report's own noise test.

| Policy | comparison | rounds | mean difference | ± s.e. | clears noise | detectable at |
|---|---|---:|---:|---:|---|---:|
| no-transfer | model − form | 37 | +14.84 | 2.74 | **yes** | 203 pts |
| no-transfer | model − priorSeason | 37 | +16.24 | 2.67 | **yes** | 198 pts |
| no-transfer | model − template (crowd proxy) | 37 | -2.22 | 2.77 | no | 205 pts |
| greedy-1ft | model − form | 37 | +3.24 | 2.60 | no | 192 pts |
| greedy-1ft | model − priorSeason | 37 | +22.81 | 2.86 | **yes** | 212 pts |
| greedy-1ft | model − template (crowd proxy) | 37 | -1.27 | 2.11 | no | 156 pts |
| planner | planner − greedy-1ft, same opening fifteen | 37 | -1.81 | 2.26 | no | 167 pts |
| planner (pre-B-024 objective) | pre-B-024 planner − greedy-1ft, same opening fifteen | 37 | -0.95 | 1.51 | no | 112 pts |
| planner | **B-024 − the objective it replaced**, same opening fifteen | 37 | -0.86 | 1.54 | no | 114 pts |

### What the simulated season says

**Held all season, the model's opening fifteen is worth 1635 points against 1086** — a gap of 549 over the season, which clears this comparison's noise floor of 203 points. Note what the `form` row actually is: form cannot pick an opening squad, so that squad was chosen by last season's points per 90.

**Give both a transfer a week.** `form` goes from 1086 to 1761; the model goes from 1635 to 1881, a remaining gap of **120** — most of the 549 the two started with has closed, which does **not** clear the noise floor. A weekly transfer is a powerful error-correction mechanism, and it corrects a weak opening squad faster than it improves a strong one.

**The crowd's opening fifteen scores 1928 against the model's 1881 — 47 points better. That difference does NOT clear this comparison's own noise floor of 156 points.** This report used to call the same number its headline finding and print it with no standard error at all. The number is unchanged; what can be concluded from it is not.

So the next question is not "why is our squad worse" — it is **whether it is worse at all**, and this instrument cannot say. More archived seasons buy √n: three would take a 156-point floor to roughly 90, still not enough. Power for a difference this size comes from **pairing arms that hold the same players**, which is what **B-031** does.

**The transfer planner the product actually ships has now walked a season, for the first time.** It scores 1814 against `greedy-1ft`'s 1881 from **the same opening fifteen** — 67 behind, against a noise floor of 167 points, which it does not clear. It made 48 transfers and paid 44 points in hits, so the −4 path is exercised by a walked season rather than by a unit test alone.

**Read that against what it paid.** The planner is 67 points behind a policy that takes one free transfer a week on this round's number and never takes a hit, having spent 44 points on hits to get there. Both arms started from the identical fifteen and saw the identical predictions, so nothing but the policy separates them. The planner optimises a five-round discounted horizon and the baseline optimises this week; on this season, looking further ahead and paying for the privilege did not pay.

**B-024 — the planner and the recommendation now optimise one objective — costs 32 points of season against the objective it replaced, at a floor of 114.** That does not clear the floor: on points this change is neither better nor worse, and the report will not pretend otherwise. What it does change is checkable rather than measurable — the plan and the recommendation agree about who starts and who takes the armband, which they need not have before and which nothing checked. The two arms start from the identical fifteen, so nothing but the planner's objective separates them.

**The bar B-012 set was: beat `form` on ordering AND on simulated season points, or say plainly that we did not.** Ordering: yes, on points captured at every k. Season points, once both sides may transfer: no — the difference does not clear the noise floor.

**Both halves of the bar are not met on this run.** A model version is adopted or retired in `docs/decisions.md`, never by this file — what this report supplies is the number that decision needs, and on this run that number does not support adopting a version on season points. The serving version is not deleted either way: B-007 (D-020) established that rule and it holds whatever a run says.


### The baseline that does not exist

**The real FPL average is unavailable for archive seasons.** `Gameweek.averageScore` exists for the live season only, upstream serves no past season's `bootstrap-static`, and the archive carries no per-round average. The **template squad** row above — the legal fifteen maximising ownership, held under the same policy — is the closest thing available and is a **proxy**, not the average. Recording the absence rather than quietly dropping it: an unavailable baseline left out of a table reads as a baseline that was beaten.

## Still to come in this report

B-012's phases are complete. What is **not** measured here, and is named rather than implied: the transfer planner the product actually ships (B-032 wires it in as a policy), the squad objective against the one it replaced (B-031), chips, uncertainty on any projection (B-017), and the per-component calibration that would say *which* term drives what is measured here (B-013).

Nothing was written to `projections` — asserted, not assumed.
