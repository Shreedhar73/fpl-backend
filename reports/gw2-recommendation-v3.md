# GW2 2026/27 — the recommendation from the adopted model

Produced 2026-08-27 with `pnpm project && pnpm optimize`, model version **`v3-fitted-2026-08-27`**.
Deadline **2026-08-28 17:30 UTC**.

Supersedes `gw2-recommendation.md`, which was produced on 2026-08-26 from `v2-fitted-2026-08-26` and
**before** the two recommendation guards shipped — that squad contains Tzolakis and Emersonn, both of
whom the appearance floor now removes. The older file is kept as the record of what was recommended
on the day, not corrected.

Availability comes from the **captured deadline snapshot** taken 2026-08-26 19:25 UTC, 46.1 hours out,
614 players. A closer capture is still owed and is expected to ride the hourly sync once the deadline
comes inside 36 hours — see B-016.

## What changed in the model between the two reports

Three structural changes, each measured on the same 29,482 held-out 2025-26 rows.

| | before | after |
|---|---:|---:|
| `P(any appearance)` Brier reliability (B-019) | 0.0121 | **0.0009** |
| `P(defcon ≥ threshold)` predicted, base rate 0.054 (B-020) | 0.013 | **0.048** |
| `attack.xaFixtureElasticity` (B-014) | 0 | **2.5** |
| overall bias | −0.025 | +0.059 |
| ordering spearman | 0.518 | **0.529** |
| points captured in the top 15 | 36.9% | **38.4%** |
| season total under `greedy-1ft`, against the crowd template | 1896 vs 1998 | **1943 vs 1917** |

The last line is the one that changed the adoption decision. D-021 declined to adopt v2 in part
because the crowd's opening fifteen outscored ours by 102 points under the same policy and the same
projections. It now finishes 26 points ahead.

## Best legal squad, 5-gameweek horizon

3-5-2, **£99.6m** of £100.0m, objective **250.57** over GW2–GW6.

| | Player | Pos | Price | EP (GW2–6) |
|---|---|---|---:|---:|
| | Trafford | GKP | £5.0m | 12.60 |
| | Wieffer | DEF | £5.0m | 17.16 |
| | De Cuyper | DEF | £4.6m | 16.30 |
| | Senesi | DEF | £6.0m | 16.05 |
| **V** | Palmer | MID | £9.5m | 21.91 |
| **C** | **Saka** | MID | £9.5m | 21.06 |
| | B.Fernandes | MID | £12.0m | 19.71 |
| | Mbeumo | MID | £8.0m | 18.47 |
| | Gomez | MID | £5.0m | 16.15 |
| | Isak | FWD | £9.0m | 19.22 |
| | Richarlison | FWD | £6.0m | 16.38 |

Bench, in order: Petrović (GKP, £4.5m), Nketiah (FWD, £5.5m), Ballard (DEF, £5.0m), Canvot (DEF,
£5.0m).

**The armband is Saka's and Palmer projects higher, which is not a mistake.** The captain is chosen
inside the XI enumeration with his fixture collisions counted twice — the armband doubles the stake on
a correlated outcome, not only the reward — and Palmer faces two of our own Brighton defenders. This
is the same call the guard made on the v2 solve and the reasoning below prices it.

## What the optimizer refused, and what it paid

Straight from `optimizer_runs.reasoning` on this solve, which is the same object the API serves and
the app renders (B-018).

**Appearance floor.** Threshold 11 Premier League appearances; **227 of 614 players** never entered
the pool. It cost this recommendation **4.18 horizon points**, measured against the same solve with
the floor lifted and the collision penalty unchanged. Three excluded players an unguarded solve would
have taken:

| Player | Pos | Team | Appearances | EP the unguarded solve gave them |
|---|---|---|---:|---:|
| Tzolakis | GKP | HUL | 1 | 13.00 |
| Mendy | DEF | HUL | 1 | 15.87 |
| Emersonn | FWD | IPS | 1 | 16.88 |

This is a refusal to bet on players the model cannot measure, not a claim that they are bad. A
per-90 rate estimated from one match is mostly noise, and an optimiser is a maximiser — it hunts
exactly the players whose estimate that noise inflated.

**Fixture collisions.** 4,665 attacker-and-defender pairs priced across the pool; this XI keeps two
and paid **2.0 horizon points** for them:

