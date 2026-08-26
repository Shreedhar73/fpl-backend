import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PositionCode } from '../../fpl-sync/mappers';
import { Scoring, RawScoring } from '../scoring';
import { pointsFor, RealisedStats, DEFCON_THRESHOLD } from '../points';
import { isAllowed, ALLOWED_MISMATCHES } from '../points-allowlist';

/**
 * The highest-value test in the project (`fpl-testing-contract`): reproduce the official
 * `total_points` for EVERY player in a finished gameweek, not a sample.
 *
 * The answer key is `event/1/live/` recorded whole in `test/fixtures/event-1-live.json` — each element
 * carries an `explain` block of `{ identifier, points, value }` per fixture, which is the only place
 * upstream says why a player scored what they scored. Positions and the scoring table come from the
 * matching `bootstrap-static/` capture, so the fixture pair is internally consistent and no part of
 * this test reaches the network.
 *
 * Comparison is per identifier first and on the total second. A total-only assertion tells you a
 * player is wrong; the per-identifier one tells you which term is wrong, which is the whole diagnostic
 * value of the `explain` block.
 */

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(join(__dirname, '../../../../test/fixtures', name), 'utf8'),
  ) as T;

interface LiveStats {
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  defensive_contribution: number;
  clearances_blocks_interceptions: number;
  tackles: number;
  recoveries: number;
  total_points: number;
}

interface ExplainStat {
  identifier: string;
  points: number;
  value: number;
  points_modification: number;
}

interface LiveElement {
  id: number;
  stats: LiveStats;
  explain: { fixture: number; stats: ExplainStat[] }[];
}

const live = fixture<{ elements: LiveElement[] }>('event-1-live.json');
const meta = fixture<{
  event: number;
  elementTypes: { id: number; singular_name_short: string }[];
  elements: { id: number; element_type: number }[];
  scoring: RawScoring;
}>('event-1-elements.json');

const EVENT = meta.event;
const scoring = Scoring.from(meta.scoring);

const positionByType = new Map(
  meta.elementTypes.map((t) => [t.id, t.singular_name_short as PositionCode]),
);
const positionOf = new Map(
  meta.elements.map((e) => [e.id, positionByType.get(e.element_type)!]),
);

function realised(s: LiveStats): RealisedStats {
  return {
    minutes: s.minutes,
    goalsScored: s.goals_scored,
    assists: s.assists,
    cleanSheets: s.clean_sheets,
    goalsConceded: s.goals_conceded,
    ownGoals: s.own_goals,
    penaltiesSaved: s.penalties_saved,
    penaltiesMissed: s.penalties_missed,
    yellowCards: s.yellow_cards,
    redCards: s.red_cards,
    saves: s.saves,
    bonus: s.bonus,
    defensiveContribution: s.defensive_contribution,
  };
}

/** The official breakdown, summed across a player's fixtures — two of them in a double gameweek. */
function officialByIdentifier(el: LiveElement): Record<string, number> {
  const by: Record<string, number> = {};
  for (const f of el.explain) {
    for (const s of f.stats) {
      by[s.identifier] = (by[s.identifier] ?? 0) + s.points;
    }
  }
  return by;
}

describe('the fixture itself', () => {
  // A fixture that has quietly emptied or truncated makes every loop below pass without running.
  // These four assertions are what stop this file from being a test that cannot fail.
  it('carries every player, not a slice', () => {
    expect(live.elements.length).toBe(610);
    expect(meta.elements.length).toBeGreaterThanOrEqual(live.elements.length);
  });

  it('has a position for every player it scores', () => {
    const missing = live.elements.filter((e) => !positionOf.get(e.id));
    expect(missing.map((e) => e.id)).toEqual([]);
  });

  it('carries the scoring table it will be scored with', () => {
    expect(scoring.longPlay()).toBe(2);
    expect(scoring.goal('GKP')).toBe(10);
    expect(scoring.defensiveContribution('DEF')).toBe(2);
  });

  it('contains players who actually scored, so the comparison has something to catch', () => {
    const scored = live.elements.filter((e) => e.stats.total_points > 0);
    expect(scored.length).toBeGreaterThan(100);
  });
});

