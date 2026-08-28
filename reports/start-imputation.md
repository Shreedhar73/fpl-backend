# Imputed start labels

Generated 2026-08-28T14:45:45.517Z from 253,568 archive rows. Regenerate with `pnpm report:imputation`.

`starts` exists in the archive only from 2023-24, and every part of the minutes model is a regression on it — so seven of ten seasons contribute nothing to the half of the model the guide calls the real one. The rolling-origin referee measured the cost exactly: 2 of 9 folds ran. Minutes are recorded in all ten seasons and are very nearly a start label already, so the label is inferred from them — as a **probability**, because one band is genuinely ambiguous and a hard label there would hand the fit the wrong answer with no way to know which.

## The calibration, fitted on 2023-24, 2024-25, 2025-26

| minutes ≥ | rows | started | P(start) |
|---:|---:|---:|---:|
| 90 | 16,231 | 16,231 | 1.0000 |
| 80 | 2,430 | 2,416 | 0.9940 |
| 70 | 2,650 | 2,600 | 0.9810 |
| 60 | 2,174 | 2,118 | 0.9740 |
| 55 | 626 | 586 | 0.9354 |
| 50 | 187 | 145 | 0.7739 |
| 45 | 1,401 | 706 | 0.5039 |
| 30 | 872 | 130 | 0.1495 |
| 15 | 3,503 | 106 | 0.0304 |
| 1 | 4,368 | 42 | 0.0097 |

A player still on the pitch at 90 minutes started, every time. The ambiguity is one band — 45 to 59 minutes, where an early-substituted starter and a half-time substitute are the same row.

## Scored against the seasons that record the truth

Leave-one-season-out: each season is scored by a calibration fitted without it. The hard label is `p ≥ 0.5` and exists only so accuracy is readable; what the fit actually consumes is the probability, which is what the Brier column is about.

| season | rows | accuracy | Brier | imputed starters / fixture |
|---|---:|---:|---:|---:|
| 2023-24 | 11,384 | 96.50% | 0.0240 | 21.99 |
| 2024-25 | 11,566 | 96.73% | 0.0217 | 22.01 |
| 2025-26 | 11,492 | 96.54% | 0.0235 | 22.00 |

## The gate: 22 starters per fixture

Eleven a side start a match, whatever the substitution rules were that year. This is the one check on the imputation that does not depend on the era its calibration was fitted in — which matters, because the table comes from the five-substitute era and is applied to the three-substitute one. A season that fails it is not used.

| season | rows | imputed rows | fixtures | starters / fixture | passes |
|---|---:|---:|---:|---:|---|
| 2016-17 | 23,679 | 10,474 | 380 | 21.994 | yes |
| 2017-18 | 22,467 | 10,448 | 380 | 21.987 | yes |
| 2018-19 | 21,790 | 10,480 | 380 | 21.964 | yes |
| 2019-20 | 22,560 | 10,614 | 380 | 21.997 | yes |
| 2020-21 | 24,365 | 10,393 | 380 | 21.971 | yes |
| 2021-22 | 25,447 | 10,485 | 380 | 21.988 | yes |
| 2022-23 | 26,505 | 11,345 | 380 | 22.031 | yes |
| 2023-24 | 29,725 | — | 380 | 22.000 | yes |
| 2024-25 | 27,283 | — | 380 | 22.000 | yes |
| 2025-26 | 29,747 | — | 380 | 22.000 | yes |

Every season comes to 22 starters per fixture inside half a starter.