| Fixture | Attacker | Defender | Charged |
|---|---|---|---:|
| CHE vs BHA | Palmer | De Cuyper | 1.0 |
| CHE vs BHA | Palmer | Wieffer | 1.0 |

**Say what this one is.** The collision penalty was swept over 103 archived gameweeks and did **not**
improve realised points — +0.59 ± 0.92 per gameweek, per-season signs that flip, and the downside it
was argued for as insurance got worse (`reports/guards-009.md`). It is on as a policy choice about
what we are willing to recommend, and not because it scores more.

## What this recommendation still does not know

- **Transfers and chips.** Nothing here is a transfer suggestion. That needs a sell value no public
  FPL endpoint exposes and a hit calculation — B-008.
- **Uncertainty.** Every number above is a mean with no dispersion attached, so a 21.9 from a nailed
  premium and a 21.9 from a rotation risk read identically — B-017.
- **The availability multiplier is still not fitted.** The archive carries no per-gameweek `status`,
  so that half of the minutes model remains a hand-drawn scalar — B-015, and it is calendar-bound.
- **The fixture term is non-zero and unproven out-of-sample.** B-014's rebuild earned the elasticities
  on the validation set and did not improve the held-out season. See D-024.

---

## Revised 2026-08-27, after B-023 — the armband moves back to Palmer

Everything above was produced **before** B-023 put the XI and the captain into the optimizer's
objective. Same model version, same gameweek, same projections; a different program solving over
them. The recommendation of record is the one below.

3-5-2, **£99.7m**, objective **257.84** over GW2–GW6.

| | Player | Pos | Price | EP (GW2–6) |
|---|---|---|---:|---:|
| | Trafford | GKP | £5.0m | 12.69 |
| | Senesi | DEF | £6.0m | 16.12 |
| | Ballard | DEF | £5.0m | 15.20 |
| | Lacroix | DEF | £6.0m | 15.06 |
| **C** | **Palmer** | MID | £9.5m | 22.01 |
| **V** | Saka | MID | £9.5m | 21.15 |
| | Mbeumo | MID | £8.0m | 18.57 |
| | Foden | MID | £7.0m | 18.03 |
| | Gakpo | MID | £7.0m | 17.51 |
| | Isak | FWD | £9.0m | 19.33 |
| | João Pedro | FWD | £7.6m | 17.08 |

Bench, in order: Petrović (GKP, £4.5m), Wieffer (DEF, £5.0m), Richarlison (FWD, £6.0m), De Cuyper
(DEF, £4.6m).

**The armband is Palmer's again, and the collision is still priced.** The earlier solve moved it to
Saka because the captain's doubled exposure to two Brighton defenders was the only lever the
arrangement had. With the XI in the objective the solver has a better one: it keeps the best captain
and **benches the two defenders he collides with** — Wieffer (17.22) and De Cuyper (16.34) sit behind
Ballard (15.20) and Lacroix (15.06). That costs `(1 − 0.7) × 3.30 = 0.99` of objective and saves 4
penalty points, because a captain's collision counts twice. Same rule, better instrument.

**Two of those bench players are worth more than two of the starters, and that is not an error.** A
bench place is worth 0.7 of a start in this objective (D-029), so the solver will trade XI quality for
a penalty saving. What it will not do any more is buy four £5.0m defenders because a bench place was
priced at par.

**What has not changed:** the appearance floor still excludes 227 players, and the honest caveats at
the foot of the original section — no transfers or chips here (that is `/api/insights/transfers/{id}`
now), an unfitted availability multiplier, and a fixture term that is non-zero and unproven
out-of-sample — all still stand.

**And one that has:** every projection now carries a distribution (B-017). Palmer is 6.31 for the
gameweek with a standard deviation of 4.21, a 23.0% chance of a blank and a 21.5% chance of ten or
more. Doubling him doubles both ends of that.

## Update, 2026-08-27 — B-025 moved the collision penalty back onto ownership

The two paragraphs above about benching Wieffer and De Cuyper describe an objective this repo no
longer serves. B-025 read the same arithmetic and reached the opposite verdict about it: B-011's rule
is about *holding* both sides of a fixture, and a squad that pays £9.6m for two players it refuses to
start has evaded the rule rather than obeyed it. The charge is on `x` again, at `benchWeight × λ`, and
there is no charge on the XI or the armband at all.

