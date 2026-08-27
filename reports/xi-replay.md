# The XI replay (B-025)

What the solver's OWN eleven scored, round by round, over an archived season. Every other
harness in this repo re-chooses the lineup by predicted points and is therefore blind to the
LP's `y` and `k` columns — which is how a knob acting only through them came to be tuned on
measurements that could not observe it.

One section per arm. Regenerate with `pnpm replay:xi -- --label <arm>`.

**A section is only as current as the commit that produced it.** The objective under test is
whatever `ilp.ts` emitted at the time, so re-running a label re-solves with TODAY's objective
under that heading — which would silently overwrite a baseline arm with the thing it is the
baseline for. Name arms after the change, not after the run.

## penalty on the XI (before B-025)

Bench weight 0.7, collision lambda 1. Season 2025-26, fifteen bought in round 1 and held — no transfers, so every difference between arms is the objective.

| | |
|---|---:|
| rounds | 38 |
| realised points (the LP's own XI) | 1604 |
| ceiling (best XI these fifteen could field) | 1838 |
| XI efficiency | 87.3% |
| rounds owning a conflicting pair | 38 |
| rounds starting both sides of one | 8 |
| projected points forgone in the XI and armband | 78.56 |
| rounds forgoing any | 34 |

**The fifteen.** Zeki Amdouni (FWD, T90), Ismaïla Sarr (MID, T31), Matz Sels (GKP, T17), Pedro Porro Sauceda (DEF, T6), Maximilian Kilman (DEF, T21), Cole Palmer (MID, T8), Maxence Lacroix (DEF, T31), Nicolas Jackson (FWD, T8), Bernd Leno (GKP, T54), Darwin Núñez Ribeiro (FWD, T14), Mohamed Salah (MID, T14), Nikola Milenković (DEF, T17), Diogo Dalot Teixeira (DEF, T1), Bruno Guimarães Rodriguez Moura (MID, T4), Bruno Borges Fernandes (MID, T1).

**Rounds where the solver benched a better-projected player**, worst first. This is the shape of the GW2 complaint that opened B-025, counted over a season rather than argued from one solve.

| round | forgone | benched | for |
|---:|---:|---|---|
| 37 | 1.35 | Nikola Milenković (3.06) | Maximilian Kilman (1.70) |
| 37 | 0.15 | Bruno Guimarães Rodriguez Moura (2.55) | Ismaïla Sarr (2.39) |
| 37 | 0.03 | Pedro Porro Sauceda (2.48) | Diogo Dalot Teixeira (2.45) |
| 2 | 1.02 | Ismaïla Sarr (5.08) | Bruno Guimarães Rodriguez Moura (4.06) |
| 2 | 0.37 | Maximilian Kilman (3.63) | Diogo Dalot Teixeira (3.26) |
| 2 | 0.33 | Bernd Leno (3.35) | Matz Sels (3.01) |
| 12 | 1.30 | Ismaïla Sarr (3.14) | Cole Palmer (1.84) |
| 12 | 1.18 | Nikola Milenković (3.44) | Diogo Dalot Teixeira (2.26) |
| 17 | 1.78 | Maxence Lacroix (4.66) | Maximilian Kilman (2.88) |
| 17 | 0.06 | Darwin Núñez Ribeiro (0.18) | Zeki Amdouni (0.12) |
| 11 | 3.35 | Bruno Borges Fernandes (5.34) | Cole Palmer (2.00) |
| 11 | 0.01 | Darwin Núñez Ribeiro (0.20) | Nicolas Jackson (0.19) |
| 13 | 0.82 | Maximilian Kilman (3.94) | Pedro Porro Sauceda (3.12) |
| 13 | 0.21 | Bernd Leno (3.47) | Matz Sels (3.25) |
| 20 | 1.07 | Bernd Leno (3.51) | Matz Sels (2.44) |
| 20 | 0.02 | Nicolas Jackson (0.14) | Zeki Amdouni (0.12) |
| 35 | 0.66 | Diogo Dalot Teixeira (2.48) | Maximilian Kilman (1.82) |
| 35 | 0.66 | Cole Palmer (3.02) | Ismaïla Sarr (2.37) |
| 35 | 0.04 | Nicolas Jackson (0.14) | Zeki Amdouni (0.10) |
| 34 | 1.04 | Mohamed Salah (3.28) | Bruno Guimarães Rodriguez Moura (2.25) |
| 34 | 0.15 | Darwin Núñez Ribeiro (0.15) | Zeki Amdouni (0.00) |
| 14 | 0.47 | Maximilian Kilman (2.70) | Diogo Dalot Teixeira (2.23) |

<details><summary>Every round</summary>

| round | points | ceiling | formation | owned pairs | started | captain exposure | forgone |
|---:|---:|---:|---|---:|---:|---:|---:|
| 1 | 46 | 47 | 3-5-2 | 6 | 0 | 0 | 0.51 |
| 2 | 39 | 43 | 4-4-2 | 6 | 0 | 0 | 5.03 |
| 3 | 54 | 62 | 4-5-1 | 5 | 0 | 0 | 2.14 |
| 4 | 44 | 51 | 5-4-1 | 4 | 0 | 0 | 3.19 |
| 5 | 29 | 36 | 4-4-2 | 6 | 0 | 0 | 2.60 |
| 6 | 28 | 38 | 4-5-1 | 6 | 0 | 0 | 2.31 |
| 7 | 53 | 66 | 5-4-1 | 3 | 0 | 0 | 0.91 |
| 8 | 28 | 35 | 4-4-2 | 6 | 0 | 0 | 1.81 |
| 9 | 46 | 53 | 4-5-1 | 2 | 0 | 0 | 0.03 |
| 10 | 53 | 53 | 5-3-2 | 7 | 1 | 0 | 2.73 |
| 11 | 35 | 35 | 5-4-1 | 10 | 3 | 0 | 4.45 |
| 12 | 47 | 58 | 4-4-2 | 6 | 0 | 0 | 4.56 |
| 13 | 36 | 36 | 3-5-2 | 5 | 1 | 0 | 4.03 |
| 14 | 45 | 65 | 3-5-2 | 5 | 1 | 0 | 3.29 |
| 15 | 65 | 65 | 5-4-1 | 4 | 1 | 0 | 1.54 |
| 16 | 56 | 56 | 5-4-1 | 1 | 0 | 0 | -0.00 |
| 17 | 20 | 26 | 3-5-2 | 6 | 1 | 0 | 4.56 |
| 18 | 42 | 52 | 4-4-2 | 3 | 0 | 0 | 2.89 |
| 19 | 36 | 44 | 5-4-1 | 1 | 0 | 0 | 0.32 |
| 20 | 29 | 36 | 5-3-2 | 14 | 3 | 0 | 3.61 |
| 21 | 41 | 44 | 5-4-1 | 7 | 0 | 0 | 0.07 |
| 22 | 43 | 59 | 5-4-1 | 1 | 0 | 0 | 0.80 |
| 23 | 28 | 38 | 5-4-1 | 3 | 0 | 0 | 0.50 |
| 24 | 34 | 43 | 5-3-2 | 5 | 0 | 0 | 2.93 |
| 25 | 84 | 95 | 4-5-1 | 2 | 0 | 0 | 0.28 |
| 26 | 39 | 48 | 4-4-2 | 3 | 0 | 0 | 3.08 |
| 27 | 27 | 30 | 5-4-1 | 4 | 0 | 0 | 0.74 |
| 28 | 26 | 38 | 4-4-2 | 4 | 1 | 0 | 2.19 |
| 29 | 54 | 61 | 4-4-2 | 2 | 0 | 0 | 2.51 |
| 30 | 52 | 52 | 4-5-1 | 2 | 0 | 0 | -0.00 |
| 31 | 42 | 46 | 4-4-2 | 1 | 0 | 0 | 0.00 |
| 32 | 32 | 36 | 5-4-1 | 3 | 0 | 0 | 0.99 |
| 33 | 65 | 71 | 4-5-1 | 3 | 0 | 0 | 0.00 |
| 34 | 48 | 51 | 5-3-2 | 2 | 0 | 0 | 3.44 |
| 35 | 29 | 37 | 4-4-2 | 6 | 0 | 0 | 3.58 |
| 36 | 25 | 28 | 5-4-1 | 2 | 0 | 0 | 0.37 |
| 37 | 39 | 39 | 3-4-3 | 5 | 0 | 0 | 6.08 |
| 38 | 65 | 65 | 5-4-1 | 1 | 0 | 0 | 0.50 |

</details>

## no collision penalty (lambda 0)

Bench weight 0.7, collision lambda 0. Season 2025-26, fifteen bought in round 1 and held — no transfers, so every difference between arms is the objective.

| | |
|---|---:|
| rounds | 38 |
| realised points (the LP's own XI) | 1673 |
| ceiling (best XI these fifteen could field) | 1902 |
| XI efficiency | 88.0% |
| rounds owning a conflicting pair | 33 |
| rounds starting both sides of one | 31 |
| projected points forgone in the XI and armband | -0.00 |
| rounds forgoing any | 0 |

**The fifteen.** Ismaïla Sarr (MID, T31), Matz Sels (GKP, T17), Pedro Porro Sauceda (DEF, T6), Bryan Mbeumo (MID, T1), Maximilian Kilman (DEF, T21), Cole Palmer (MID, T8), Maxence Lacroix (DEF, T31), Nicolas Jackson (FWD, T8), Bernd Leno (GKP, T54), Darwin Núñez Ribeiro (FWD, T14), Nikola Milenković (DEF, T17), Ollie Watkins (FWD, T7), Daniel Muñoz Mejía (DEF, T31), Luis Díaz Marulanda (MID, T14), Bruno Borges Fernandes (MID, T1).

**No round benched a better-projected player for a worse one.** That is the claim this harness exists to be able to make or refuse, and here it is made.
<details><summary>Every round</summary>

| round | points | ceiling | formation | owned pairs | started | captain exposure | forgone |
|---:|---:|---:|---|---:|---:|---:|---:|
| 1 | 38 | 44 | 3-5-2 | 6 | 2 | 1 | -0.00 |
| 2 | 40 | 40 | 5-4-1 | 8 | 6 | 1 | -0.00 |
| 3 | 72 | 73 | 5-4-1 | 9 | 7 | 0 | -0.00 |
| 4 | 35 | 48 | 5-4-1 | 6 | 4 | 0 | -0.00 |
| 5 | 36 | 38 | 5-4-1 | 1 | 1 | 0 | -0.00 |
| 6 | 31 | 45 | 5-4-1 | 6 | 2 | 0 | -0.00 |
| 7 | 45 | 51 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 8 | 46 | 49 | 5-4-1 | 7 | 5 | 0 | 0.00 |
| 9 | 48 | 59 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 10 | 43 | 46 | 5-4-1 | 10 | 5 | 1 | 0.00 |
| 11 | 43 | 45 | 5-4-1 | 12 | 6 | 3 | 0.00 |
| 12 | 51 | 65 | 5-4-1 | 8 | 4 | 0 | 0.00 |
| 13 | 32 | 33 | 5-4-1 | 7 | 5 | 2 | 0.00 |
| 14 | 54 | 70 | 5-4-1 | 4 | 3 | 1 | 0.00 |
| 15 | 60 | 60 | 5-4-1 | 6 | 6 | 2 | -0.00 |
| 16 | 53 | 53 | 5-4-1 | 2 | 2 | 0 | 0.00 |
| 17 | 23 | 29 | 5-4-1 | 10 | 4 | 2 | 0.00 |
| 18 | 36 | 48 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 19 | 29 | 37 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 20 | 24 | 28 | 5-4-1 | 15 | 5 | 0 | 0.00 |
| 21 | 31 | 31 | 5-4-1 | 6 | 4 | 1 | 0.00 |
| 22 | 46 | 62 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 23 | 41 | 53 | 5-4-1 | 4 | 2 | 1 | -0.00 |
| 24 | 32 | 40 | 5-4-1 | 6 | 4 | 0 | 0.00 |
| 25 | 74 | 85 | 5-4-1 | 2 | 2 | 1 | 0.00 |
| 26 | 38 | 47 | 5-4-1 | 2 | 2 | 0 | 0.00 |
| 27 | 34 | 39 | 5-4-1 | 4 | 0 | 0 | 0.00 |
| 28 | 40 | 40 | 5-4-1 | 6 | 4 | 2 | 0.00 |
| 29 | 47 | 54 | 5-4-1 | 1 | 1 | 0 | -0.00 |
| 30 | 51 | 51 | 5-4-1 | 2 | 0 | 0 | 0.00 |
| 31 | 52 | 56 | 3-4-3 | 1 | 1 | 0 | 0.00 |
| 32 | 29 | 30 | 5-4-1 | 4 | 1 | 0 | 0.00 |
| 33 | 74 | 85 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 34 | 52 | 55 | 5-4-1 | 5 | 3 | 0 | 0.00 |
| 35 | 24 | 32 | 5-4-1 | 5 | 2 | 0 | 0.00 |
| 36 | 29 | 35 | 5-4-1 | 0 | 0 | 0 | -0.00 |
| 37 | 60 | 66 | 5-4-1 | 6 | 3 | 1 | 0.00 |
| 38 | 80 | 80 | 5-4-1 | 0 | 0 | 0 | 0.00 |

</details>

## penalty on ownership (after B-025)

Bench weight 0.7, collision lambda 1. Season 2025-26, fifteen bought in round 1 and held — no transfers, so every difference between arms is the objective.

| | |
|---|---:|
| rounds | 38 |
| realised points (the LP's own XI) | 1713 |
| ceiling (best XI these fifteen could field) | 1968 |
| XI efficiency | 87.0% |
| rounds owning a conflicting pair | 30 |
| rounds starting both sides of one | 27 |
| projected points forgone in the XI and armband | 0.00 |
| rounds forgoing any | 0 |

**The fifteen.** Ismaïla Sarr (MID, T31), Ezri Konsa Ngoyo (DEF, T7), Matz Sels (GKP, T17), Pedro Porro Sauceda (DEF, T6), Bryan Mbeumo (MID, T1), Virgil van Dijk (DEF, T14), Cole Palmer (MID, T8), Nicolas Jackson (FWD, T8), Bernd Leno (GKP, T54), Darwin Núñez Ribeiro (FWD, T14), Nikola Milenković (DEF, T17), Ollie Watkins (FWD, T7), Diogo Dalot Teixeira (DEF, T1), Luis Díaz Marulanda (MID, T14), Bruno Borges Fernandes (MID, T1).

**No round benched a better-projected player for a worse one.** That is the claim this harness exists to be able to make or refuse, and here it is made.
<details><summary>Every round</summary>

| round | points | ceiling | formation | owned pairs | started | captain exposure | forgone |
|---:|---:|---:|---|---:|---:|---:|---:|
| 1 | 32 | 36 | 3-5-2 | 0 | 0 | 0 | 0.00 |
| 2 | 36 | 36 | 5-4-1 | 8 | 3 | 0 | 0.00 |
| 3 | 59 | 59 | 5-4-1 | 3 | 1 | 0 | 0.00 |
| 4 | 37 | 50 | 5-4-1 | 6 | 4 | 0 | 0.00 |
| 5 | 36 | 38 | 3-5-2 | 2 | 0 | 0 | 0.00 |
| 6 | 27 | 41 | 5-4-1 | 3 | 3 | 0 | 0.00 |
| 7 | 45 | 52 | 5-4-1 | 2 | 1 | 0 | 0.00 |
| 8 | 41 | 43 | 5-4-1 | 12 | 7 | 1 | 0.00 |
| 9 | 53 | 64 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 10 | 34 | 36 | 5-4-1 | 12 | 7 | 2 | -0.00 |
| 11 | 37 | 39 | 5-4-1 | 9 | 3 | 1 | 0.00 |
| 12 | 29 | 37 | 5-4-1 | 4 | 0 | 0 | 0.00 |
| 13 | 44 | 45 | 5-4-1 | 2 | 2 | 0 | 0.00 |
| 14 | 51 | 68 | 5-4-1 | 2 | 1 | 0 | 0.00 |
| 15 | 63 | 63 | 5-4-1 | 2 | 2 | 0 | 0.00 |
| 16 | 61 | 61 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 17 | 25 | 31 | 5-4-1 | 7 | 5 | 1 | 0.00 |
| 18 | 48 | 61 | 5-4-1 | 3 | 2 | 0 | 0.00 |
| 19 | 34 | 43 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 20 | 25 | 29 | 5-4-1 | 12 | 4 | 0 | -0.00 |
| 21 | 36 | 36 | 5-4-1 | 3 | 2 | 0 | -0.00 |
| 22 | 54 | 69 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 23 | 58 | 66 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 24 | 37 | 44 | 5-4-1 | 4 | 3 | 1 | 0.00 |
| 25 | 72 | 83 | 5-4-1 | 2 | 2 | 1 | 0.00 |
| 26 | 61 | 72 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 27 | 57 | 57 | 5-4-1 | 4 | 0 | 0 | -0.00 |
| 28 | 39 | 45 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 29 | 48 | 55 | 5-4-1 | 3 | 2 | 0 | -0.00 |
| 30 | 39 | 47 | 5-4-1 | 5 | 3 | 0 | 0.00 |
| 31 | 52 | 66 | 5-4-1 | 0 | 0 | 0 | -0.00 |
| 32 | 31 | 37 | 5-4-1 | 4 | 1 | 0 | 0.00 |
| 33 | 71 | 82 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 34 | 52 | 56 | 5-4-1 | 2 | 2 | 1 | 0.00 |
| 35 | 24 | 32 | 5-4-1 | 9 | 4 | 1 | 0.00 |
| 36 | 28 | 34 | 5-4-1 | 2 | 1 | 0 | -0.00 |
| 37 | 68 | 74 | 5-4-1 | 9 | 4 | 1 | 0.00 |
| 38 | 69 | 81 | 5-4-1 | 0 | 0 | 0 | 0.00 |

</details>

## penalty on ownership, raw lambda (B-026)

Bench weight 0.7, collision lambda 1. Season 2025-26, fifteen bought in round 1 and held — no transfers, so every difference between arms is the objective.

| | |
|---|---:|
| rounds | 38 |
| realised points (the LP's own XI) | 1713 |
| ceiling (best XI these fifteen could field) | 1968 |
| XI efficiency | 87.0% |
| rounds owning a conflicting pair | 30 |
| rounds starting both sides of one | 27 |
| projected points forgone in the XI and armband | 0.00 |
| rounds forgoing any | 0 |

**The fifteen.** Ismaïla Sarr (MID, T31), Ezri Konsa Ngoyo (DEF, T7), Matz Sels (GKP, T17), Pedro Porro Sauceda (DEF, T6), Bryan Mbeumo (MID, T1), Virgil van Dijk (DEF, T14), Cole Palmer (MID, T8), Nicolas Jackson (FWD, T8), Bernd Leno (GKP, T54), Darwin Núñez Ribeiro (FWD, T14), Nikola Milenković (DEF, T17), Ollie Watkins (FWD, T7), Diogo Dalot Teixeira (DEF, T1), Luis Díaz Marulanda (MID, T14), Bruno Borges Fernandes (MID, T1).

**No round benched a better-projected player for a worse one.** That is the claim this harness exists to be able to make or refuse, and here it is made.
<details><summary>Every round</summary>

| round | points | ceiling | formation | owned pairs | started | captain exposure | forgone |
|---:|---:|---:|---|---:|---:|---:|---:|
| 1 | 32 | 36 | 3-5-2 | 0 | 0 | 0 | 0.00 |
| 2 | 36 | 36 | 5-4-1 | 8 | 3 | 0 | 0.00 |
| 3 | 59 | 59 | 5-4-1 | 3 | 1 | 0 | 0.00 |
| 4 | 37 | 50 | 5-4-1 | 6 | 4 | 0 | 0.00 |
| 5 | 36 | 38 | 3-5-2 | 2 | 0 | 0 | 0.00 |
| 6 | 27 | 41 | 5-4-1 | 3 | 3 | 0 | 0.00 |
| 7 | 45 | 52 | 5-4-1 | 2 | 1 | 0 | 0.00 |
| 8 | 41 | 43 | 5-4-1 | 12 | 7 | 1 | 0.00 |
| 9 | 53 | 64 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 10 | 34 | 36 | 5-4-1 | 12 | 7 | 2 | -0.00 |
| 11 | 37 | 39 | 5-4-1 | 9 | 3 | 1 | 0.00 |
| 12 | 29 | 37 | 5-4-1 | 4 | 0 | 0 | 0.00 |
| 13 | 44 | 45 | 5-4-1 | 2 | 2 | 0 | 0.00 |
| 14 | 51 | 68 | 5-4-1 | 2 | 1 | 0 | 0.00 |
| 15 | 63 | 63 | 5-4-1 | 2 | 2 | 0 | 0.00 |
| 16 | 61 | 61 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 17 | 25 | 31 | 5-4-1 | 7 | 5 | 1 | 0.00 |
| 18 | 48 | 61 | 5-4-1 | 3 | 2 | 0 | 0.00 |
| 19 | 34 | 43 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 20 | 25 | 29 | 5-4-1 | 12 | 4 | 0 | -0.00 |
| 21 | 36 | 36 | 5-4-1 | 3 | 2 | 0 | -0.00 |
| 22 | 54 | 69 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 23 | 58 | 66 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 24 | 37 | 44 | 5-4-1 | 4 | 3 | 1 | 0.00 |
| 25 | 72 | 83 | 5-4-1 | 2 | 2 | 1 | 0.00 |
| 26 | 61 | 72 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 27 | 57 | 57 | 5-4-1 | 4 | 0 | 0 | -0.00 |
| 28 | 39 | 45 | 5-4-1 | 1 | 1 | 0 | 0.00 |
| 29 | 48 | 55 | 5-4-1 | 3 | 2 | 0 | -0.00 |
| 30 | 39 | 47 | 5-4-1 | 5 | 3 | 0 | 0.00 |
| 31 | 52 | 66 | 5-4-1 | 0 | 0 | 0 | -0.00 |
| 32 | 31 | 37 | 5-4-1 | 4 | 1 | 0 | 0.00 |
| 33 | 71 | 82 | 5-4-1 | 0 | 0 | 0 | 0.00 |
| 34 | 52 | 56 | 5-4-1 | 2 | 2 | 1 | 0.00 |
| 35 | 24 | 32 | 5-4-1 | 9 | 4 | 1 | 0.00 |
| 36 | 28 | 34 | 5-4-1 | 2 | 1 | 0 | -0.00 |
| 37 | 68 | 74 | 5-4-1 | 9 | 4 | 1 | 0.00 |
| 38 | 69 | 81 | 5-4-1 | 0 | 0 | 0 | 0.00 |

</details>
