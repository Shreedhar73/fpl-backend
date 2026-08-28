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
| model | 37 | 0.663 | 36.7% | 12.0% | 39.7% | 15.9% | 44.2% | 22.8% |
| form | 37 | 0.574 | 33.6% | 10.8% | 34.8% | 13.2% | 40.2% | 19.9% |
| priorSeason | 37 | 0.052 | 12.6% | 3.2% | 17.3% | 6.3% | 22.8% | 11.4% |
| v4 | 37 | 0.628 | 40.1% | 16.7% | 40.6% | 18.2% | 45.5% | 25.6% |

### top 100 by price

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.661 | 49.0% | 27.8% | 50.5% | 31.9% | 65.6% | 53.5% |
| form | 37 | 0.548 | 43.4% | 22.9% | 47.3% | 28.8% | 61.1% | 49.3% |
| priorSeason | 37 | -0.017 | 25.0% | 13.3% | 26.2% | 16.6% | 36.6% | 28.8% |
| v4 | 37 | 0.612 | 48.9% | 30.0% | 51.0% | 33.2% | 64.8% | 52.5% |

### top 100 by predicted

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.144 | 39.7% | 17.0% | 43.6% | 23.4% | 51.3% | 36.8% |
| form | 37 | 0.090 | 37.8% | 18.4% | 39.7% | 21.4% | 48.8% | 36.0% |
| priorSeason | 37 | 0.023 | 16.1% | 9.1% | 23.3% | 16.0% | 37.5% | 38.6% |
| v4 | 37 | 0.123 | 43.4% | 22.9% | 44.4% | 26.5% | 52.2% | 37.7% |

## What the ordering says

Against `form`, over the whole field: Spearman **0.663** against **0.574**, and points captured @11 **36.7%** against **33.6%**.

**Beats `form` on rank correlation and on points captured at every k.**

`priorSeason` is far behind on every measure, which is the sanity check on the metric itself: a baseline that cannot see this season should not rank this season's rounds.

## v4 against the bar (B-036)

The gradient-boosted candidate — one XGBoost per position over 1/3/5/10/38-match window features, the OpenFPL recipe — scored on the same rows as every other predictor. **The bar below was committed to the register before the first training run**, so it cannot have been written to fit the numbers. Known handicap, stated: the archive carries no per-gameweek availability, so v4 trains without OpenFPL's match-status features — the same ceiling the incumbent lives under (B-015).

Population for the ordering comparison: **29482** rows both could score. Spearman v4 **0.712** vs incumbent **0.740**.

**Two populations, named so the columns are not cross-read** (B-012 invariant 3): the v4-vs-incumbent columns and their paired noise are on the rows BOTH could score; the `form` column is on the smaller three-way intersection and is context, not a leg of the bar. "paired Δse" is the per-round-paired difference in squared error (v4 − incumbent): negative favours v4, and a difference that does not clear two standard errors is not a result — the same rule every season comparison in this report obeys (B-030).

| category | n | v4 RMSE | incumbent RMSE | paired Δse ± s.e. | clears | form RMSE (3-way, n) |
|---|---:|---:|---:|---:|---|---:|
| Zeros | 18073 | 0.753 | 0.671 | +0.124 ± 0.023 | **yes** | 0.879 (17753) |
| Blanks | 7213 | 1.419 | 1.368 | +0.147 ± 0.070 | **yes** | 2.144 (7062) |
| Tickers | 1690 | 1.475 | 1.476 | -0.011 ± 0.051 | no | 2.068 (1645) |
| Haulers | 2506 | 5.697 | 5.851 | -1.777 ± 0.335 | **yes** | 5.652 (2445) |

**Ordering — beat the incumbent on points captured at every k:** @11 38.3% vs 34.0%, @15 38.6% vs 36.6%, @30 41.4% vs 40.2% — **met**.

