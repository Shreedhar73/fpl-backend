import { minutesModel } from '../minutes';
import { Scoring, RawScoring } from '../scoring';
import { projectFixture } from '../model';
import { blendRates } from '../projections.service';
import { withinTimeCut, timeCut } from '../backtest';
import {
  effectiveDifficulty,
  leagueAverageXg,
  TeamRating,
} from '../team-strength';
import { PlayerRow, PriorAggregate } from '../projections.repository';

/**
 * Pure-function tests for the projection engine — no DB. They pin the properties that make the model
 * trustworthy: minutes dominate, scoring comes from config (not constants), early-season rates shrink
 * toward prior seasons, and the backtest time-cut cannot read the future.
 */

const SCORING: RawScoring = {
  long_play: 2,
  short_play: 1,
  goals_scored: { GKP: 10, DEF: 6, MID: 5, FWD: 4 },
  clean_sheets: { GKP: 4, DEF: 4, MID: 1, FWD: 0 },
  goals_conceded: { GKP: -1, DEF: -1, MID: 0, FWD: 0 },
  defensive_contribution: { GKP: 0, DEF: 2, MID: 2, FWD: 2 },
  assists: 3,
  saves: 1,
  bonus: 1,
  own_goals: -2,
  penalties_saved: 5,
  penalties_missed: -2,
  yellow_cards: -1,
  red_cards: -3,
};

describe('minutesModel', () => {
  it('projects zero for an injured or suspended player', () => {
    for (const status of ['i', 's', 'u', 'n']) {
      const m = minutesModel({ status, chance: null, startRate: 1 });
      expect(m.pPlay).toBe(0);
      expect(m.eMinutesIfPlay).toBe(0);
    }
  });

  it('treats a null chance as fully fit, not unknown', () => {
    const m = minutesModel({ status: 'a', chance: null, startRate: 1 });
    expect(m.pPlay).toBeGreaterThan(0.9);
  });

  it('treats a 0% chance as not playing, distinct from null', () => {
    const m = minutesModel({ status: 'd', chance: 0, startRate: 1 });
    expect(m.pPlay).toBe(0);
  });

  it('gives a nailed starter a higher start probability and more minutes than a fringe player', () => {
    const nailed = minutesModel({ status: 'a', chance: null, startRate: 0.95 });
    const fringe = minutesModel({ status: 'a', chance: null, startRate: 0.2 });
    expect(nailed.pStart).toBeGreaterThan(fringe.pStart);
    expect(nailed.eMinutesIfPlay).toBeGreaterThan(fringe.eMinutesIfPlay);
  });
});

describe('projectFixture — scoring comes from config, not constants', () => {
  const mins = minutesModel({ status: 'a', chance: null, startRate: 1 });
  const rates = { xg90: 0.5, xa90: 0.3, defcon90: 0, saves90: 0 };

  it('scales the goals term with the config goal value (break-on-purpose)', () => {
    const base = projectFixture(
      'FWD',
      mins,
      rates,
      { attackDifficulty: 3, defenceDifficulty: 3 },
      Scoring.from(SCORING),
      0,
    );
    const doubled = projectFixture(
      'FWD',
      mins,
      rates,
      { attackDifficulty: 3, defenceDifficulty: 3 },
      Scoring.from({
        ...SCORING,
        goals_scored: { ...SCORING.goals_scored, FWD: 8 },
      }),
      0,
    );
    // FWD goal value 4 -> 8 must roughly double the goals component. A hardcoded table would not move.
    expect(doubled.components.goals).toBeCloseTo(base.components.goals * 2, 5);
  });

  it('gives a defender the position goal value, higher than a forward for the same xG', () => {
    const def = projectFixture(
      'DEF',
      mins,
      rates,
      { attackDifficulty: 3, defenceDifficulty: 3 },
      Scoring.from(SCORING),
      0,
    );
    const fwd = projectFixture(
      'FWD',
      mins,
      rates,
      { attackDifficulty: 3, defenceDifficulty: 3 },
      Scoring.from(SCORING),
      0,
    );
    expect(def.components.goals).toBeGreaterThan(fwd.components.goals); // DEF goal 6 > FWD 4
  });

  it('applies no defensive-contribution points to a goalkeeper (config says 0)', () => {
    const gk = projectFixture(
      'GKP',
      mins,
      { xg90: 0, xa90: 0, defcon90: 20, saves90: 0 },
      { attackDifficulty: 3, defenceDifficulty: 3 },
      Scoring.from(SCORING),
      0,
    );
    expect(gk.components.defcon).toBe(0);
  });

  it('an easier fixture lifts the attacking return', () => {
    const easy = projectFixture(
      'FWD',
      mins,
      rates,
      { attackDifficulty: 2, defenceDifficulty: 2 },
      Scoring.from(SCORING),
      0,
    );
    const hard = projectFixture(
      'FWD',
      mins,
      rates,
      { attackDifficulty: 5, defenceDifficulty: 5 },
      Scoring.from(SCORING),
      0,
    );
    expect(easy.components.goals).toBeGreaterThan(hard.components.goals);
  });
});