describe('pointsFor reproduces the official GW1 breakdown', () => {
  it('matches every identifier for every player', () => {
    const mismatches: string[] = [];

    for (const el of live.elements) {
      if (isAllowed(el.id, EVENT)) continue;
      const position = positionOf.get(el.id)!;
      const ours = pointsFor(realised(el.stats), position, scoring);
      const theirs = officialByIdentifier(el);

      const identifiers = new Set([
        ...Object.keys(ours.byIdentifier),
        ...Object.keys(theirs),
      ]);
      for (const id of identifiers) {
        const a = ours.byIdentifier[id] ?? 0;
        const b = theirs[id] ?? 0;
        if (a !== b) {
          mismatches.push(
            `element ${el.id} (${position}) ${id}: ours ${a}, official ${b}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('matches the official total for every player', () => {
    const mismatches: string[] = [];

    for (const el of live.elements) {
      if (isAllowed(el.id, EVENT)) continue;
      const position = positionOf.get(el.id)!;
      const ours = pointsFor(realised(el.stats), position, scoring);
      if (ours.total !== el.stats.total_points) {
        mismatches.push(
          `element ${el.id} (${position}): ours ${ours.total}, official ${el.stats.total_points}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('holds the allowlist empty — every entry is a hole in the bar above', () => {
    expect(ALLOWED_MISMATCHES).toEqual([]);
  });

  it('sees no points_modification in this gameweek, so ignoring it is safe HERE only', () => {
    // The field exists on every explain stat and is 0 throughout GW1. If a future gameweek uses it,
    // this fails and the engine must add it rather than silently dropping a correction.
    const modified = live.elements.flatMap((e) =>
      e.explain.flatMap((f) =>
        f.stats.filter((s) => s.points_modification !== 0),
      ),
    );
    expect(modified).toEqual([]);
  });
});

describe('the defensive-contribution threshold, re-derived from the data', () => {
  // Upstream publishes the POINTS but not the THRESHOLD, so DEFCON_THRESHOLD is the one number in
  // points.ts that cannot come from config. Rather than trust it, re-derive the boundary here: if FPL
  // moves a threshold, this fails on the boundary instead of mispricing a whole position in silence.
  const byPosition = (pos: PositionCode) =>
    live.elements
      .filter((e) => positionOf.get(e.id) === pos)
      .map((e) => ({
        dc: e.stats.defensive_contribution,
        paid: officialByIdentifier(e).defensive_contribution ?? 0,
      }));

  it.each([
    ['DEF', 10],
    ['MID', 12],
  ] as const)('separates paid from unpaid at %s %i', (pos, threshold) => {
    const rows = byPosition(pos);
    const lowestPaid = Math.min(
      ...rows.filter((r) => r.paid > 0).map((r) => r.dc),
    );
    const highestUnpaid = Math.max(
      ...rows.filter((r) => r.paid === 0).map((r) => r.dc),
    );

    expect(lowestPaid).toBe(threshold);
    expect(highestUnpaid).toBe(threshold - 1);
    expect(DEFCON_THRESHOLD[pos]).toBe(threshold);
  });

  it('records that FWD is assumed, not confirmed — nobody reached it in GW1', () => {
    const rows = byPosition('FWD');
    expect(rows.filter((r) => r.paid > 0)).toEqual([]);
    expect(Math.max(...rows.map((r) => r.dc))).toBeLessThan(
      DEFCON_THRESHOLD.FWD,
    );
  });

  it('does not apply to goalkeepers at all', () => {
    const rows = byPosition('GKP');
    expect(rows.every((r) => r.dc === 0 && r.paid === 0)).toBe(true);
    expect(DEFCON_THRESHOLD.GKP).toBe(0);
  });

  it('counts actions rather than points — DEF is CBI+tackles, MID/FWD adds recoveries', () => {
    const check = (pos: PositionCode, withRecoveries: boolean) => {
      const wrong = live.elements
        .filter((e) => positionOf.get(e.id) === pos && e.stats.minutes > 0)
        .filter((e) => {
          const s = e.stats;
          const expected =
            s.clearances_blocks_interceptions +
            s.tackles +
            (withRecoveries ? s.recoveries : 0);
          return s.defensive_contribution !== expected;
        });
      expect(wrong.map((e) => e.id)).toEqual([]);
    };
    check('DEF', false);
    check('MID', true);
    check('FWD', true);
  });
});

describe('the cases GW1 does not contain', () => {
  const base: RealisedStats = {
    minutes: 0,
    goalsScored: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    defensiveContribution: 0,
  };

  // SYNTHETIC — GW1 2026/27 has no double gameweek, so the summing path has no real row to prove it.
  it('sums a double gameweek across fixtures rather than overwriting', () => {
    const first = pointsFor({ ...base, minutes: 90, goalsScored: 1 }, 'MID', scoring);
    const second = pointsFor({ ...base, minutes: 90, assists: 1 }, 'MID', scoring);
    expect(first.total + second.total).toBe(2 + 5 + 2 + 3);
  });

  it('keeps a blank, a benched player and a scoreless appearance distinct', () => {
    // A blank gameweek is the ABSENCE of a fixture — no call to pointsFor at all — which is why the
    // caller must distinguish it. The two the engine can see must not collapse into each other.
    const benched = pointsFor({ ...base, minutes: 0 }, 'MID', scoring);
    const played = pointsFor({ ...base, minutes: 12 }, 'MID', scoring);

    expect(benched.total).toBe(0);
    expect(benched.byIdentifier).toEqual({ minutes: 0 });
    expect(played.total).toBe(1);
    expect(played.byIdentifier).toEqual({ minutes: 1 });
  });

  it('prices the events GW1 never produced', () => {
    expect(pointsFor({ ...base, minutes: 90, penaltiesSaved: 1 }, 'GKP', scoring).total).toBe(7);
    expect(pointsFor({ ...base, minutes: 90, ownGoals: 1 }, 'DEF', scoring).total).toBe(0);
    expect(pointsFor({ ...base, minutes: 90, saves: 6 }, 'GKP', scoring).total).toBe(4);
  });

  it('rounds saves and goals conceded down, never up', () => {
    expect(pointsFor({ ...base, minutes: 90, saves: 2 }, 'GKP', scoring).byIdentifier.saves).toBeUndefined();
    expect(pointsFor({ ...base, minutes: 90, goalsConceded: 1 }, 'DEF', scoring).byIdentifier.goals_conceded).toBeUndefined();
    expect(pointsFor({ ...base, minutes: 90, goalsConceded: 3 }, 'DEF', scoring).byIdentifier.goals_conceded).toBe(-1);
  });
});
