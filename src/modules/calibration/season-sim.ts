import highsLoader from 'highs';
import { PositionCode } from '../fpl-sync/mappers';
import { buildTransferLp, OwnedCandidate } from '../transfers/transfer-lp';
import {
  buildLp,
  LpSolution,
  SquadObjective,
  Candidate,
  Concentration,
  defencePairs,
  NO_CONCENTRATION,
  readSolution,
} from '../optimizer/ilp';
import { Rules } from '../optimizer/rules';
import { BENCH_WEIGHT } from '../optimizer/policy';
import { Predictor, PredictionRow } from './harness';
import { chooseLineup, playingTeams, slotFor } from './xi-decision';
import { scoreLineup } from './squad-scoring';

/**
 * A full season, walked under the real FPL rules (B-012 Phase 3).
 *
 * This is the number the product charter §6 asks for and the only one that prices a **policy** rather
 * than a prediction: a squad's value is its path — who you can move to next week, how many free
 * transfers you hold, how much your squad is worth. Ordering metrics say the model ranks the top of
 * the field better; they cannot say whether that turns into points once you can only change one
 * player a week.
 *
 * **The transfer policy is a parameter, and the two that ship are deliberately dumb.** Choosing
 * transfers *well* — hit thresholds, multi-week lookahead, chip windows — is B-008, which plugs into
 * this interface. Building the planner here would mean grading a planner with a harness written to
 * flatter it.
 *
 * **Chips are unused in every simulated season.** A wildcard or free hit changes the transfer policy,
 * which is B-008's; bench boost and triple captain are single-week variance bets that need B-017's
 * distributions to be chosen honestly. An unused chip is a known handicap applied equally to every
 * predictor. A *guessed* chip is a confound.
 */

export interface OwnedPlayer {
  playerCode: number;
  /** what we paid, in tenths — the sell-price rule needs the purchase price, never the market price */
  purchasePrice: number;
  /**
   * The position we own this player in.
   *
   * **Carried on the squad, not looked up in the round's market.** A transfer is position-locked, and
   * the policy used to read the outgoing player's position off `market.get(code)?.position` — which
   * is `undefined` for a player with no row that round, i.e. one who blanked. The check was written
   * `outPosition !== undefined && row.position !== outPosition`, so it disengaged **exactly** when
   * the data was thin, and a keeper could be sold for a midfielder.
   *
   * That went unnoticed until B-023 gave the bench genuine fodder — players who often have no row at
   * all. Over 38 rounds the squad drifted to 0 GKP / 7 DEF / 6 MID / 2 FWD, and the season died with
   * "no legal XI" hundreds of rounds from the cause.
   */
  position: PositionCode;
}

export interface SquadState {
  owned: OwnedPlayer[];
  /** tenths */
  bank: number;
  freeTransfers: number;
}

export interface SimRound {
  /** the chip played this round, or null — see `SimOptions.chips` */
  chip?: 'TC' | 'BB' | null;
  round: number;
  points: number;
  /** points lost to hits this round, as a positive number */
  hitCost: number;
  transfersMade: number;
  freeTransfersAfter: number;
  bank: number;
  squadValue: number;
  substitutions: number;
  captainPoints: number;
  /**
   * The fifteen held while this round was played, by player code, sorted.
   *
   * Carried so two arms of the same season can be compared on **how much of their squad they share**
   * (B-031). A paired season comparison at s.e. ≈ 2.6 a round cannot see anything under about 190
   * points; two arms holding mostly the same players see far more, because the round-to-round
   * variance that dominates a season total is common to both and cancels in the pairing. The overlap
   * is what says whether the pairing was tight, so it is measured rather than assumed.
   */
  squad: number[];
}

export interface SeasonResult {
  predictor: Predictor;
  policy: string;
  /** how the opening fifteen was chosen, when it was not this predictor's own solve */
  squadLabel?: string;
  rounds: SimRound[];
  totalPoints: number;
  totalHitCost: number;
  totalTransfers: number;
  /** squad sell value + bank at the final round */
  finalTeamValue: number;
}

