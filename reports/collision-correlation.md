# Does a fixture collision actually work against itself? (B-028)

B-011 charges a squad for owning one of our attackers against one of our defensive players in the same match. That rule has been argued three times (B-023, B-025, B-027) and measured once — a lambda sweep asking whether the penalty **earns points**, which answered no. This measures what the penalty is *about*.

## Two things that are true before any number below

**1. A correlation cannot make a linear objective wrong in expectation.** `E[A + D] = E[A] + E[D]` however A and D covary. The collision penalty is therefore not a correction to expected points and never was — it can only be a statement about **variance**.

**2. Negative covariance REDUCES the variance of a portfolio.** `Var(A + D) = Var(A) + Var(D) + 2·Cov(A, D)`. If our attacker and their defender genuinely work against each other, holding both is a **hedge** — it narrows the range of outcomes. That is the opposite of the usual reading of B-011, and whether it is good depends on what a manager is chasing.

Measured over 86,755 archived player-fixtures. Every player-fixture with zero minutes is excluded: pairing two absences measures the correlation between two players not playing, which is real but is not what this rule is about.

## 1. The pair: our attacker against their defensive player

| season | pairs | mean attacker | mean defender | covariance | correlation | ± se |
|---|---:|---:|---:|---:|---:|---:|
| 2023-24 | 37,655 | 2.90 | 2.55 | -1.780 | -0.197 | 0.005 |
| 2024-25 | 34,005 | 2.84 | 2.53 | -1.739 | -0.208 | 0.005 |
| 2025-26 | 29,443 | 2.90 | 3.11 | -1.620 | -0.184 | 0.006 |
| **pooled** | **101,103** | 2.88 | 2.71 | **-1.715** | **-0.195** | 0.003 |

**What holding a pair does to variance.** Independent, the pair would carry 17.59 points² of variance. It actually carries 14.16 — a change of -19.5%.

## 2. What the defender scores when the attacker returns

| season | attacker returned | attacker blanked | difference | ± se | clears noise |
|---|---:|---:|---:|---:|---|
| 2023-24 | 1.40 (n=8,474) | 2.89 (n=29,181) | -1.49 | 0.028 | yes |
| 2024-25 | 1.33 (n=7,158) | 2.84 (n=26,847) | -1.51 | 0.027 | yes |
| 2025-26 | 1.78 (n=5,796) | 3.44 (n=23,647) | -1.65 | 0.032 | yes |
| **pooled** | 1.48 | 3.04 | **-1.56** | 0.017 | yes |

This is the mechanism in one number: what a defensive player is paid, on average, in matches where the attacker facing him scored or assisted, against matches where the attacker did not.

## 3. What a defensive player is actually paid for, by season

Attribution by **event**, not by fitted coefficient, so it is arithmetic that can be checked: a clean sheet is 4 to a DEF or GKP, defensive contribution 2, an appearance 1 or 2, a goal 6, an assist 3. The remainder carries cards, saves, own goals, penalties and the concession penalty, and is what makes the columns reconcile.

| season | rows | mean pts | appearance | clean sheet | defcon | goals | assists | bonus | rest | CS share | defcon share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2023-24 | 4,619 | 2.55 | 1.81 | 0.70 | 0.00 | 0.21 | 0.16 | 0.20 | -0.52 | **27.4%** | **0.0%** |
| 2024-25 | 4,557 | 2.58 | 1.81 | 0.77 | 0.00 | 0.17 | 0.13 | 0.16 | -0.45 | **29.7%** | **0.0%** |
| 2025-26 | 4,717 | 3.10 | 1.80 | 0.86 | 0.35 | 0.17 | 0.15 | 0.18 | -0.42 | **27.8%** | **11.2%** |

## 4. Does defensive work rise when the opponent attacks?

The claim B-027 leaned on and did not check. Defenders only, 60+ minutes, in seasons where the archive carries the component columns. Pressure is the goals their own team conceded that match — the only opponent-attacking signal every row carries. Buckets rather than a correlation, because there is no reason for the relationship to be linear. Actions are `defensive_contribution`, the qualifying COUNT, against the threshold the points engine uses — read as a flag that column pays 2 points to anyone who made one tackle.

**2025-26**

| conceded | rows | mean qualifying actions | P(hit the defcon threshold) | P(clean sheet) | mean points |
|---:|---:|---:|---:|---:|---:|
| 0 | 822 | 7.36 | 26.3% | 100.0% | 7.60 |
| 1 | 1,037 | 7.48 | 27.0% | 0.0% | 2.89 |
| 2 | 715 | 7.52 | 29.1% | 0.0% | 1.85 |
| 3+ | 452 | 7.44 | 24.8% | 0.0% | 1.41 |

## 5. The shape the live squad has: one attacker against TWO of their defence