describe('blendRates — early-season shrinkage toward prior seasons', () => {
  const base: PlayerRow = {
    id: 'p1',
    fplId: 1,
    webName: 'X',
    teamId: 't1',
    position: 'MID',
    status: 'a',
    chance: null,
    seasonMinutes: 90, // one game played
    seasonStarts: 1,
    epNext: null,
    xg90: 0.1, // noisy one-game current rate
    xa90: 0,
    defcon90: 0,
    saves90: 0,
  };
  const prior: PriorAggregate = {
    minutes: 3000,
    starts: 34,
    xg: 20, // strong prior: ~0.6 xG/90
    xa: 0,
    defcon: 0,
    saves: 0,
    totalPoints: 200,
    seasons: 2,
  };

  it('pulls a one-game rate toward the prior', () => {
    const blended = blendRates(base, prior);
    const priorPer90 = (prior.xg / prior.minutes) * 90; // 0.6
    expect(blended.xg90).toBeGreaterThan(base.xg90);
    expect(blended.xg90).toBeGreaterThan(0.3); // closer to prior than to 0.1
    expect(blended.xg90).toBeLessThanOrEqual(priorPer90);
  });

  it('returns the current rate unchanged when there is no prior', () => {
    expect(blendRates(base, undefined).xg90).toBe(base.xg90);
  });
});

describe('team-strength effective difficulty', () => {
  const leagueAvg = 1.4;
  // The module's confidence constant is 4; `matches: 20` below is deliberately well past it.
  // A team with lots of matches so the xG signal is trusted, not shrunk back toward FDR.
  const played = (xgFor: number, xgAgainst: number): TeamRating => ({
    fplId: 1,
    matches: 20,
    xgForPerMatch: xgFor,
    xgAgainstPerMatch: xgAgainst,
  });

  it('falls back to FDR when the opponent has no matches played yet', () => {
    const d = effectiveDifficulty(
      4,
      { fplId: 1, matches: 0, xgForPerMatch: 0, xgAgainstPerMatch: 0 },
      leagueAvg,
    );
    expect(d.attackDifficulty).toBe(4);
    expect(d.defenceDifficulty).toBe(4);
  });

  it('a leaky opponent (concedes a lot) is easier to score against than its FDR says', () => {
    const d = effectiveDifficulty(3, played(1.4, 2.4), leagueAvg); // concedes well above average
    expect(d.attackDifficulty).toBeLessThan(3);
  });

  it('a potent opponent (creates a lot) makes a clean sheet harder than its FDR says', () => {
    const d = effectiveDifficulty(3, played(2.4, 1.4), leagueAvg); // creates well above average
    expect(d.defenceDifficulty).toBeGreaterThan(3);
  });

  it('shrinks back toward FDR when few matches have been played (low confidence)', () => {
    const thin = effectiveDifficulty(
      5,
      { fplId: 1, matches: 1, xgForPerMatch: 1.4, xgAgainstPerMatch: 3.0 },
      leagueAvg,
    );
    const rich = effectiveDifficulty(
      5,
      { fplId: 1, matches: 20, xgForPerMatch: 1.4, xgAgainstPerMatch: 3.0 },
      leagueAvg,
    );
    // both point the same way (easier), but the one-match estimate stays closer to the FDR of 5.
    expect(thin.attackDifficulty).toBeGreaterThan(rich.attackDifficulty);
  });

  it('averages only teams that have played', () => {
    const avg = leagueAverageXg([
      { fplId: 1, matches: 2, xgForPerMatch: 1.5, xgAgainstPerMatch: 1.0 },
      { fplId: 2, matches: 0, xgForPerMatch: 0, xgAgainstPerMatch: 0 }, // ignored
    ]);
    expect(avg).toBeCloseTo(1.5, 5);
  });
});

describe('backtest time-cut', () => {
  const rows = [
    { gameweekId: 1, dataChecked: true },
    { gameweekId: 2, dataChecked: false }, // finished but not yet checked — bonus can still move
    { gameweekId: 3, dataChecked: true },
  ];

  it('reads only checked gameweeks strictly before the target', () => {
    expect(withinTimeCut({ gameweekId: 1, dataChecked: true }, 3)).toBe(true);
    expect(withinTimeCut({ gameweekId: 3, dataChecked: true }, 3)).toBe(false); // not < k
    expect(withinTimeCut({ gameweekId: 2, dataChecked: false }, 3)).toBe(false); // unchecked
  });

  it('excludes the target gameweek and unchecked rows (leak guard)', () => {
    const readable = timeCut(rows, 3);
    expect(readable.map((r) => r.gameweekId)).toEqual([1]);
  });
});
