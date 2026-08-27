# Recommendation guards — what they changed and what they cost

Plan `fpl-orchestrator/docs/plans/009-recommendation-guards.md`, backlog B-010 and B-011.
Measured 2026-08-27 against the live database (`v2-fitted-2026-08-26` projections, GW2, horizon 5)
and against the three archived seasons.

Reproduce with `pnpm guards:report`. It does not write to the database.

> **`pnpm sweep:collision` no longer exists (2026-08-27).** B-029 retired the collision penalty and
> deleted the sweep with it — see D-030 in the orchestrator's decision log, and
> `reports/collision-correlation.md`, which measured the rule this report swept and found it was
> pricing a hedge: the pairing is real (correlation −0.195) but holding both sides CUTS a squad's
> variance, and the concentration that actually matters — two of one club's defence — was charged
> nothing.
>
> **The numbers below stand.** They are what was measured at the time, and they are the reason the
> rule was doubted in the first place. Only the command is gone.

---

## Part 1 — the live GW2 squad, four ways

614 players, **227 under the appearance floor**, 4,665 conflicting pairs in the universe.

| Solve | Cost | Raw horizon EP | Sub-floor players | Pairs held in the 15 |
|---|---|---|---|---|
| neither guard | £98.6m | 246.52 | **3** | 4 |
| floor only (≥11 apps) | £99.6m | 243.11 | 0 | 6 |
| penalty only (λ = 1) | £97.1m | 245.83 | 3 | 2 |
| **both — what we serve** | £98.6m | **242.04** | **0** | **2** |

**The guards cost 4.48 horizon expected points, 1.8% of the unguarded objective.** The floor is
most of it (−3.41); the penalty is −0.69 on raw EP and +1.31 on the penalised quantity it actually
maximises.

Both things the plan opened for are gone from the served squad:

- **The three one-appearance players are out.** Tzolakis (GKP, 1 app, was a *starter*), Emersonn
  (FWD, 1 app, was a *starter*) and Mendy (DEF, 1 app) are replaced by Trafford/Roefs, Richarlison
  and Ballard. Note what the "floor only" row shows: without the collision penalty the floor alone
  makes the collision problem *worse*, 4 pairs → 6. The two guards are not independent.
- **The captaincy moved off the collision.** Palmer (CHE, 21.12 EP) still starts and is now the
  vice; the armband goes to Saka (20.51). The squad keeps De Cuyper and Wieffer (BHA) against
  Palmer's Chelsea fixture and is charged 2 points for it — a priced decision, reported in
  `optimizer_runs.reasoning.collisions.taken`, not a silent one. That is the penalty behaving as
  designed: it is not an exclusion.

## Part 2 — the λ sweep, and it does not say what the plan hoped

103 archived gameweeks, solved from scratch at that week's prices under the feature walk's time cut,
with the appearance floor held ON at every λ so one thing varies. 11 rounds skipped as infeasible —
the opening of 2023-24, where no player yet has 11 appearances in our archive.

Realised points of the chosen XI plus the doubled captain:

| λ | mean | worst decile | worst quartile | min | pairs kept in XI | paired vs λ=0 |
|---|---|---|---|---|---|---|
| 0 | 55.04 | 32.0 | 42.0 | 21.0 | 250 | — |
| 0.5 | 55.59 | 30.0 | 43.0 | 12.0 | 36 | +0.55 ± 0.86 |
| 1 | 55.63 | 30.0 | 42.0 | 12.0 | 15 | +0.59 ± 0.92 |
| 2 | 55.56 | 30.0 | 42.0 | 12.0 | 1 | +0.52 ± 0.90 |
| 4 | 55.50 | 30.0 | 42.0 | 12.0 | 0 | +0.46 ± 0.90 |

**Verdict: no λ improves either the mean or the downside, and the honest answer is that the sweep
cannot tell.** Three readings, in the order they matter:

1. **The pooled gain is inside its own noise.** +0.59 ± 0.92 points per gameweek at λ = 1 is under
   one standard error. The rounds are paired — every λ solves the same gameweek off the same
   projections — so this is already the low-variance form of the comparison, and it still says
   nothing.
2. **The pooled number is a cancellation, not an agreement.** Per season the sign flips: 2023-24
   **−2.41 ± 2.14**, 2024-25 **+2.34 ± 1.10**, 2025-26 **+0.97 ± 1.61**. A rule whose effect
   reverses between seasons at this sample size has not been shown to have an effect.
3. **The downside got worse, which is the opposite of the case for the rule.** The penalty was
   argued for as insurance — spend mean EP, buy variance reduction. Measured, the worst decile falls
   from 32.0 to 30.0 and the worst single gameweek from 21 to 12. Whatever the penalty is doing, it
   is not buying downside protection.

One more thing the sweep settles, and it is about the knob rather than the rule: **λ is close to
binary.** Going from 0 to 0.5 removes all but 36 of the 250 pairs; everything from 0.5 to 4 lands
within 0.13 points of the mean of the others. There is no interior optimum to tune toward, so
"fitting λ" is not work worth doing — the choice is whether the rule is on.

**So the rule stays on at λ = 1 as an explicit policy choice, and this file is the record that it is
one.** It is a refusal to hold both sides of a match, kept because a squad that bets on a clean
sheet and against it at the same time is not one we want to defend to a user — not because it was
measured to score more points. `COLLISION_LAMBDA` says as much where it is defined.

### What this measurement is not

Every gameweek is solved from scratch at that week's prices. No transfers, no free-transfer bank, no
hits, no sell-on fee, and **no auto-subs** — a benched player who would have replaced a starter who
did not play scores nothing here. Those omissions are held constant across λ, which is what makes
the comparison between columns fair; it is not what would make any column a season. That is B-012's
simulator.

The projection parameters were fitted on 2023-24 and 2024-25 and held out on 2025-26, so the first
two seasons are in-sample for the *model*. λ is not a fitted parameter, and it is applied on top of
the same projections in every column, so the comparison across λ is affected far less than any
column's absolute level — but the absolute means are not a clean out-of-sample number and should not
be quoted as one.
