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
| model | 37 | 0.518 | 35.4% | 12.0% | 36.9% | 13.9% | 43.2% | 23.1% |
| form | 37 | 0.574 | 33.5% | 11.5% | 34.5% | 12.6% | 40.1% | 20.1% |
| priorSeason | 37 | 0.052 | 12.6% | 2.5% | 17.3% | 5.9% | 22.8% | 11.7% |

### top 100 by price

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.489 | 43.0% | 24.8% | 47.1% | 31.4% | 62.8% | 50.7% |
| form | 37 | 0.544 | 42.9% | 22.4% | 47.1% | 28.8% | 61.1% | 49.1% |
| priorSeason | 37 | -0.024 | 24.9% | 13.3% | 26.0% | 16.4% | 36.4% | 28.6% |

### top 100 by predicted

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.152 | 39.1% | 18.7% | 41.2% | 22.3% | 51.1% | 36.9% |
| form | 37 | 0.081 | 37.8% | 18.7% | 39.4% | 20.5% | 48.7% | 35.3% |
| priorSeason | 37 | 0.023 | 16.1% | 9.1% | 23.3% | 16.0% | 37.5% | 38.6% |

## What the ordering says

Against `form`, over the whole field: Spearman **0.518** against **0.574**, and points captured @11 **35.4%** against **33.5%**.

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
| template (most-owned legal fifteen) | model | 37 | 1738 | 86.9% | 5.838 |
| template (most-owned legal fifteen) | form | 37 | 1731 | 86.6% | 6.162 |
| template (most-owned legal fifteen) | priorSeason | 37 | 1696 | 84.8% | 7.081 |
| random #1 (seed 20260827) | model | 37 | 494 | 85.3% | 2.108 |
| random #1 (seed 20260827) | form | 37 | 505 | 87.2% | 1.811 |
| random #1 (seed 20260827) | priorSeason | 37 | 455 | 78.6% | 3.162 |
| random #2 (seed 20260827) | model | 37 | 1002 | 84.6% | 4.865 |
| random #2 (seed 20260827) | form | 37 | 995 | 84.0% | 5.054 |
| random #2 (seed 20260827) | priorSeason | 37 | 1031 | 87.0% | 4.081 |
| random #3 (seed 20260827) | model | 37 | 744 | 83.5% | 3.973 |
| random #3 (seed 20260827) | form | 37 | 775 | 87.0% | 3.135 |
| random #3 (seed 20260827) | priorSeason | 37 | 778 | 87.3% | 3.054 |
| random #4 (seed 20260827) | model | 37 | 955 | 81.7% | 5.676 |
| random #4 (seed 20260827) | form | 37 | 963 | 82.4% | 5.459 |
| random #4 (seed 20260827) | priorSeason | 37 | 977 | 83.6% | 5.081 |

### Is the difference bigger than the noise?

**A mean difference over 38 rounds is not a result on its own.** Measured on the B-011 collision sweep next door (`reports/guards-009.md`, 103 archived gameweeks): a paired per-round difference of +0.59 realised points carried a standard deviation of 0.92, and the per-season sign flipped — −2.41, +2.34, +0.97 across three seasons of the same comparison. A season does not contain enough rounds to resolve effects of a couple of points a week.

So each row below is **paired by round** — both predictors faced the same fixtures, blanks and hauls, so the round-to-round variance that dominates the totals cancels — and carries the standard error of that pairing. "Clears noise" is |mean| > 2 standard errors, which is a crude bar and is meant to be.

| Squad | comparison | rounds | mean difference | ± s.e. | clears noise |
|---|---|---:|---:|---:|---|
| template (most-owned legal fifteen) | model − form | 37 | +0.19 | 0.78 | no |
| template (most-owned legal fifteen) | model − priorSeason | 37 | +1.14 | 0.80 | no |
| random #1 (seed 20260827) | model − form | 37 | -0.30 | 0.49 | no |
| random #1 (seed 20260827) | model − priorSeason | 37 | +1.05 | 0.62 | no |
| random #2 (seed 20260827) | model − form | 37 | +0.19 | 0.65 | no |
| random #2 (seed 20260827) | model − priorSeason | 37 | -0.78 | 0.49 | no |
| random #3 (seed 20260827) | model − form | 37 | -0.84 | 0.61 | no |
| random #3 (seed 20260827) | model − priorSeason | 37 | -0.92 | 0.80 | no |
| random #4 (seed 20260827) | model − form | 37 | -0.22 | 0.66 | no |
| random #4 (seed 20260827) | model − priorSeason | 37 | -0.59 | 0.78 | no |


**Nothing here separates the predictors.** Not one model-versus-`form` comparison clears two standard errors, and the sign of the difference flips across squads (2 of 5 positive). **This is a null result and it is reported as one** — the model does not make measurably better XI and captain decisions than `form` over one season, on any of these fifteens.

That is not a contradiction of the ordering section above, and it is worth being precise about why. Given a **fixed** fifteen, most of the XI picks itself: the decisions left are a handful of marginal calls at the bench boundary and the armband, which is a much smaller surface than ranking six hundred players. The ordering advantage is real and this is the wrong instrument to see it with — **it shows up in which fifteen you own, not in how you arrange the fifteen you already have.** Testing that needs the transfers, which is Phase 3.

## Still to come in this report

B-012's remaining phases: a full-season simulation under the real rules — free transfers banked to five, −4 hits, the 50% sell fee, transfers as a policy (Phases 3–4). The squads above are **held fixed all season**, so what is measured here is the XI and the armband and nothing else; a model that would have transferred its way to a better squad gets no credit for it yet.

Nothing was written to `projections` — asserted, not assumed.