**High-return accuracy — improve Tickers and Haulers:** Tickers 1.475 vs 1.476 (n=1690, inside its paired noise), Haulers 5.697 vs 5.851 (n=2506, clears its paired noise) — **met**.

**Low-return accuracy — no material (>5%) degradation:** Zeros 0.753 vs 0.671 (n=18073, clears its paired noise), Blanks 1.419 vs 1.368 (n=7213, clears its paired noise) — **not held**.

**The bar is not met, and the archive holdout is retired.** `modelVersion` does not move. This cycle measured the direct fit, the residual-on-incumbent fit, and finally the composite — per-position blend weights chosen on VALIDATE by a bar-shaped rule, its one TEST reading pre-registered as final. The composite came one leg short: ordering met at every k, low-return held, Haulers improved inside its noise — and the Tickers regression, halved from the direct fit's, still clears its paired noise. No member of this family passes all three legs on this holdout, and the holdout has now been read too often to referee further selection. The next verdict comes from the untouched prospective holdout accumulating on its own — the live 2026-27 season, scored week by week by `pnpm score:gameweek` (B-016) for the incumbent and the candidate alike. Enrichment stays blocked at the source (probed 2026-08-27). All recorded in B-037.

## The XI and the armband

Every predictor is handed **the same fifteen players** and picks an XI, a bench order and a captain from them. If each picked its own squad the XI comparison would be confounded by the squad comparison, and a model could field a worse XI out of a better fifteen and look better for it.

The squads are chosen once, at **round 1**, by rules that read no model: the **template** is the legal fifteen maximising `selectedBy` — an integer program, because the top fifteen by ownership breaks the position quotas, the three-per-club cap and the budget all at once — plus **4 seeded random legal squads** (seed `20260827`) so the verdict does not rest on one squad's quirks.

**XI efficiency** is the share of the points that squad *could* have delivered that the predictor's selections actually took — so squads of different quality can be read side by side. **Captain regret** is the mean gap per round between the best realised score among the players fielded and the captain's; a bench player's haul is an XI decision, not an armband one, so it is deliberately not in the denominator.

**The squads are built at round 1 and scored from round 2.** `form` has no trailing round at a season's first deadline, so round 1 is absent from the comparison population entirely — which means the squads are picked at opening-day prices and opening-day ownership, before a round of transfers has moved the crowd, and the season measured here is 37 rounds rather than 38.

| Squad | Predictor | rounds | points | XI efficiency | captain regret |
|---|---|---:|---:|---:|---:|
| template (most-owned legal fifteen) | model | 37 | 1709 | 85.5% | 6.378 |
| template (most-owned legal fifteen) | form | 37 | 1735 | 86.8% | 6.162 |
| template (most-owned legal fifteen) | priorSeason | 37 | 1696 | 84.8% | 7.081 |
| template (most-owned legal fifteen) | v4 | 37 | 1738 | 86.9% | 6.162 |
| random #1 (seed 20260827) | model | 37 | 749 | 89.6% | 2.243 |
| random #1 (seed 20260827) | form | 37 | 714 | 85.4% | 3.189 |
| random #1 (seed 20260827) | priorSeason | 37 | 643 | 76.9% | 5.108 |
| random #1 (seed 20260827) | v4 | 37 | 738 | 88.3% | 2.541 |
| random #2 (seed 20260827) | model | 37 | 875 | 87.1% | 3.514 |
| random #2 (seed 20260827) | form | 37 | 872 | 86.8% | 3.595 |
| random #2 (seed 20260827) | priorSeason | 37 | 863 | 85.9% | 3.838 |
| random #2 (seed 20260827) | v4 | 37 | 876 | 87.2% | 3.486 |
| random #3 (seed 20260827) | model | 37 | 957 | 84.5% | 4.649 |
| random #3 (seed 20260827) | form | 37 | 962 | 84.9% | 4.514 |
| random #3 (seed 20260827) | priorSeason | 37 | 941 | 83.1% | 5.081 |
| random #3 (seed 20260827) | v4 | 37 | 986 | 87.0% | 3.865 |
| random #4 (seed 20260827) | model | 37 | 507 | 89.3% | 1.595 |
| random #4 (seed 20260827) | form | 37 | 504 | 88.7% | 1.676 |
| random #4 (seed 20260827) | priorSeason | 37 | 396 | 69.7% | 4.595 |
| random #4 (seed 20260827) | v4 | 37 | 511 | 90.0% | 1.486 |

