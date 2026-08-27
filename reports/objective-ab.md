# The squad objective, A/B'd against the one it replaced (B-031)

Season **2025-26**, held out of the fit. Every arm is the **same model, the same predictions, the same policy and the same lineup rule** — only the objective row of the squad program differs. The opening fifteen is chosen at round 1 and the season is walked from there.

## Why this harness exists

Between `ebf4da4` (the model adopted as v3, D-025) and `6cf0590` (the objective rewrite, B-023) the model's own simulated fifteen went from **26 points ahead** of the crowd proxy to **47 behind**, under the same policy. Three commits sit in that window and only two regenerated the report, so git archaeology cannot say which one did it. Holding everything at HEAD and changing one objective row can.

**And the power to see it comes from the pairing, not from more data.** The decision-quality report compares squads chosen by *different predictors*: they hold different players, the round-to-round variance does not cancel, and nothing under roughly 190 points of season is visible (B-030). Three archived seasons would buy √3 and still not be enough. Two arms of the same model hold mostly the same players, so the common variance cancels and the floor falls with the overlap — which is why the overlap is measured below rather than assumed.

## The arms

| arm | objective | λ | what it is |
|---|---|---:|---|
| pre-B-023 (all fifteen equal) | `all-fifteen-equal` | — | `Σ EP × x`. No armband priced, no bench discount, no concentration charge. `benchWeight` is passed and ignored — the objective row does not read it. |
| B-023 (XI, bench, armband) | `xi-bench-captain` | — | `Σ EP(y + c) + 0.7 × Σ EP(x − y)`. What `pnpm decision-quality` has measured since B-023. |
| served (B-023 + B-029 concentration) | `xi-bench-captain` | 1 | The same, plus the defensive-concentration charge on `y` at λ=1.0 — **what the product actually serves**, and what no simulated season had ever used. |
| instrument check: bench worth nothing | `xi-bench-captain` | — | **Not a candidate — a positive control.** A knob nobody proposes, set to a value B-023 measured as costing about 180 points of season, so that a harness returning "every arm is identical" can be told apart from a harness that is not varying anything. If THIS arm matches the baseline, the instrument is broken and no null result above means anything. |
| instrument check: bench weight is not read by this objective | `all-fifteen-equal` | — | **Not a candidate — a negative control.** `all-fifteen-equal` does not read `benchWeight`, so this must return the baseline **exactly**. If the objective flag ever stops reaching the solver this arm becomes the positive control, which buys a different fifteen, and the run throws — which is the only thing that can catch an inert objective when the headline result is itself a null. |

## Season totals

| policy | arm | rounds | **points** | transfers | hits | final team value |
|---|---|---:|---:|---:|---:|---:|
| no-transfer | pre-B-023 (all fifteen equal) | 0 | **0** | 0 | 0 | £0.0m |
| no-transfer | B-023 (XI, bench, armband) | 0 | **0** | 0 | 0 | £0.0m |
| no-transfer | served (B-023 + B-029 concentration) | 0 | **0** | 0 | 0 | £0.0m |
| no-transfer | instrument check: bench worth nothing | 0 | **0** | 0 | 0 | £0.0m |
| no-transfer | instrument check: bench weight is not read by this objective | 0 | **0** | 0 | 0 | £0.0m |
| greedy-1ft | pre-B-023 (all fifteen equal) | 0 | **0** | 0 | 0 | £0.0m |
| greedy-1ft | B-023 (XI, bench, armband) | 0 | **0** | 0 | 0 | £0.0m |
| greedy-1ft | served (B-023 + B-029 concentration) | 0 | **0** | 0 | 0 | £0.0m |
| greedy-1ft | instrument check: bench worth nothing | 0 | **0** | 0 | 0 | £0.0m |
| greedy-1ft | instrument check: bench weight is not read by this objective | 0 | **0** | 0 | 0 | £0.0m |

## Paired against the objective that was replaced

Each row pairs by round against **pre-B-023 (all fifteen equal)** under the same policy. "detectable at" is 2 × s.e. × rounds, in points of season — what this comparison could have seen at all. **overlap** is the mean share of the fifteen the two arms held in common, round by round: it is what makes the pairing tight, and a low number here means the comparison is no better powered than the one it replaces.

| policy | arm − baseline | rounds | season Δ | mean Δ | ± s.e. | clears noise | detectable at | overlap |
|---|---|---:|---:|---:|---:|---|---:|---:|

## What this says

**Every objective this project has shipped since `pre-B-023 (all fifteen equal)` picks the same fifteen.** `B-023 (XI, bench, armband)` and `served (B-023 + B-029 concentration)` return the baseline's squad player for player, so their season totals are the baseline's by construction rather than by luck. B-023's rewrite of the objective, and B-029's defensive-concentration charge on top of it, **change nothing about which fifteen is bought on this season's data.**

That answers B-031's question with a no. The model's simulated fifteen did lose 62 points between `ebf4da4` and `6cf0590`, and the objective rewrite in that window is not what did it — the two remaining commits changed the projections, not the selection. It also means the concentration charge, which cost six register entries to arrive at, is currently inert on the squad solve.

**The instrument is not stuck, and this is the row that proves it.** With the bench worth nothing the solver buys a different fifteen — 10 of 15 shared — and held all season that squad scores 0 against 0, a difference of 0. So "every arm is identical" above is a measurement, not a harness that forgot to vary anything. The run throws rather than reports if this arm ever matches the baseline.

## The opening fifteens

The only thing an arm controls. Everything after round 1 is the same policy acting on the same predictions.

| arm | shared with baseline | its own |
|---|---:|---:|
| pre-B-023 (all fifteen equal) | 15 of 15 | 0 |
| B-023 (XI, bench, armband) | 15 of 15 | 0 |
| served (B-023 + B-029 concentration) | 15 of 15 | 0 |
| instrument check: bench worth nothing | 10 of 15 | 5 |
| instrument check: bench weight is not read by this objective | 15 of 15 | 0 |

Nothing was written to `projections` or `optimizer_runs` — asserted, not assumed.