/**
 * The sell-price rule: purchase price plus **half the profit, rounded down** to £0.1m. A loss is
 * eaten whole.
 *
 * Using the market price here silently invents money and produces squads the manager could not have
 * bought — the single most common way a backtest flatters itself.
 */
export function sellValue(purchasePrice: number, marketPrice: number): number {
  if (marketPrice <= purchasePrice) return marketPrice;
  return purchasePrice + Math.floor((marketPrice - purchasePrice) / 2);
}

/**
 * Free transfers roll and cap. One is granted per round and the bank never exceeds the cap.
 *
 * The cap of five holds for 2024-25 onward (`fpl-agent-guide` §2.2 — it was one, then two, then
 * five). A season simulated before that needs its own rule; the caller passes the cap rather than
 * this file assuming one, because a rule that has changed before will change again.
 */
export function grantFreeTransfer(current: number, cap: number): number {
  return Math.min(current + 1, cap);
}

export interface SimPolicy {
  label: string;
  /**
   * Which players to sell and buy before this round. Returns `[]` to hold.
   *
   * Called with the state as it stands BEFORE the round is played, and with only the predictions
   * available at that deadline — the leak-safety comes from `walkRounds`, which built those rows
   * without seeing the round they describe.
   */
  decide(
    state: SquadState,
    market: Map<number, PredictionRow>,
    prices: Map<number, number>,
    predictor: Predictor,
    rules: Rules,
  ): { out: number; in: number }[];
}

/** Hold the opening squad to the last round. The floor: how much of a season is just the first pick. */
export const NO_TRANSFER: SimPolicy = {
  label: 'no-transfer',
  decide: () => [],
};

/**
 * One free transfer a round, taken only when it is free and only when it improves this round's
 * projection. Never takes a hit.
 *
 * **A deliberately weak policy, and the report says so.** It is myopic (one round, no horizon), it
 * never spends a banked transfer on a double move, and it cannot take a −4 however obviously right
 * one would be. A season total produced by it is a **floor** on what a policy could do, not an
 * estimate of it.
 *
 * **The horizon simplification is exact rather than approximate, and that is worth stating.** Both
 * fixture elasticities fitted to 0 (B-014), so the model's projection for a player does not vary by
 * opponent; given unchanged features it is the same number for every future round, which makes a
 * decayed horizon a constant multiple of the one-round projection. `form` and last season's
 * points-per-90 are scalars and behave the same way. So ranking candidates by horizon EP and ranking
 * them by this round's EP produce the **same order**, and a greedy argmax cannot tell the two apart.
 * When B-014 gives the fixture term a real coefficient, this stops being true and the policy needs a
 * genuine horizon.
 */