### Is the difference bigger than the noise?

**A mean difference over 38 rounds is not a result on its own.** Measured on the B-011 collision sweep next door (`reports/guards-009.md`, 103 archived gameweeks): a paired per-round difference of +0.59 realised points carried a standard deviation of 0.92, and the per-season sign flipped — −2.41, +2.34, +0.97 across three seasons of the same comparison. A season does not contain enough rounds to resolve effects of a couple of points a week.

So each row below is **paired by round** — both predictors faced the same fixtures, blanks and hauls, so the round-to-round variance that dominates the totals cancels — and carries the standard error of that pairing. "Clears noise" is |mean| > 2 standard errors, which is a crude bar and is meant to be.

| Squad | comparison | rounds | mean difference | ± s.e. | clears noise |
|---|---|---:|---:|---:|---|
| template (most-owned legal fifteen) | model − form | 37 | -0.70 | 0.74 | no |
| template (most-owned legal fifteen) | model − priorSeason | 37 | +0.35 | 0.79 | no |
| random #1 (seed 20260827) | model − form | 37 | +0.95 | 0.53 | no |
| random #1 (seed 20260827) | model − priorSeason | 37 | +2.86 | 0.53 | **yes** |
| random #2 (seed 20260827) | model − form | 37 | +0.08 | 0.68 | no |
| random #2 (seed 20260827) | model − priorSeason | 37 | +0.32 | 0.21 | no |
| random #3 (seed 20260827) | model − form | 37 | -0.14 | 0.62 | no |
| random #3 (seed 20260827) | model − priorSeason | 37 | +0.43 | 0.67 | no |
| random #4 (seed 20260827) | model − form | 37 | +0.08 | 0.35 | no |
| random #4 (seed 20260827) | model − priorSeason | 37 | +3.00 | 0.62 | **yes** |


**Nothing here separates the predictors.** Not one model-versus-`form` comparison clears two standard errors, and the sign of the difference flips across squads (3 of 5 positive). **This is a null result and it is reported as one** — the model does not make measurably better XI and captain decisions than `form` over one season, on any of these fifteens.

That is not a contradiction of the ordering section above, and it is worth being precise about why. Given a **fixed** fifteen, most of the XI picks itself: the decisions left are a handful of marginal calls at the bench boundary and the armband, which is a much smaller surface than ranking six hundred players. The ordering advantage is real and this is the wrong instrument to see it with — **it shows up in which fifteen you own, not in how you arrange the fifteen you already have.** Testing that needs the transfers, which is Phase 3.

## The simulated season

Each predictor picks its **own** opening fifteen and walks the season under the real rules — one free transfer a round banked to 5, the 50% sell-on fee, auto-substitutions on 0 minutes only, the vice taking the armband when the captain blanks and nobody doubling when both do. **This is the first metric where *which* fifteen you own is part of what is measured**, which is exactly where the ordering advantage should show up if it is real.

**Two of the policies below are deliberately weak, and their totals are floors rather than estimates.** `no-transfer` holds the opening squad for the whole season. `greedy-1ft` takes at most one free transfer a round, on this round's projection, and **never takes a hit**.

**`planner` is not a floor — it is the transfer planner the product actually ships (B-008), walking a season for the first time (B-032).** It plans over a 5-gameweek discounted horizon with the −4 inside the objective, and its horizon is built at each deadline with the accumulators frozen there, never read off a later round's own context. It runs for the model only: `horizonEp` is the model's horizon, and inventing one for a baseline would be the planner competing with itself under another name.

