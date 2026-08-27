# Availability fit — one TEST reading (2025-26), plan 024

Paired rows: 29482 (incumbent run 29482, candidate 29482).
Brier differences are candidate − incumbent: NEGATIVE means the candidate is better.
`±` is the standard error of the paired mean difference; a diff inside ±2se is noise, and says so.

## Brier P(start)

| band | n | incumbent | candidate | diff ± se | verdict |
|---|---|---|---|---|---|
| uncertain band (d, or chance 25/50/75) — DECISIVE | 1056 | 0.11940 | 0.13323 | +0.01382 ± 0.00197 | candidate WORSE |
| all flagged (status != a) | 10005 | 0.01310 | 0.01456 | +0.00146 ± 0.00021 | candidate WORSE |
| unflagged (status a) | 19459 | 0.13356 | 0.12720 | -0.00636 ± 0.00050 | candidate better |
| unknown (no capture in bound) | 18 | 0.06489 | 0.06513 | +0.00024 ± 0.00122 | noise |
| all rows | 29482 | 0.09264 | 0.08894 | -0.00370 ± 0.00034 | candidate better |

## Brier P(play)

| band | n | incumbent | candidate | diff ± se | verdict |
|---|---|---|---|---|---|
| uncertain band (d, or chance 25/50/75) — DECISIVE | 1056 | 0.17273 | 0.20921 | +0.03649 ± 0.00442 | candidate WORSE |
| all flagged (status != a) | 10005 | 0.02023 | 0.02408 | +0.00385 ± 0.00048 | candidate WORSE |
| unflagged (status a) | 19459 | 0.12176 | 0.11279 | -0.00897 ± 0.00054 | candidate better |
| unknown (no capture in bound) | 18 | 0.15946 | 0.15374 | -0.00572 ± 0.00318 | noise |
| all rows | 29482 | 0.08733 | 0.08271 | -0.00462 ± 0.00039 | candidate better |

## Points RMSE (paired, whole test season)

incumbent 1.9412, candidate 1.9363; paired MSE diff -0.01888 ± 0.00975 — noise (leg holds)

## Ordering (precision@k, mean over rounds)

| arm | @11 | @15 | @20 | spearman |
|---|---|---|---|---|
| incumbent | 8.6% | 10.9% | 13.6% | 0.7400 |
| candidate | 10.0% | 12.3% | 14.7% | 0.7384 |

Ordering leg (no worse than incumbent within 2 points of precision at every k): holds.

## Decisive leg (plan 024)

Uncertain-band Brier must clear 2se in the candidate's favour for BOTH P(start) and P(play):
- P(start): does not clear
- P(play): does not clear

**Decisive leg NOT MET; RMSE leg holds; ordering leg holds.**
The bar needs all three. The leak-guard leg is the test suite, run separately.