export const GREEDY_ONE_FT: SimPolicy = {
  label: 'greedy-1ft',
  decide(state, market, prices, predictor, rules) {
    if (state.freeTransfers < 1) return [];

    const ownedCodes = new Set(state.owned.map((o) => o.playerCode));
    const scoreOf = (code: number) =>
      market.get(code)?.predicted[predictor] ?? 0;

    // Club counts, so a transfer cannot break the three-per-club cap.
    const clubOf = (code: number) => market.get(code)?.teamCode ?? null;
    const clubCount = new Map<number, number>();
    for (const o of state.owned) {
      const t = clubOf(o.playerCode);
      if (t !== null) clubCount.set(t, (clubCount.get(t) ?? 0) + 1);
    }

    let best: { out: number; in: number; gain: number } | null = null;

    for (const owned of state.owned) {
      const outPrice = prices.get(owned.playerCode);
      if (outPrice === undefined) continue;
      const proceeds = sellValue(owned.purchasePrice, outPrice);
      const outScore = scoreOf(owned.playerCode);
      const outClub = clubOf(owned.playerCode);

      for (const [code, row] of market) {
        if (ownedCodes.has(code)) continue;
        // Like for like: FPL transfers are position-locked, and a squad that swapped a defender for
        // a midfielder would fail the quota check the moment it was validated.
        //
        // Read off the SQUAD, never off this round's market. The market has no row for a player who
        // blanked, and the previous `outPosition !== undefined &&` guard turned the rule off exactly
        // then — which is the round it matters most.
        if (row.position !== owned.position) continue;
        if (row.teamCode === null) continue;
        const cost = prices.get(code);
        if (cost === undefined) continue;
        if (state.bank + proceeds < cost) continue;

        // The three-per-club cap, counted after the outgoing player has left.
        const already =
          (clubCount.get(row.teamCode) ?? 0) -
          (outClub === row.teamCode ? 1 : 0);
        if (already >= rules.clubLimit()) continue;

        const gain = (row.predicted[predictor] ?? 0) - outScore;
        if (gain <= 0) continue;
        // Ties broken on `playerCode`, low first (B-039). `market` is a Map, so it iterates in
        // insertion order, and `gain > best.gain` alone means the first equal-gain move seen wins —
        // which made this week's transfer a function of the order Postgres returned the rows in.
        // A different player transferred in week 3 is a different squad for the rest of the season:
        // measured 2026-08-28, two identical runs put the `greedy-1ft` `form` arm 165 points apart.
        const better =
          !best ||
          gain > best.gain ||
          (gain === best.gain &&
            (code < best.in ||
              (code === best.in && owned.playerCode < best.out)));
        if (better) {
          best = { out: owned.playerCode, in: code, gain };
        }
      }
    }

    return best ? [{ out: best.out, in: best.in }] : [];
  },
};

/** Build the best legal fifteen by a predictor's numbers at one round. */
export async function openingSquad(
  rows: PredictionRow[],
  predictor: Predictor,
  rules: Rules,
  /**
   * What to use when the predictor has nothing to say — which for `form` is EVERY player at a
   * season's first deadline, because form is this season's trailing rounds and there are none.
   * That lands at the worst possible moment: it is exactly the squad a no-transfer policy then holds
   * for the rest of the season. The caller passes last season's points-per-90, which is the only
   * signal knowable at that point and is the charter's own naive baseline.
   */
  fallback: Predictor | null,
  /** What a bench place is worth. Passed in so a sweep can vary it without touching this file. */
  benchWeight = BENCH_WEIGHT,
  /**
   * The defensive-concentration lambda (B-029), or null for an unpenalised solve.
   *
   * A lambda rather than ready-made pairs: the pairs name candidates and the candidates are built
   * inside this function, so handing them in would make the LP's `d` rows depend on two lists
   * agreeing about keys — a coupling nobody would notice breaking.
   *
   * Defaults to none, which is what the decision report and the bench sweep have always solved
   * without. The replay harness passes the real value, because a harness that chose its opening
   * fifteen under a different objective would be measuring something the product does not serve.
   */
  concentrationLambda: number | null = null,
  /**
   * Which objective to solve the opening fifteen under (B-031).
   *
   * Defaults to what the product serves. The other value reproduces the objective B-023 replaced,
   * and exists so the replacement can be measured against it — see `SquadObjective` in `ilp.ts`. It
   * reaches this function only from a harness, never from a serving path.
   */
  objective: SquadObjective = 'xi-bench-captain',
): Promise<PredictionRow[]> {
  // Sorted before the LP is written (B-039). Measured 2026-08-28: two runs produced different
  // candidate orders and therefore different LP strings, and HiGHS returned the SAME fifteen from
  // both — so this is inert on the data we have, and kept anyway. It is inert by luck: nothing about
  // the solver promises one optimum among several is chosen by anything but variable order.
  const candidates: Candidate[] = [...rows]
    .sort((a, b) => a.playerCode - b.playerCode)
    .filter((r) => r.teamCode !== null)
    .map((r) => ({
      key: `p_${r.playerCode}`,
      playerId: String(r.playerCode),
      webName: r.webName,
      position: r.position as PositionCode,
      teamId: String(r.teamCode),
      teamShortName: `T${r.teamCode}`,
      cost: r.value,
      ep:
        r.predicted[predictor] ?? (fallback ? (r.predicted[fallback] ?? 0) : 0),
      pPlay: r.pPlay,
      appearances: r.appearances,
    }));
  const highs = await highsLoader();
  // The SAME objective the served optimizer solves (B-023): the XI, the armband and a discounted
  // bench. A simulator that picked its opening fifteen under a different objective from the product
  // would be measuring a squad nobody would ever be recommended.
  //
  // `readSolution` checks the status and the shape. A solver that returns anything but Optimal still
  // returns a `Columns` object, and reading it produces a squad of whatever happened to be there —
  // usually nothing, which then surfaces hundreds of lines later as "no legal XI from this squad".
  const concentration: Concentration =
    concentrationLambda === null
      ? NO_CONCENTRATION
      : { pairs: defencePairs(candidates), lambda: concentrationLambda };
  const solved = readSolution(
    candidates,
    highs.solve(
      buildLp(candidates, rules, concentration, benchWeight, objective),
    ),
    rules,
  );
  const chosen = new Set(solved.squad.map((c) => c.key));
  return rows.filter((r) => chosen.has(`p_${r.playerCode}`));
}

