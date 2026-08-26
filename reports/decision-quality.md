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
| model | 37 | 0.529 | 35.0% | 12.0% | 38.4% | 15.3% | 41.9% | 20.9% |
| form | 37 | 0.574 | 33.5% | 11.5% | 34.5% | 12.6% | 40.1% | 20.1% |
| priorSeason | 37 | 0.052 | 12.6% | 2.5% | 17.3% | 5.9% | 22.8% | 11.7% |

### top 100 by price

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.498 | 45.7% | 26.3% | 46.7% | 29.4% | 61.3% | 49.5% |
| form | 37 | 0.544 | 42.9% | 22.4% | 47.1% | 28.8% | 61.1% | 49.1% |
| priorSeason | 37 | -0.024 | 24.9% | 13.3% | 26.0% | 16.4% | 36.4% | 28.6% |

### top 100 by predicted

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.124 | 38.2% | 18.4% | 42.5% | 23.2% | 49.4% | 36.4% |
| form | 37 | 0.081 | 37.8% | 18.7% | 39.4% | 20.5% | 48.7% | 35.3% |
| priorSeason | 37 | 0.023 | 16.1% | 9.1% | 23.3% | 16.0% | 37.5% | 38.6% |

## What the ordering says

Against `form`, over the whole field: Spearman **0.529** against **0.574**, and points captured @11 **35.0%** against **33.5%**.

**A split, and the split is the finding.** `form` orders the *whole field* better, and this model captures more points in the *top k* at every k measured. Those are not in conflict: a whole-field rank correlation is dominated by the mass of players who score nothing, which `form` ranks well by predicting nothing for them — and a squad optimiser never chooses between two players who will both blank. It chooses at the top, which is what points-captured@k measures. **On the part of the ranking the product uses, the model is ahead.**

That is a claim about ordering, not about points. It becomes a claim about points when the season simulation lands (Phases 3–4), and not before.

`priorSeason` is far behind on every measure, which is the sanity check on the metric itself: a baseline that cannot see this season should not rank this season's rounds.

## The XI and the armband

Every predictor is handed **the same fifteen players** and picks an XI, a bench order and a captain from them. If each picked its own squad the XI comparison would be confounded by the squad comparison, and a model could field a worse XI out of a better fifteen and look better for it.

The squads are chosen once, at **round 1**, by rules that read no model: the **template** is the legal fifteen maximising `selectedBy` — an integer program, because the top fifteen by ownership breaks the position quotas, the three-per-club cap and the budget all at once — plus **4 seeded random legal squads** (seed `20260827`) so the verdict does not rest on one squad's quirks.

**XI efficiency** is the share of the points that squad *could* have delivered that the predictor's selections actually took — so squads of different quality can be read side by side. **Captain regret** is the mean gap per round between the best realised score among the players fielded and the captain's; a bench player's haul is an XI decision, not an armband one, so it is deliberately not in the denominator.

**The squads are built at round 1 and scored from round 2.** `form` has no trailing round at a season's first deadline, so round 1 is absent from the comparison population entirely — which means the squads are picked at opening-day prices and opening-day ownership, before a round of transfers has moved the crowd, and the season measured here is 37 rounds rather than 38.

| Squad | Predictor | rounds | points | XI efficiency | captain regret |
|---|---|---:|---:|---:|---:|
| template (most-owned legal fifteen) | model | 37 | 1707 | 85.4% | 6.432 |
| template (most-owned legal fifteen) | form | 37 | 1731 | 86.6% | 6.162 |
| template (most-owned legal fifteen) | priorSeason | 37 | 1696 | 84.8% | 7.081 |
| random #1 (seed 20260827) | model | 37 | 495 | 85.5% | 2.081 |
| random #1 (seed 20260827) | form | 37 | 505 | 87.2% | 1.811 |
| random #1 (seed 20260827) | priorSeason | 37 | 455 | 78.6% | 3.162 |
| random #2 (seed 20260827) | model | 37 | 985 | 83.1% | 5.324 |
| random #2 (seed 20260827) | form | 37 | 995 | 84.0% | 5.054 |
| random #2 (seed 20260827) | priorSeason | 37 | 1031 | 87.0% | 4.081 |
| random #3 (seed 20260827) | model | 37 | 740 | 83.1% | 4.081 |
| random #3 (seed 20260827) | form | 37 | 775 | 87.0% | 3.135 |
| random #3 (seed 20260827) | priorSeason | 37 | 778 | 87.3% | 3.054 |
| random #4 (seed 20260827) | model | 37 | 980 | 83.8% | 5.000 |
| random #4 (seed 20260827) | form | 37 | 963 | 82.4% | 5.459 |
| random #4 (seed 20260827) | priorSeason | 37 | 977 | 83.6% | 5.081 |

### Is the difference bigger than the noise?

**A mean difference over 38 rounds is not a result on its own.** Measured on the B-011 collision sweep next door (`reports/guards-009.md`, 103 archived gameweeks): a paired per-round difference of +0.59 realised points carried a standard deviation of 0.92, and the per-season sign flipped — −2.41, +2.34, +0.97 across three seasons of the same comparison. A season does not contain enough rounds to resolve effects of a couple of points a week.

So each row below is **paired by round** — both predictors faced the same fixtures, blanks and hauls, so the round-to-round variance that dominates the totals cancels — and carries the standard error of that pairing. "Clears noise" is |mean| > 2 standard errors, which is a crude bar and is meant to be.

