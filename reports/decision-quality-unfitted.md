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
| model | 37 | 0.474 | 32.6% | 8.6% | 34.8% | 9.7% | 39.6% | 20.2% |
| form | 37 | 0.574 | 33.5% | 11.5% | 34.5% | 12.6% | 40.1% | 20.1% |
| priorSeason | 37 | 0.052 | 12.6% | 2.5% | 17.3% | 5.9% | 22.8% | 11.7% |

### top 100 by price

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.455 | 39.6% | 18.7% | 44.1% | 26.8% | 58.9% | 48.2% |
| form | 37 | 0.544 | 42.9% | 22.4% | 47.1% | 28.8% | 61.1% | 49.1% |
| priorSeason | 37 | -0.024 | 24.9% | 13.3% | 26.0% | 16.4% | 36.4% | 28.6% |

### top 100 by predicted

| Predictor | rounds | Spearman | points captured @11 | precision @11 | points captured @15 | precision @15 | points captured @30 | precision @30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| model | 37 | 0.106 | 37.6% | 17.2% | 40.8% | 21.4% | 49.0% | 38.8% |
| form | 37 | 0.081 | 37.8% | 18.7% | 39.4% | 20.5% | 48.7% | 35.3% |
| priorSeason | 37 | 0.023 | 16.1% | 9.1% | 23.3% | 16.0% | 37.5% | 38.6% |

## What the ordering says

Against `form`, over the whole field: Spearman **0.474** against **0.574**, and points captured @11 **32.6%** against **33.5%**.

**Mixed**: ahead on points captured at @15 and behind at the rest. Recorded as it stands rather than summarised into a verdict the numbers do not support.

`priorSeason` is far behind on every measure, which is the sanity check on the metric itself: a baseline that cannot see this season should not rank this season's rounds.

## Still to come in this report

B-012's remaining phases: the XI and captain decision over fixed squads shared by every model (Phase 2), and a full-season simulation under the real rules — free transfers banked to five, −4 hits, the 50% sell fee, auto-subs, captain fallback (Phases 3–4). Until those land, this report answers "is the ranking better" and does not yet answer "would it have scored more points".

Nothing was written to `projections` — asserted, not assumed.