/**
 * The free-transfer bank the walk opens with, DERIVED from the round it opens at (#99).
 *
 * The seed used to be the literal 1, with the comment "GW1 is unlimited transfers and the squad is
 * chosen there, so the bank opens at one". That is right if and only if the first round handed to
 * this function is round 2 — and nothing here established it. The guarantee lived three files away:
 * both callers build their rounds from `commonRows`, `form` is one of the predictors, `form` is null
 * at a season's first deadline, so every round-1 row was filtered out before it ever arrived.
 *
 * That is a coupling, not an invariant. Removing `form` from `PREDICTORS`, giving it a round-1
 * fallback, or handing this a full-season map would have started the walk at round 1, held a free
 * transfer through the unlimited window and granted a second one entering round 2 — every arm one
 * transfer richer for the season. The A/B comparisons would have stayed valid, because the bias is
 * identical across arms; the absolute season totals `decision-quality` publishes would have moved.
 *
 * So the seed reads the walk instead of assuming it:
 *
 * - opens at round 1 — the unlimited squad-selection window, where a free transfer means nothing.
 *   The bank is 0 during it and the ordinary grant makes it 1 entering round 2, which is FPL.
 * - opens at round 2 — one free transfer, the case every report has actually run.
 * - opens later — a mid-season start, and the bank is then a fact about a manager rather than about
 *   the rules. It cannot be derived, so it is refused rather than guessed.
 */
export function openingFreeTransfers(orderedRounds: readonly number[]): number {
  const first = orderedRounds[0];
  if (first === undefined) return 1;
  if (first <= 1) return 0;
  if (first === 2) return 1;
  throw new Error(
    `simulateSeason was handed a walk opening at gameweek ${first}. The free-transfer seed is ` +
      `derivable only for a season that starts at gameweek 1 or 2 — a mid-season start's bank is a ` +
      `fact about a manager, not about the rules, and guessing it would shift every season total ` +
      `this simulator publishes.`,
  );
}

