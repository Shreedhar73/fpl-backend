/**
 * Chip advice — a **window**, never a decision.
 *
 * A chip is unspendable once spent. That asymmetry is the whole of the design: the cost of playing a
 * Bench Boost one week too early is not the points you missed that week, it is the best week you will
 * never get to use it in, and no model here can price that. So this file names the gameweek the
 * *calendar* argues for and stops. The human commits.
 *
 * `season-sim` simulates no chips for the same reason, and says so.
 *
 * **What the calendar can actually say**, and it is less than people assume:
 *
 * - A **double gameweek** — a club with two fixtures in one event — is the argument for Bench Boost
 *   and Triple Captain. It is knowable from the fixture table the moment the rearrangement is
 *   published, and not before.
 * - A **blank** — a club with no fixture in an event — is the argument for a Free Hit.
 * - **Nothing in the calendar argues for a Wildcard.** It is a squad-quality decision, so the only
 *   honest signal is how far the squad is from the recommendation, and that is reported as a number
 *   rather than dressed as a fixture insight.
 *
 * Early in a season there are no doubles and no blanks, so the honest output is "no gameweek in this
 * horizon argues for a chip". That is a result, and it is what this returns.
 */

export type ChipName = 'bboost' | '3xc' | 'freehit' | 'wildcard' | 'manager';

export interface FixtureCount {
  gameweekId: number;
  /** teamId → fixtures that club plays in that gameweek */
  fixturesByTeam: Map<string, number>;
}

export interface ChipAdvice {
  chip: ChipName;
  label: string;
  /** null when nothing in the horizon argues for it — which is the common answer, not a failure */
  gameweekId: number | null;
  /** what the calendar says, in the words a user would use */
  reason: string;
  /** already used this half of the season, so there is nothing to advise */
  spent: boolean;
}

const LABEL: Record<ChipName, string> = {
  bboost: 'Bench Boost',
  '3xc': 'Triple Captain',
  freehit: 'Free Hit',
  wildcard: 'Wildcard',
  manager: 'Assistant Manager',
};

export interface ChipAdviceInput {
  /** one entry per gameweek in the horizon, in order */
  horizon: FixtureCount[];
  /** teamIds of the fifteen currently owned */
  ownedTeamIds: string[];
  /** the owner's best player by horizon EP, for the Triple Captain line */
  bestPlayer: { webName: string; teamId: string } | null;
  /** chip names already used, as FPL spells them */
  chipsUsed: string[];
  /** horizon EP the recommendation is ahead by, for the Wildcard line */
  horizonGap: number;
}

export function adviseChips(input: ChipAdviceInput): ChipAdvice[] {
  const used = new Set(input.chipsUsed.map((c) => c.toLowerCase()));
  const owned = input.ownedTeamIds;

  /** How many of the fifteen have two fixtures in this gameweek. */
  const doublesFor = (gw: FixtureCount): number =>
    owned.filter((teamId) => (gw.fixturesByTeam.get(teamId) ?? 0) >= 2).length;
  /** How many have none. A club absent from the map has no fixture, which is the blank. */
  const blanksFor = (gw: FixtureCount): number =>
    owned.filter((teamId) => (gw.fixturesByTeam.get(teamId) ?? 0) === 0).length;

  const bestDouble = pickBest(input.horizon, doublesFor);
  const bestBlank = pickBest(input.horizon, blanksFor);

  const captainDoubles = input.bestPlayer
    ? input.horizon.find(
        (gw) => (gw.fixturesByTeam.get(input.bestPlayer!.teamId) ?? 0) >= 2,
      )
    : undefined;

  const advice: ChipAdvice[] = [
    {
      chip: 'bboost',
      label: LABEL.bboost,
      gameweekId:
        bestDouble && bestDouble.count >= 3 ? bestDouble.gw.gameweekId : null,
      reason:
        bestDouble && bestDouble.count >= 3
          ? `${bestDouble.count} of your fifteen play twice in gameweek ${bestDouble.gw.gameweekId}. A bench that plays is what this chip pays for.`
          : 'No gameweek in this horizon gives enough of your squad a second fixture. Bench Boost wants a double gameweek, and there is not one here yet.',
      spent: used.has('bboost'),
    },
    {
      chip: '3xc',
      label: LABEL['3xc'],
      gameweekId: captainDoubles ? captainDoubles.gameweekId : null,
      reason: captainDoubles
        ? `${input.bestPlayer?.webName} plays twice in gameweek ${captainDoubles.gameweekId} — the only shape that reliably justifies a third multiplier.`
        : 'Your best player has one fixture in every gameweek here. A Triple Captain on a single fixture is a variance bet, not a calendar one.',
      spent: used.has('3xc'),
    },
    {
      chip: 'freehit',
      label: LABEL.freehit,
      gameweekId:
        bestBlank && bestBlank.count >= 4 ? bestBlank.gw.gameweekId : null,
      reason:
        bestBlank && bestBlank.count >= 4
          ? `${bestBlank.count} of your fifteen have no fixture in gameweek ${bestBlank.gw.gameweekId}. A Free Hit is a squad for one week, which is what a blank asks for.`
          : 'No gameweek here leaves enough of your squad without a fixture. Free Hit answers a blank, and there is not one in this horizon.',
      spent: used.has('freehit'),
    },
    {
      chip: 'wildcard',
      label: LABEL.wildcard,
      // Deliberately never a gameweek. Nothing in a fixture list argues for a wildcard, and a
      // confident date here would be the model inventing a reason it does not have.
      gameweekId: null,
      reason:
        input.horizonGap > 15
          ? `The recommendation is ${input.horizonGap.toFixed(1)} points ahead of this squad over the horizon, which is more than a run of single transfers can close. That is a squad-quality argument for a wildcard, not a fixture one — and it is your call.`
          : `The recommendation is ${input.horizonGap.toFixed(1)} points ahead over the horizon. That is inside what ordinary transfers can close, so nothing here argues for a wildcard.`,
      spent: used.has('wildcard'),
    },
  ];

  return advice;
}

function pickBest(
  horizon: FixtureCount[],
  count: (gw: FixtureCount) => number,
): { gw: FixtureCount; count: number } | null {
  let best: { gw: FixtureCount; count: number } | null = null;
  for (const gw of horizon) {
    const c = count(gw);
    if (c > 0 && (!best || c > best.count)) best = { gw, count: c };
  }
  return best;
}