**Chips are unused.** A wildcard or free hit is a transfer policy (B-008); bench boost and triple captain are single-week variance bets needing B-017's distributions. An unused chip is a handicap applied equally to every predictor. A guessed one is a confound.

**`form` cannot choose an opening squad** — it is this season's trailing rounds and there are none at the first deadline. It falls back to last season's points per 90, the only signal knowable then and the charter's own naive baseline, and takes over from round 2. A baseline handed a better opening squad than it could have chosen is not a baseline.

**The season totals below are a reference figure, not a result. Do not read a difference between two of them.** Each is one sample of one path: a single choice made differently in round 3 changes who is owned for the rest of the season, and the total moves by far more than the effects this report is used to argue about. The verdict is the **paired per-round** table in the next section, where both arms face the same fixtures, blanks and hauls and the round-to-round variance cancels. B-039 is why this is stated rather than assumed: before it, two runs of this script over an unchanged database put one arm 165 points apart, and three claims were published off differences smaller than that.

| Policy | Squad picked by | rounds | points (reference) | transfers | hits | final team value |
|---|---|---:|---:|---:|---:|---:|
| no-transfer | model | 37 | 1394 | 0 | 0 | £96.2m |
| no-transfer | form | 37 | 1077 | 0 | 0 | £97.8m |
| no-transfer | priorSeason | 37 | 1038 | 0 | 0 | £97.8m |
| no-transfer | v4 | 37 | 1786 | 0 | 0 | £97.6m |
| no-transfer | template (crowd proxy) | 37 | 1709 | 0 | 0 | £98.2m |
| greedy-1ft | model | 37 | 1787 | 37 | 0 | £95.7m |
| greedy-1ft | form | 37 | 1810 | 37 | 0 | £96.9m |
| greedy-1ft | priorSeason | 37 | 1041 | 4 | 0 | £97.8m |
| greedy-1ft | v4 | 37 | 2010 | 37 | 0 | £97.2m |
| greedy-1ft + chips | model | 37 | 1798 | 37 | 0 | £95.7m |
| greedy-1ft | template (crowd proxy) | 37 | 1893 | 37 | 0 | £97.9m |
| planner | model | 37 | 1943 | 48 | 44 | £99.3m |
| planner (pre-B-024 objective) | model | 37 | 1848 | 49 | 48 | £98.9m |
| planner (no hits) | model | 37 | 1839 | 37 | 0 | £96.6m |

### The verdict — paired by round

**This is the table to read.** The totals above are a reference; these rows are the comparison. Every row is **paired by round** — both arms faced the same fixtures, blanks and hauls, so the round-to-round variance that dominates a season total cancels. "Clears noise" is |mean| > 2 standard errors, a crude bar and meant to be.

**The last column is what the comparison could have detected at all** — 2 × s.e. × rounds, in points of season. A season difference smaller than that number is not a result, whichever way it points. It is printed beside every row rather than left to be worked out, because every argument in this project's register turns on season totals and none of them carried this number (B-030).

**The template comparison is in this table now.** It used to be printed as a bare season difference with no standard error, directly under a paragraph calling it the headline finding — the one comparison in the report exempt from the report's own noise test.