**The recommendation of record changes, and it changes the fifteen — not only the eleven.**
Re-solved on the same universe and the same model version. Every projection quoted in the B-023 table
above is unchanged in this solve (Palmer 22.01, Saka 21.15, Mbeumo 18.57, Isak 19.33, Wieffer 17.22,
De Cuyper 16.34, Senesi 16.12, Ballard 15.20), so nothing below is projection drift:

| | before B-025 (the B-023 objective) | after |
|---|---|---|
| starting defenders | Senesi 16.12, Ballard 15.20, Lacroix 15.06 | **Wieffer 17.22, De Cuyper 16.34, Senesi 16.12** |
| benched defenders | **Wieffer 17.22, De Cuyper 16.34** | Canvot 15.23, Ballard 15.20 |
| midfield | Palmer, Saka, Mbeumo, Foden, Gakpo | Palmer, Saka, **B.Fernandes**, Mbeumo, **Gomez** |
| forwards | Isak, João Pedro, Richarlison | Isak, Richarlison, **Nketiah** |
| captain | Palmer | Palmer |
| formation | 3-5-2 | 3-5-2 |
| squad cost | £99.7m | £99.6m |
| horizon EP given up in the XI | 3.30 | **0** |
| what the panel said | `penaltyEp: 0, taken: []` | `penaltyEp: 1.4`, both pairs named, `bothStarted: true` |

**Four of the fifteen changed** — Lacroix, Foden, Gakpo and João Pedro out; Canvot, B.Fernandes, Gomez
and Nketiah in — and that is the point of the change rather than a side effect of it. Charging the XI
made a cheap non-colliding defender valuable *to start*, so the squad bought Lacroix and Ballard and
then sat the two better defenders it already owned. Charging ownership removes that incentive
entirely: the eleven is a points question, so the money goes where the points are. The objective
values (257.84 before, 250.57 in the first table above) are **not comparable** across the two
programs; they are different expressions.

What did not change is the conflict itself. The squad still holds Palmer against two Brighton
defenders — it now pays 1.40 horizon EP for them, fields them, and says so.

**Over an archived season** (`pnpm replay:xi`, 2025-26, one fifteen held for 38 rounds — the first
harness in this project that reads the eleven the solver itself chose):

| arm | realised | pairs owned | both sides started | projected points forgone in the XI |
|---|---:|---:|---:|---:|
| penalty on the XI (before B-025) | 1604 | 38 rounds | 8 rounds | 78.56 |
| no penalty at all (λ = 0) | 1673 | 33 rounds | 31 rounds | 0.00 |
| **penalty on ownership (after B-025)** | **1713** | 30 rounds | 27 rounds | **0.00** |

Read this carefully. The three arms hold **different fifteens** — the objective picks the squad too —
so the 109-point spread is not an XI effect and one squad over one season is not a result. What the
table does establish is behavioural and is not noise: the served objective used to own a conflicting
pair in every round of the season and start both sides in eight of them, and it no longer benches a
better-projected player for a worse one at all.

## Update, 2026-08-27 — B-026 charges raw lambda, and the recommendation does not move

B-025 charged the penalty at `benchWeight × λ` = 0.7. B-026 undid the scaling: it is exact only for a
pair nobody starts, because a **starter's** coefficients sum to `ep` after B-023 — the pre-B-023
weight — so a raw λ was already at the strength B-011 measured and 0.7λ under-charged the case a
colliding pair usually is.

**Nothing about the recommendation changed.** Same fifteen, same 3-5-2, same £99.6m, same eleven, same
captain. The only number that moved is what the panel says the squad paid: **1.40 → 2.00** horizon EP
for the two Palmer-against-Brighton pairs it holds, and the penalised horizon EP 252.28 → 251.68.

**Nothing about the season moved either.** `pnpm replay:xi` at raw λ returns 1713 points, a pair owned
in 30 rounds, both sides started in 27, and 0.00 projected points forgone — **identical round by
round, all 38 of them**, to the 0.7 arm. That is the sweep's own finding arriving from a second
direction: every λ from 0.5 to 4 lands within 0.13 realised points, and between 0.7 and 1.0 no
decision in this squad-season flips at all.

So this change buys no points and was not expected to. What it buys is a constant that means what its
comment says, and one fewer pair of knobs that have to be swept together.