| Squad | comparison | rounds | mean difference | ± s.e. | clears noise |
|---|---|---:|---:|---:|---|
| template (most-owned legal fifteen) | model − form | 37 | -0.65 | 0.89 | no |
| template (most-owned legal fifteen) | model − priorSeason | 37 | +0.30 | 0.87 | no |
| random #1 (seed 20260827) | model − form | 37 | -0.27 | 0.33 | no |
| random #1 (seed 20260827) | model − priorSeason | 37 | +1.08 | 0.63 | no |
| random #2 (seed 20260827) | model − form | 37 | -0.27 | 0.61 | no |
| random #2 (seed 20260827) | model − priorSeason | 37 | -1.24 | 0.57 | **yes** |
| random #3 (seed 20260827) | model − form | 37 | -0.95 | 0.46 | **yes** |
| random #3 (seed 20260827) | model − priorSeason | 37 | -1.03 | 0.65 | no |
| random #4 (seed 20260827) | model − form | 37 | +0.46 | 0.73 | no |
| random #4 (seed 20260827) | model − priorSeason | 37 | +0.08 | 0.65 | no |


**1 of 5** model-versus-`form` comparisons clear two standard errors: random #3 (seed 20260827) (-0.95).

## The simulated season

Each predictor picks its **own** opening fifteen and walks the season under the real rules — one free transfer a round banked to 5, the 50% sell-on fee, auto-substitutions on 0 minutes only, the vice taking the armband when the captain blanks and nobody doubling when both do. **This is the first metric where *which* fifteen you own is part of what is measured**, which is exactly where the ordering advantage should show up if it is real.

**Both policies are deliberately weak, and the totals below are floors rather than estimates.** `no-transfer` holds the opening squad for the whole season. `greedy-1ft` takes at most one free transfer a round, on this round's projection, and **never takes a hit** — so the −4 path is exercised by a unit test and never by a walked season. Choosing transfers well is B-008, which plugs into this same simulator rather than bringing its own.

**Chips are unused.** A wildcard or free hit is a transfer policy (B-008); bench boost and triple captain are single-week variance bets needing B-017's distributions. An unused chip is a handicap applied equally to every predictor. A guessed one is a confound.

**`form` cannot choose an opening squad** — it is this season's trailing rounds and there are none at the first deadline. It falls back to last season's points per 90, the only signal knowable then and the charter's own naive baseline, and takes over from round 2. A baseline handed a better opening squad than it could have chosen is not a baseline.

| Policy | Squad picked by | rounds | **points** | transfers | hits | final team value |
|---|---|---:|---:|---:|---:|---:|
| no-transfer | model | 37 | **1623** | 0 | 0 | £98.9m |
| no-transfer | form | 37 | **1172** | 0 | 0 | £97.4m |
| no-transfer | priorSeason | 37 | **1131** | 0 | 0 | £97.4m |
| no-transfer | template (crowd proxy) | 37 | **1707** | 0 | 0 | £98.2m |
| greedy-1ft | model | 37 | **1943** | 37 | 0 | £98.4m |
| greedy-1ft | form | 37 | **1807** | 37 | 0 | £97.7m |
| greedy-1ft | priorSeason | 37 | **1148** | 2 | 0 | £97.5m |
| greedy-1ft | template (crowd proxy) | 37 | **1917** | 37 | 0 | £98.5m |

### Is the difference bigger than the noise?

| Policy | comparison | rounds | mean difference | ± s.e. | clears noise |
|---|---|---:|---:|---:|---|
| no-transfer | model − form | 37 | +12.19 | 2.89 | **yes** |
| no-transfer | model − priorSeason | 37 | +13.30 | 2.82 | **yes** |
| greedy-1ft | model − form | 37 | +3.68 | 2.85 | no |
| greedy-1ft | model − priorSeason | 37 | +21.49 | 2.76 | **yes** |

### What the simulated season says

**Held all season, the model's opening fifteen is worth 1623 points against 1172** — a gap of 451 over the season, which clears the noise floor comfortably. This is the ordering advantage from the section above, showing up exactly where Phase 2 predicted it would: **in which fifteen you own, not in how you arrange a fifteen you already have.** Note what the `form` row actually is — form cannot pick an opening squad, so that squad was chosen by last season's points per 90.

**Give both a transfer a week and most of that gap closes.** `form` goes from 1172 to 1807; the model goes from 1623 to 1943, a remaining gap of **136** which does **not** clear the noise floor. A weekly transfer is a powerful error-correction mechanism, and it corrects a weak opening squad faster than it improves a strong one. **A model that is better only before the first deadline is worth much less than the season totals first suggest.**

**The bar B-012 set was: beat `form` on ordering AND on simulated season points, or say plainly that we did not.** Ordering: yes, on points-captured at every k. Season points: **only when neither side may transfer.** Once both can, the difference does not clear the noise floor. `modelVersion` does not move on this, and the serving version is not deleted — B-007 (D-020) established both rules and neither is met here.

The next question is not "is the model better" but "why is a squad built from its own projections worse than the crowd's", and B-013 (which component is wrong) and B-014 (team strength carries no signal, and both fixture elasticities fitted to 0) are where it gets answered.

### The baseline that does not exist

**The real FPL average is unavailable for archive seasons.** `Gameweek.averageScore` exists for the live season only, upstream serves no past season's `bootstrap-static`, and the archive carries no per-round average. The **template squad** row above — the legal fifteen maximising ownership, held under the same policy — is the closest thing available and is a **proxy**, not the average. Recording the absence rather than quietly dropping it: an unavailable baseline left out of a table reads as a baseline that was beaten.

## Still to come in this report

Nothing — B-012's phases are complete. What is **not** measured here, and is named rather than implied: a transfer policy worth the name (B-008), chips, uncertainty on any projection (B-017), and the per-component calibration that would say *which* term drives what is measured here (B-013).

Nothing was written to `projections` — asserted, not assumed.