| Policy | comparison | rounds | mean difference | ± s.e. | clears noise | detectable at |
|---|---|---:|---:|---:|---|---:|
| no-transfer | model − form | 37 | +8.57 | 2.40 | **yes** | 178 pts |
| no-transfer | model − priorSeason | 37 | +9.62 | 2.27 | **yes** | 168 pts |
| no-transfer | model − v4 | 37 | -10.59 | 2.46 | **yes** | 182 pts |
| no-transfer | model − template (crowd proxy) | 37 | -8.51 | 2.35 | **yes** | 174 pts |
| greedy-1ft | model − form | 37 | -0.62 | 2.80 | no | 208 pts |
| greedy-1ft | model − priorSeason | 37 | +20.16 | 2.77 | **yes** | 205 pts |
| greedy-1ft | model − v4 | 37 | -6.03 | 2.64 | **yes** | 195 pts |
| greedy-1ft | model − template (crowd proxy) | 37 | -2.86 | 1.76 | no | 130 pts |
| planner | planner − greedy-1ft, same opening fifteen | 37 | +4.22 | 1.91 | **yes** | 141 pts |
| planner (pre-B-024 objective) | pre-B-024 planner − greedy-1ft, same opening fifteen | 37 | +1.65 | 1.98 | no | 146 pts |
| planner | **B-024 − the objective it replaced**, same opening fifteen | 37 | +2.57 | 1.39 | no | 103 pts |

### What the simulated season says

**Held all season, the model's opening fifteen is worth 1394 points against 1077** — a gap of 317 over the season, which clears this comparison's noise floor of 178 points. Note what the `form` row actually is: form cannot pick an opening squad, so that squad was chosen by last season's points per 90.

**Give both a transfer a week.** `form` goes from 1077 to 1810; the model goes from 1394 to 1787, a remaining gap of **-23** — most of the 317 the two started with has closed, which does **not** clear the noise floor. A weekly transfer is a powerful error-correction mechanism, and it corrects a weak opening squad faster than it improves a strong one.

**The crowd's opening fifteen scores 1893 against the model's 1787 — 106 points better. That difference does NOT clear this comparison's own noise floor of 130 points.** This report used to call the same number its headline finding and print it with no standard error at all. The number is unchanged; what can be concluded from it is not.

So the next question is not "why is our squad worse" — it is **whether it is worse at all**, and this instrument cannot say. More archived seasons buy √n: three would take a 130-point floor to roughly 75, still not enough. Power for a difference this size comes from **pairing arms that hold the same players**, which is what **B-031** does.

**The transfer planner the product actually ships has now walked a season, for the first time.** It scores 1943 against `greedy-1ft`'s 1787 from **the same opening fifteen** — 156 ahead, against a noise floor of 141 points, which it clears. It made 48 transfers and paid 44 points in hits, so the −4 path is exercised by a walked season rather than by a unit test alone.

**B-024 — the planner and the recommendation now optimise one objective — costs nothing; it gains 95 points of season against the objective it replaced, at a floor of 103.** That does not clear the floor: on points this change is neither better nor worse, and the report will not pretend otherwise. What it does change is checkable rather than measurable — the plan and the recommendation agree about who starts and who takes the armband, which they need not have before and which nothing checked. The two arms start from the identical fifteen, so nothing but the planner's objective separates them.

**The bar B-012 set was: beat `form` on ordering AND on simulated season points, or say plainly that we did not.** Ordering: yes, on points captured at every k. Season points, once both sides may transfer: no — the difference does not clear the noise floor.

**Both halves of the bar are not met on this run.** A model version is adopted or retired in `docs/decisions.md`, never by this file — what this report supplies is the number that decision needs, and on this run that number does not support adopting a version on season points. The serving version is not deleted either way: B-007 (D-020) established that rule and it holds whatever a run says.


### The baseline that does not exist

**The real FPL average is unavailable for archive seasons.** `Gameweek.averageScore` exists for the live season only, upstream serves no past season's `bootstrap-static`, and the archive carries no per-round average. The **template squad** row above — the legal fifteen maximising ownership, held under the same policy — is the closest thing available and is a **proxy**, not the average. Recording the absence rather than quietly dropping it: an unavailable baseline left out of a table reads as a baseline that was beaten.

## Still to come in this report

B-012's phases are complete. What is **not** measured here, and is named rather than implied: the transfer planner the product actually ships (B-032 wires it in as a policy), the squad objective against the one it replaced (B-031), chips, uncertainty on any projection (B-017), and the per-component calibration that would say *which* term drives what is measured here (B-013).

Nothing was written to `projections` — asserted, not assumed.
