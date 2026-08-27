# GW2 2026/27 — projection and best squad

> **Superseded 2026-08-27 by [`gw2-recommendation-v3.md`](gw2-recommendation-v3.md).** This file is
> the record of what was recommended on the day, from `v2-fitted-2026-08-26` and **before** the two
> recommendation guards shipped — which is why Tzolakis and Emersonn are in the squad below and are
> not in the current one. It is kept as it was rather than corrected.

Produced 2026-08-26 with `pnpm project && pnpm optimize`, model version **`v2-fitted-2026-08-26`**.
Deadline **2026-08-28 17:30 UTC**.

Every number here comes from the fitted model (B-007 Phase 4), not from FPL's `ep_next`. The inputs
are three seasons of archive history plus this season's GW1, joined on `Player.code`, and availability
taken from the **captured deadline snapshot** — all 614 players were captured, so nothing here is
reading a `status` that post-dates the matches.

## Best legal squad, 5-gameweek horizon

3-5-2, **£98.6m** of £100.0m, objective 246.52 over GW2–GW6.

| | Player | Pos | Price | EP (GW2–6) |
|---|---|---|---:|---:|
| | Tzolakis | GKP | £4.5m | 12.86 |
| | De Cuyper | DEF | £4.6m | 15.92 |
| | Wieffer | DEF | £5.0m | 15.43 |
| | O'Reilly | DEF | £6.5m | 14.66 |
| **C** | **Palmer** | MID | £9.5m | 21.12 |
| **V** | Saka | MID | £9.5m | 20.51 |
| | Mbeumo | MID | £8.0m | 18.23 |
| | Foden | MID | £7.0m | 17.43 |
| | Gakpo | MID | £7.0m | 16.79 |
| | Isak | FWD | £9.0m | 18.91 |
| | Emersonn | FWD | £5.5m | 16.84 |

Bench, in order: Trafford (GKP, £5.0m), João Pedro (FWD, £7.5m), Senesi (DEF, £6.0m), Mendy (DEF,
£4.0m).

## Top expected points for GW2 alone

| Player | Pos | Team | Price | EP | of which goals | assists | bonus |
|---|---|---|---:|---:|---:|---:|---:|
| Palmer | MID | CHE | £9.5m | 5.83 | 2.20 | 0.85 | 0.65 |
| Haaland | FWD | MCI | £15.5m | 5.72 | 2.88 | 0.28 | 0.69 |
| Saka | MID | ARS | £9.5m | 5.62 | 1.69 | 1.22 | 0.59 |
| B.Fernandes | MID | MUN | £12.0m | 5.20 | 1.28 | 1.08 | 0.60 |
| Isak | FWD | LIV | £9.0m | 5.20 | 2.35 | 0.37 | 0.62 |
| Mbeumo | MID | MUN | £8.0m | 5.04 | 1.66 | 0.82 | 0.46 |
| Foden | MID | MCI | £7.0m | 4.77 | 1.22 | 0.84 | 0.61 |
| Gakpo | MID | LIV | £7.0m | 4.64 | 1.50 | 0.59 | 0.45 |
| Emersonn | FWD | IPS | £5.5m | 4.63 | 1.70 | 0.48 | 0.58 |
| João Pedro | FWD | CHE | £7.5m | 4.56 | 1.69 | 0.48 | 0.52 |

**Haaland is the highest single-gameweek projection but is not in the squad.** At £15.5m he costs
6.5 points of expected value per gameweek against Emersonn at £5.5m, and the £10.0m difference buys
more than he returns across the horizon under a £100.0m budget. That is the optimiser's judgement on
these numbers, not a claim that it is right.

## What this projection can and cannot know

- **Availability is not fitted.** `status` and `chance_of_playing_next_round` drive a hand-written
  multiplier, because the archive carries no per-gameweek availability to fit against. This is the
  half of the minutes model with the least evidence behind it and it moves projections more than any
  other input.
- **Fixture difficulty barely moves an individual's attacking projection.** Both fitted elasticities
  are 0 — on held-out data, fixture strength did not improve single-gameweek accuracy. It still drives
  clean sheets and goals conceded. Anyone expecting a big swing between an easy and a hard fixture
  will not find one here, and that is a measured result rather than an oversight.
- **Three players have no history at all** in the archive or this season, and are projected from
  positional means alone.
- **The model's own accuracy, measured on a held-out season**: MAE 1.124, RMSE 2.026, bias −0.025.
  It beats a trailing-form baseline on RMSE and bias and loses to it on MAE. It has never been
  measured against `ep_next`, which cannot be scored historically.
- **This is one gameweek's snapshot.** Prices, news and set-piece duty move until the deadline; re-run
  `pnpm sync:fpl` and `pnpm project` closer to it. (Inside 36 hours of a deadline the sync
  captures the snapshot itself; `--snapshot` forces one outside that window.)
