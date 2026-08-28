# Archive coverage — which column exists in which season

Generated 2026-08-28T13:34:30.585Z from 253,568 rows over 10 seasons. Regenerate with `pnpm report:coverage`.

The archive is **not rectangular**, and code written for the newest shape does not fail on the oldest — it reads an absent column as zero. This table is what `assertShape` holds the database to on every read, so a column that stops arriving throws instead of quietly shrinking a sample.

| season | rows | rounds | starts | expectedGoals | expectedAssists | expectedGoalsConceded | defensiveContribution | influence | creativity | threat |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2016-17 | 23,679 | 38 | — | — | — | — | — | 23,679 | 23,679 | 23,679 |
| 2017-18 | 22,467 | 38 | — | — | — | — | — | 22,467 | 22,467 | 22,467 |
| 2018-19 | 21,790 | 38 | — | — | — | — | — | 21,790 | 21,790 | 21,790 |
| 2019-20 | 22,560 | 38 | — | — | — | — | — | 22,560 | 22,560 | 22,560 |
| 2020-21 | 24,365 | 38 | — | — | — | — | — | 24,365 | 24,365 | 24,365 |
| 2021-22 | 25,447 | 38 | — | — | — | — | — | 25,447 | 25,447 | 25,447 |
| 2022-23 | 26,505 | 37 | — | 26,505 | 26,505 | 26,505 | — | 26,505 | 26,505 | 26,505 |
| 2023-24 | 29,725 | 38 | 29,725 | 29,725 | 29,725 | 29,725 | — | 29,725 | 29,725 | 29,725 |
| 2024-25 | 27,283 | 38 | 27,283 | 27,283 | 27,283 | 27,283 | — | 27,283 | 27,283 | 27,283 |
| 2025-26 | 29,747 | 38 | 29,747 | 29,747 | 29,747 | 29,747 | 29,747 | 29,747 | 29,747 | 29,747 |

## What each column being absent costs

- **starts** — from 2023-24. 3 of 10 seasons, 86,755 rows.
- **expectedGoals** — from 2022-23. 4 of 10 seasons, 113,260 rows.
- **expectedAssists** — from 2022-23. 4 of 10 seasons, 113,260 rows.
- **expectedGoalsConceded** — from 2022-23. 4 of 10 seasons, 113,260 rows.
- **defensiveContribution** — from 2025-26. 1 of 10 seasons, 29,747 rows.
- **influence** — from 2016-17. 10 of 10 seasons, 253,568 rows.
- **creativity** — from 2016-17. 10 of 10 seasons, 253,568 rows.
- **threat** — from 2016-17. 10 of 10 seasons, 253,568 rows.

## Irregular seasons

- **2019-20** — 38 rounds. suspended in March 2020; FPL renumbered the restart, so the season runs 1–29 then 39–47.
- **2022-23** — 37 rounds. round 7 postponed in full in September 2022 and never replayed under that number.
