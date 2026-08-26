/**
 * The minutes model — built first and tested on its own, because it dominates every other term
 * (`fpl-optimizer`): a £12m forward who does not start scores 0, and no attacking rate recovers that.
 *
 * v1 is deliberately a transparent heuristic, not a learned model. It turns availability and a start
 * probability into P(plays), E[minutes | plays] and P(starts). The start probability itself is
 * computed by the service as a shrinkage blend of current- and prior-season starts (thin early
 * season), and passed in — this function stays pure and unit-testable.
 */
export interface MinutesInput {
  /** a=available d=doubtful i=injured s=suspended u=unavailable n=not in squad. */
  status: string;
  /** chance_of_playing_next_round: null means FULLY FIT, not unknown. */
  chance: number | null;
  /** blended probability the player starts when available, 0..1. */
  startRate: number;
}

export interface MinutesOutput {
  pPlay: number; // P(features at all)
  eMinutesIfPlay: number; // E[minutes | features]
  pStart: number; // P(starts) — used for the clean-sheet term
}

const STARTER_MINUTES = 85;
const SUB_MINUTES = 25;
/** A non-starter's chance of coming off the bench at all. */
const SUB_APPEARANCE_RATE = 0.35;
const UNAVAILABLE = new Set(['i', 's', 'u', 'n']);

export function minutesModel(input: MinutesInput): MinutesOutput {
  if (UNAVAILABLE.has(input.status)) {
    return { pPlay: 0, eMinutesIfPlay: 0, pStart: 0 };
  }

  // null chance == fully fit (availability 1). A number is a literal percentage.
  const availability = input.chance === null ? 1 : input.chance / 100;
  const startRate = clamp01(input.startRate);

  const pStart = availability * startRate;
  const pSubApp = availability * (1 - startRate) * SUB_APPEARANCE_RATE;
  const pPlay = pStart + pSubApp;

  const eMinutesIfPlay =
    pPlay > 0 ? (pStart * STARTER_MINUTES + pSubApp * SUB_MINUTES) / pPlay : 0;

  return { pPlay, eMinutesIfPlay, pStart };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