export interface SimOptions {
  freeTransferCap: number;
  hitCost: number;
  /**
   * Triple captain and bench boost, or absent for the unchipped season this harness has always run.
   *
   * Only these two. Neither touches the squad — they change what the same fifteen score in one week
   * — so they can be decided at scoring time and cannot confound the transfer policy they run
   * beside. A wildcard or free hit changes which players are owned, which is a different question
   * and belongs with the planner.
   *
   * The numbers are the bar a chip must clear ON THE PROJECTION, at round 1, decaying to a quarter
   * of that by the last round: an unplayed chip is worth nothing, so late in the season almost
   * anything beats letting it expire. They were calibrated on 2020-21 and 2021-22 — seasons this
   * simulator does not score — because a threshold chosen on the season being reported is not a
   * policy, it is hindsight with extra steps.
   */
  chips?: { tripleCaptain: number; benchBoost: number };
}

/** What a chip must be worth at `round` to be spent, given the bar it starts the season at. */
export function chipThreshold(
  base: number,
  round: number,
  lastRound = 38,
): number {
  const urgency = Math.min(1, Math.max(0, (round - 1) / (lastRound - 1)));
  return base * (1 - 0.75 * urgency);
}

/**
 * Walk a season.
 *
 * `rowsByRound` is keyed by round and then by player code. **A player absent from a round had no
 * fixture** — there is no archive fixtures table, so a blank is inferred from the absence of a row.
 * They stay in the squad, score 0, keep their last known price, and are eligible for an automatic
 * substitution like any other blank. That is what FPL does, and it is a different thing from a
 * player who was benched.
 */
