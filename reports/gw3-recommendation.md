# GW3 recommendation — manager 7769698, served by `v5-fitted-2026-09-02`

Generated 2026-09-03 from `GET /api/insights/transfers/7769698`, `GET /api/insights/advice/7769698`
and `GET /api/squad/recommended` against the running backend, after `pnpm project` under v5
(D-037). Deadline: **Thursday 4 September 2026, 17:30 UTC** (23:15 Nepal time).

State read from the public record: GW2 squad as picked, bank **£2.3m**, **2 free transfers**
(reconstructed from the transfer log — the wildcard was played in GW2, so the count starts from
1 + 1), no chip available for GW3 except Bench Boost / Triple Captain / Free Hit, none of which the
calendar argues for.

## Transfers — two free, no hit, +13.7 expected points over GW3–7

| out | sell | in | cost | horizon EP out → in | gain |
|---|---:|---|---:|---:|---:|
| Richarlison (TOT, FWD) | £5.9m | **Thiago (BRE, FWD)** | £8.0m | 9.57 → 16.98 | +7.41 |
| Senesi (TOT, DEF) | £5.9m | **Guéhi (MCI, DEF)** | £6.0m | 9.82 → 16.15 | +6.33 |

Money: £2.3m + £5.9m + £5.9m = £14.1m out, £14.0m in, **£0.1m left**. Squad horizon expectation
230.96 → 244.71. Both outgoing players are the two the model rates least likely to play (Senesi
P(play) 0.71, Richarlison 0.84) and the two with the highest P(blank) in the squad.

The solver considered −4 hits and took none: no third move clears four points over the horizon.

## Starting eleven after the transfers (GW3 expected points per player)

Formation **3-4-3**. Captain **Saka** (5.54, best this-week projection in the squad; ARS v CHE at
home, P(haul) 0.15), vice **Mbeumo** (5.28, EVE v MUN).

| slot | player | GW3 EP | note |
|---|---|---:|---|
| GKP | Trafford (LEE) | 3.59 | BHA v LEE |
| DEF | Guéhi (MCI) | 4.68 | in this week — MCI v COV |
| DEF | Ajayi (HUL) | 4.52 | HUL v AVL |
| DEF | De Cuyper (BHA) | 4.48 | BHA v LEE |
| MID | **Saka (C)** | 5.54 | ARS v CHE |
| MID | Mbeumo (V) | 5.28 | EVE v MUN |
| MID | Foden (MCI) | 5.12 | MCI v COV |
| MID | Palmer (CHE) | 5.09 | ARS v CHE |
| FWD | Thiago (BRE) | 4.82 | in this week — BRE v SUN |
| FWD | João Pedro (CHE) | 4.57 | ARS v CHE |
| FWD | Isak (LIV) | 4.56 | IPS v LIV |

XI total **52.25**, plus the armband **57.8** expected.

Bench, in auto-sub order: **1. Petrović** (GKP, 3.35) · **2. Wieffer** (BHA DEF, 4.35) ·
**3. Gakpo** (LIV MID, 3.99) · **4. Ballard** (SUN DEF, 3.75).

If the transfers are NOT made, the eleven is 3-5-2 with Gakpo in for Thiago and Wieffer in for
Guéhi, same captain, XI 56.63 with the armband.

## What changed in the app tonight, and why the numbers above differ from last week's

- **The served model is v5** — refitted on 2024-25 + 2025-26 (the fit had stopped at 2024-25),
  with recency-weighted player rates and per-player starter minutes on (D-036's candidate, +1.0%
  captured@11 across two folds). Measured against FPL's own `ep_next` on the archive for the first
  time: the model is ahead on both folds (+0.5%, +1.9%). Blending FPL's number in, a season-start
  strength prior and a shrunk start rate were all measured and all declined (D-037).
- **The captain and the eleven are chosen on THIS week's projection**, not the five-week horizon.
  The horizon armband was Mbeumo; this week's is Saka.
- **The defence-concentration charge is retired (λ = 0).** It was benching Wieffer (4.35) for
  Ballard (3.75) on a policy B-033 measured as giving up 71 projected points a season for nothing
  detectable.

## Where the squad stands against the model's from-scratch fifteen

The unconstrained best fifteen under the same budget is 252.3 horizon points against your 230.96 —
a 21.3-point gap, which is what a wildcard would close and yours is spent. The players it holds that
you do not, in order of what they are worth over GW3–7: **B.Fernandes** (£12.0m, 21.9, its
captain), Wissa (£6.1m, 16.6), O'Reilly (£6.5m, 16.4), Nketiah (£5.5m, 15.6), Van Hecke (£5.0m,
15.5), Egan (£4.0m, 15.0), Kelleher (£5.0m, 13.1). Bruno Fernandes is the route to close most of it
over the next two or three weeks: Isak (£9.0m, 16.7) → Fernandes is a £3.0m upgrade the bank does
not cover this week; after GW3 it is the first move to price.

## What this cannot see

- Availability beyond what FPL has published at the time of the run. The pre-deadline snapshot is
  taken by the hourly sync inside the last 36 hours; re-check the app on Thursday afternoon — a
  late injury flag changes the eleven and the plan re-solves on its own.
- Press conferences, rotation intent, and the Europa/Conference midweek for BRE, NFO, CRY and AVL.
- Every number is a mean; the `pBlank` / `pHaul` columns in the app are the spread. Saka's captaincy
  is 5.54 with a 26% chance of a blank; Mbeumo's alternative is 5.28 with 33%.