| season | triples | mean total | independent variance | actual variance | Σ collision cov | defence-pair cov |
|---|---:|---:|---:|---:|---:|---:|
| 2023-24 | 6,197 | 8.47 | 28.73 | 30.35 | -4.248 | 5.058 |
| 2024-25 | 5,693 | 8.57 | 27.27 | 29.67 | -4.228 | 5.429 |
| 2025-26 | 4,757 | 10.21 | 29.19 | 33.13 | -4.004 | 5.973 |
| **pooled** | **16,647** | 9.00 | 28.64 | 31.50 | **-4.153** | **5.581** |

**The last two columns are the point of this section.** `Σ collision cov` is what B-011 prices — the attacker against each of the two defenders. `defence-pair cov` is the two defenders against **each other**, which B-011 does not price at all and which is the larger term whenever a clean sheet is what they share. A rule that charges the first and ignores the second is pricing the smaller half of the concentration it claims to be about.

### 5a. What adding the opposing attacker actually costs

The question a squad builder is really asking. You already hold two defenders of one club. Adding any attacker adds his own variance; adding an attacker who FACES them adds his variance **plus twice the covariance**, and the covariance is negative. So:

| | points² |
|---|---:|
| variance of the two defenders alone | 30.85 |
| variance the attacker carries on his own | 8.96 |
| cost of adding an UNCORRELATED attacker | 8.96 |
| cost of adding the attacker who FACES them | **0.65** |
| difference | **-8.31** (-92.7% of his own variance) |

Read that last row carefully, because it is the finding that contradicts the rule. Given a squad already holding two defenders of one club, **the opposing attacker is the safest attacker it can add** — safer than an unrelated one of the same size. B-011 charges extra for exactly that choice.

## 6. Reading it

A collision pair's realised correlation is **-0.195** (± 0.003) over 101,103 pairs. An attacker's points carry a standard deviation of 3.01 and a defensive player's 2.92; holding both changes the pair's variance by -19.5%.

Whatever that number is, it is a **variance** statement. It cannot justify a charge against expected points, because expectation is linear and the projections are honest marginally — which the optimizer skill already says. If the correlation is small, the rule is priced against something small. If it is large and negative, holding both sides is a hedge and the rule is charging for insurance.

What this measurement does **not** answer: whether a lower-variance squad is better. That depends on whether the objective is expected rank or expected points, and this project optimises expected points.

## 7. External checks, 2026-08-27

**The threshold this report scores against is the right one.** The Premier League confirmed on 20 July 2026 that defensive contributions carry into 2026/27 unchanged: 10 combined clearances, blocks, interceptions and tackles for a defender, 12 of those plus ball recoveries for a midfielder or forward, two points, capped at two per match. That matches `DEFCON_THRESHOLD` in the points engine, which the archive importer already asserts against every row that carries the components.

**The model has no head-to-head term, and this fixture is where that shows.** Team strength is rolling league-wide form (xG plus FDR), reset at each season rollover because squads turn over — there is no opponent-specific history feature anywhere in `projections/`. For CHE v BHA that omission is not academic: Brighton have won the last four meetings — 3-0 in April 2026, 3-1 in September 2025, 3-0 in February 2025 and 2-1 in the FA Cup — and Chelsea's last win in the fixture was September 2024. The model rates Chelsea the stronger side in both directions for this match (P(BHA clean sheet) 16%, P(CHE clean sheet) 22%), which is a statement about league-wide form and not about this pairing.

Whether head-to-head history should be a feature at all is a separate question and a contested one — squads change faster than fixtures repeat, and four matches is four observations. It is recorded here because "the data says Chelsea are better" is true of the data the model reads and not of the data about this fixture.

Sources: premierleague.com (defensive contribution rules, 2026/27 confirmation), sportsmole and whoscored (head-to-head record).

## 8. What this changes

1. **The collision is real and it is a hedge.** The correlation is negative, stable across three seasons, and large enough to matter: holding a pair cuts its variance by about a fifth. B-011 read that sign backwards. "Betting against itself" describes insurance.

2. **The defensive-contribution category did NOT change the arithmetic.** A defender still takes 27-30% of his points from clean sheets in every season measured, 2025-26 included; defcon added about 11% on top rather than diluting the clean sheet. And defensive work does not rise with pressure — the qualifying-action count is flat across every concession bucket. Both halves of that were asserted in B-027 and both are wrong.

3. **The concentration the rule misses is bigger than the one it prices.** Two defenders of one club covary strongly and positively — they share a clean sheet — and that term is larger than both collision terms put together and points the other way. Given a squad that already holds them, the attacker who faces them is the safest attacker it can add.

None of this decides the policy. A squad that owns both sides of a match may still be one nobody wants to defend to a user, and that is a legitimate reason to keep the rule. What the numbers remove is the *technical* justification: the rule does not fix an error in the projections, and it charges for a variance reduction rather than an increase.