export function simulateSeason(
  rowsByRound: Map<number, Map<number, PredictionRow>>,
  opening: PredictionRow[],
  predictor: Predictor,
  rules: Rules,
  policy: SimPolicy,
  options: SimOptions,
): SeasonResult {
  const orderedRounds = [...rowsByRound.keys()].sort((a, b) => a - b);

  // Prices carry forward: `value` exists only where a row exists, and a blank round has no row.
  const prices = new Map<number, number>();
  // Everything the squad has ever seen, so a blanked player still has a name and a position.
  const known = new Map<number, PredictionRow>();
  for (const r of opening) {
    prices.set(r.playerCode, r.value);
    known.set(r.playerCode, r);
  }

  const state: SquadState = {
    owned: opening.map((r) => ({
      playerCode: r.playerCode,
      purchasePrice: r.value,
      position: r.position as PositionCode,
    })),
    bank: rules.budget() - opening.reduce((s, r) => s + r.value, 0),
    freeTransfers: openingFreeTransfers(orderedRounds),
  };

  const rounds: SimRound[] = [];
  /** one of each per season; a chip is spent the round it is played and never returns */
  const chipsLeft = new Set<'TC' | 'BB'>(options.chips ? ['TC', 'BB'] : []);
  /** the predictor's most recent word on each player, for the dropped-versus-blank rule */
  const lastSeen = new Map<number, { points: number; pPlay: number }>();

  for (const round of orderedRounds) {
    const market = rowsByRound.get(round)!;
    for (const [code, row] of market) {
      prices.set(code, row.value);
      known.set(code, row);
    }

    // Transfers are decided BEFORE the round, on the predictions available at that deadline.
    const moves = policy.decide(state, market, prices, predictor, rules);
    let hitCost = 0;
    if (moves.length > 0) {
      const paid = Math.max(0, moves.length - state.freeTransfers);
      hitCost = paid * options.hitCost;
      for (const move of moves) {
        const idx = state.owned.findIndex((o) => o.playerCode === move.out);
        const price = prices.get(move.in);
        const outPrice = prices.get(move.out);
        if (idx < 0 || price === undefined || outPrice === undefined) continue;
        state.bank +=
          sellValue(state.owned[idx].purchasePrice, outPrice) - price;
        const incoming = market.get(move.in);
        if (!incoming) continue;
        // The incoming player's position REPLACES the outgoing one's, and the policy is required to
        // have matched them. Asserted rather than trusted: a policy that returns a mismatched pair
        // would otherwise corrupt the squad shape silently, which is how this bug lived.
        if (incoming.position !== state.owned[idx].position) {
          throw new Error(
            `transfer policy "${policy.label}" returned a position change: ` +
              `${state.owned[idx].position} out, ${incoming.position} in`,
          );
        }
        state.owned[idx] = {
          playerCode: move.in,
          purchasePrice: price,
          position: incoming.position,
        };
      }
      state.freeTransfers = Math.max(0, state.freeTransfers - moves.length);
    }

    // A club with no rows had no fixture — public before the deadline, so benching those players is
    // foresight. A player whose club DID play and who has no row was dropped or unused, which is not
    // knowable before a deadline, so their last known prediction is carried and the lineup is chosen
    // as it would have been on the day. See `xi-decision.ts` for the measurement behind this.
    const playing = playingTeams(market);
    const present = state.owned.map((o) => {
      const base = known.get(o.playerCode);
      if (!base) throw new Error(`owned player ${o.playerCode} was never seen`);
      return slotFor(base, market, playing, lastSeen);
    });

    const lineup = chooseLineup(present, predictor, rules);
    const scored = scoreLineup(lineup, rules);
    const captain = scored.fielded.find((m) => m.playerCode === scored.doubled);

    // ---- chips, decided on the projection and scored on the outcome ---------------------------
    // Both are priced against what the model SAID before the round, never against what happened;
    // pricing them on the outcome would report the best week in hindsight and call it a policy.
    let chipPlayed: 'TC' | 'BB' | null = null;
    let chipPoints = 0;
    if (options.chips) {
      const projected = (code: number): number =>
        market.get(code)?.predicted[predictor] ??
        lastSeen.get(code)?.points ??
        0;
      const tcGain = scored.doubled === null ? 0 : projected(scored.doubled);
      const bbGain = lineup.bench.reduce(
        (t, m) => t + projected(m.playerCode),
        0,
      );
      const candidates: { chip: 'TC' | 'BB'; over: number }[] = [];
      if (chipsLeft.has('TC')) {
        const over = tcGain - chipThreshold(options.chips.tripleCaptain, round);
        if (over > 0) candidates.push({ chip: 'TC', over });
      }
      if (chipsLeft.has('BB')) {
        const over = bbGain - chipThreshold(options.chips.benchBoost, round);
        if (over > 0) candidates.push({ chip: 'BB', over });
      }
      // one chip a week, and the one clearing its bar by the widest margin. An exact tie goes to
      // BB — `'BB' < 'TC'` — named here rather than left to array order (B-039). Which of the two
      // wins a tie is arbitrary; that it is always the same one is not.
      const pick = candidates.sort(
        (a, b) => b.over - a.over || a.chip.localeCompare(b.chip),
      )[0];
      if (pick) {
        chipsLeft.delete(pick.chip);
        chipPlayed = pick.chip;
        if (pick.chip === 'TC') {
          // a third share of the captain, and nothing at all when neither he nor the vice appeared
          chipPoints = captain?.actual ?? 0;
        } else {
          // Bench boost: all fifteen score and no substitution happens. Against the unchipped
          // score that is the bench added, and the substitutions that DID happen undone — each
          // one swapped a starter's blank for a bench player's points, and under the chip both
          // count instead of one replacing the other.
          chipPoints =
            lineup.bench.reduce((t, m) => t + m.actual, 0) +
            scored.substitutions.reduce(
              (t, x) => t + x.off.actual - x.on.actual,
              0,
            );
        }
      }
    }

    rounds.push({
      round,
      chip: chipPlayed,
      points: scored.points + chipPoints - hitCost,
      hitCost,
      transfersMade: moves.length,
      freeTransfersAfter: state.freeTransfers,
      bank: state.bank,
      squadValue: state.owned.reduce(
        (s, o) =>
          s +
          sellValue(
            o.purchasePrice,
            prices.get(o.playerCode) ?? o.purchasePrice,
          ),
        0,
      ),
      substitutions: scored.substitutions.length,
      captainPoints: captain?.actual ?? 0,
      squad: state.owned.map((o) => o.playerCode).sort((x, y) => x - y),
    });

    for (const [code, row] of market) {
      lastSeen.set(code, {
        points: row.predicted[predictor] ?? 0,
        pPlay: row.pPlay,
      });
    }

    state.freeTransfers = grantFreeTransfer(
      state.freeTransfers,
      options.freeTransferCap,
    );
  }

  const last = rounds[rounds.length - 1];
  return {
    predictor,
    policy: policy.label,
    rounds,
    totalPoints: rounds.reduce((s, r) => s + r.points, 0),
    totalHitCost: rounds.reduce((s, r) => s + r.hitCost, 0),
    totalTransfers: rounds.reduce((s, r) => s + r.transfersMade, 0),
    finalTeamValue: last ? last.squadValue + last.bank : 0,
  };
}

