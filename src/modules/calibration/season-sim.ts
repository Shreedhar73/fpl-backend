import highsLoader from 'highs';
import { PositionCode } from '../fpl-sync/mappers';
import {
  buildLp,
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
        if (gain > 0 && (!best || gain > best.gain)) {
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
): Promise<PredictionRow[]> {
  const candidates: Candidate[] = rows
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
    highs.solve(buildLp(candidates, rules, concentration, benchWeight)),
    rules,
  );
  const chosen = new Set(solved.squad.map((c) => c.key));
  return rows.filter((r) => chosen.has(`p_${r.playerCode}`));
}

export interface SimOptions {
  freeTransferCap: number;
  hitCost: number;
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
    // GW1 is unlimited transfers and the squad is chosen there, so the bank opens at one.
    freeTransfers: 1,
  };

  const rounds: SimRound[] = [];
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

    rounds.push({
      round,
      points: scored.points - hitCost,
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