/**
 * The transfer planner the product actually ships, wrapped as a simulation policy (B-032).
 *
 * B-008 shipped an ILP with the −4 inside the objective, sell values reconstructed, and a cap on how
 * many moves it will consider at once. It is what a user sees on `/squad/{id}`. Until this policy
 * existed it had **never walked a season**: the simulator's two arms were `no-transfer` and
 * `greedy-1ft`, and plan 010 was explicit that both are floors and that B-008 "plugs into this same
 * simulator rather than bringing its own". That wiring was simply never done, so every season total
 * this repo has reported measures a policy the product does not use — and the −4 path, which
 * `fpl-optimizer` calls the most error-amplifying thing the product does, was exercised by a unit
 * test and by nothing else.
 *
 * ## The horizon is the whole difficulty, and it is a leak if it is taken carelessly
 *
 * A transfer is a bet about the future: the planner maximises `Σ EP(gw + i) × decay^i`, so at each
 * deadline it needs several rounds of projections. The obvious implementation — look up the later
 * rounds in `rowsByRound` — reads predictions built from rounds that had not been played when the
 * decision was made. That is plan 010's invariant 2 exactly, and it produces no error and nothing
 * wrong-looking in the output; it just makes the planner clairvoyant.
 *
 * So the horizon comes from `PredictionRow.horizonEp`, which `walkRounds` builds at the deadline with
 * the accumulators and the form window frozen there — only the fixture comes from the future row,
 * because fixtures are published in advance and results are not. **This policy therefore refuses to
 * run on rows that carry no `horizonEp`**, rather than falling back to the single round: a planner
 * quietly demoted to a one-week horizon would take almost no hits and look like a cautious planner
 * instead of a broken one.
 */
/** One name for the arm, shared by the policy and by every report that pairs against it. */
export const PLANNER_LABEL = 'planner';

/** The same planner solved under the objective B-024 replaced, so the change can be paired. */
export const PLANNER_PRE_B024_LABEL = 'planner (pre-B-024 objective)';

export function plannerPolicy(
  solve: (lp: string) => LpSolution,
  options: {
    hitCost: number;
    maxTransfers: number;
    /** What a bench place is worth. Defaults to the served weight, as `buildTransferLp` does. */
    benchWeight?: number;
    /**
     * The defensive-concentration lambda (B-029), or null for none.
     *
     * A lambda rather than ready-made pairs: the pairs name candidates and the candidates are built
     * inside `decide`, so handing them in would make the `d` rows depend on two lists agreeing about
     * keys — a coupling nobody would notice breaking.
     */
    concentrationLambda?: number | null;
    /** Which objective the plan is solved under. Harness-only; see `SquadObjective`. */
    objective?: SquadObjective;
    /** Distinguishes two planner arms in one report. Defaults to `PLANNER_LABEL`. */
    label?: string;
  },
): SimPolicy {
  return {
    label: options.label ?? PLANNER_LABEL,
    decide(state, market, prices, predictor, rules) {
      const byCode = new Map<number, PredictionRow>();
      for (const [code, row] of market) byCode.set(code, row);

      const ep = (row: PredictionRow): number => {
        if (row.horizonEp === null) {
          throw new Error(
            `the planner policy was handed rows with no horizon: player ${row.playerCode} in ` +
              `round ${row.round}. Run the backtest with a horizon rather than letting the planner ` +
              `fall back to a single round`,
          );
        }
        return row.horizonEp;
      };

      const candidate = (row: PredictionRow): Candidate | null =>
        row.teamCode === null
          ? null
          : {
              key: `p_${row.playerCode}`,
              playerId: String(row.playerCode),
              webName: row.webName,
              position: row.position as PositionCode,
              teamId: String(row.teamCode),
              teamShortName: `T${row.teamCode}`,
              cost: prices.get(row.playerCode) ?? row.value,
              ep: ep(row),
              pPlay: row.pPlay,
              appearances: row.appearances,
            };

      // An owned player with no row this round had no fixture. He is still owned, still sellable and
      // still worth whatever his horizon says — but there is no row to say it, so he is priced at 0
      // and at his carried price. Dropping him from the LP instead would let the solver return a
      // fourteen-man squad.
      const owned: OwnedCandidate[] = state.owned.map((o) => {
        const row = byCode.get(o.playerCode);
        const price = prices.get(o.playerCode) ?? o.purchasePrice;
        return {
          key: `p_${o.playerCode}`,
          playerId: String(o.playerCode),
          webName: row?.webName ?? `#${o.playerCode}`,
          position: o.position,
          teamId:
            row?.teamCode != null
              ? String(row.teamCode)
              : `own_${o.playerCode}`,
          teamShortName: `T${row?.teamCode ?? 0}`,
          cost: price,
          ep: row ? ep(row) : 0,
          pPlay: row?.pPlay ?? 0,
          appearances: row?.appearances ?? 0,
          sellValue: sellValue(o.purchasePrice, price),
        };
      });

      const ownedCodes = new Set(state.owned.map((o) => o.playerCode));
      const buyable: Candidate[] = [];
      for (const [code, row] of market) {
        if (ownedCodes.has(code)) continue;
        const c = candidate(row);
        if (c) buyable.push(c);
      }

      const solution = solve(
        buildTransferLp({
          owned,
          market: buyable,
          rules,
          bank: state.bank,
          freeTransfers: state.freeTransfers,
          hitCost: options.hitCost,
          maxTransfers: options.maxTransfers,
          benchWeight: options.benchWeight,
          objective: options.objective,
          concentration:
            options.concentrationLambda == null
              ? undefined
              : {
                  pairs: defencePairs([...owned, ...buyable]),
                  lambda: options.concentrationLambda,
                },
        }),
      );
      if (solution.Status !== 'Optimal') {
        throw new Error(
          `the transfer solve returned ${solution.Status} over ${owned.length + buyable.length} candidates`,
        );
      }
      const on = (key: string) => (solution.Columns[key]?.Primal ?? 0) > 0.5;

      // Pair each sale with a purchase in the SAME position. The LP's position quotas guarantee the
      // counts match; the simulator asserts the pairing, so getting it wrong fails loudly rather than
      // drifting the squad's shape over a season.
      const soldBy = new Map<PositionCode, number[]>();
      for (const o of owned) {
        if (on(o.key)) continue;
        const at = soldBy.get(o.position) ?? [];
        at.push(Number(o.playerId));
        soldBy.set(o.position, at);
      }
      const moves: { out: number; in: number }[] = [];
      for (const c of buyable) {
        if (!on(c.key)) continue;
        const at = soldBy.get(c.position);
        const out = at?.shift();
        if (out === undefined) {
          throw new Error(
            `the transfer solve bought a ${c.position} without selling one — the LP's position ` +
              `quotas should make this impossible`,
          );
        }
        moves.push({ out, in: Number(c.playerId) });
      }
      return moves;
    },
  };
}
