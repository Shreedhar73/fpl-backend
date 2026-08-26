import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  positionByType,
  mapTeam,
  mapPlayer,
  mapGameweek,
  mapFixture,
  mapOwnership,
  mapGameweekStat,
  seasonLabel,
} from '../mappers';
import {
  RawTeam,
  RawElement,
  RawEvent,
  RawFixture,
  RawElementHistory,
  RawElementType,
} from '../../../infra/fpl/fpl.types';

/**
 * These run against RECORDED FPL payloads trimmed into test/fixtures/, not hand-made objects — the
 * whole point (fpl-testing-contract) is to test the shape upstream actually sends: `null` where you
 * assumed a number, a decimal string where you assumed a float. The boundary mappers are where every
 * one of those gotchas is neutralised, so this is where they are pinned.
 */
function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, '../../../../test/fixtures', name), 'utf8'),
  ) as T;
}

interface Bootstrap {
  teams: RawTeam[];
  element_types: RawElementType[];
  elements: RawElement[];
  events: RawEvent[];
}

const bootstrap = fixture<Bootstrap>('bootstrap.sample.json');
const rawFixtures = fixture<RawFixture[]>('fixtures.sample.json');
const elementSummary = fixture<{ history: RawElementHistory[] }>('element-summary.sample.json');

const raya = bootstrap.elements.find((e) => e.web_name === 'Raya')!;
const timber = bootstrap.elements.find((e) => e.status !== 'a')!; // injured, chance == 0

describe('positionByType', () => {
  it('maps element_type ids to the position enum values', () => {
    const map = positionByType(bootstrap.element_types);
    expect(map[1]).toBe('GKP');
    expect(map[2]).toBe('DEF');
    expect(map[3]).toBe('MID');
    expect(map[4]).toBe('FWD');
  });
});

describe('mapTeam', () => {
  it('coalesces a null strength to 0 (preseason payloads send null)', () => {
    const nullStrength = bootstrap.teams.find((t) => t.strength === null)!;
    expect(nullStrength).toBeDefined();
    expect(mapTeam(nullStrength).strength).toBe(0);
  });

  it('carries the stable code and the fpl id separately', () => {
    const t = mapTeam(bootstrap.teams[0]);
    expect(t.fplId).toBe(bootstrap.teams[0].id);
    expect(t.code).toBe(bootstrap.teams[0].code);
    expect(t.shortName).toBe(bootstrap.teams[0].short_name);
  });
});

describe('mapPlayer', () => {
  const pos = positionByType(bootstrap.element_types);

  it('resolves element_type to a position and keeps now_cost in integer tenths', () => {
    const p = mapPlayer(raya, pos);
    expect(p.position).toBe('GKP');
    expect(Number.isInteger(p.nowCost)).toBe(true);
    expect(p.nowCost).toBe(raya.now_cost); // never divided into pounds at the boundary
  });

  it('keeps chance_of_playing null as null — a fit player, not a 0% one', () => {
    const p = mapPlayer(raya, pos);
    expect(raya.chance_of_playing_next_round).toBeNull();
    expect(p.chanceOfPlayingNextRound).toBeNull();
  });

  it('keeps a real 0 chance as 0, distinct from null', () => {
    const p = mapPlayer(timber, pos);
    expect(timber.chance_of_playing_next_round).toBe(0);
    expect(p.chanceOfPlayingNextRound).toBe(0); // must NOT collapse to null
  });

  it('turns empty news into null but keeps real news and its timestamp', () => {
    expect(mapPlayer(raya, pos).news).toBeNull(); // '' -> null
    const t = mapPlayer(timber, pos);
    expect(typeof t.news).toBe('string');
    expect((t.news as string).length).toBeGreaterThan(0);
    expect(t.newsAddedAt).toBeInstanceOf(Date);
  });

  it('throws on an unknown element_type rather than guessing a position', () => {
    expect(() => mapPlayer({ ...raya, element_type: 99 }, pos)).toThrow(/unknown element_type/);
  });
});

describe('mapGameweek', () => {
  it('parses the UTC deadline to a Date and preserves finished/data_checked', () => {
    const gw1 = mapGameweek(bootstrap.events.find((e) => e.id === 1)!);
    expect(gw1.deadlineTime).toBeInstanceOf(Date);
    expect(gw1.deadlineTime.getTime()).toBeGreaterThan(0);
    expect(gw1.finished).toBe(true);
    expect(gw1.dataChecked).toBe(true);
  });
});

describe('mapFixture', () => {
  it('keeps event as the gameweek id and parses kickoff to a Date', () => {
    const f = mapFixture(rawFixtures[0]);
    expect(f.gameweekId).toBe(rawFixtures[0].event);
    expect(f.homeTeamFplId).toBe(rawFixtures[0].team_h);
    if (rawFixtures[0].kickoff_time) expect(f.kickoffTime).toBeInstanceOf(Date);
  });
});

describe('mapOwnership', () => {
  it('keeps selected_by_percent as its exact decimal string, not a float', () => {
    const o = mapOwnership(raya);
    expect(typeof o.selectedByPercent).toBe('string');
    expect(o.selectedByPercent).toBe(raya.selected_by_percent);
  });
});

describe('mapGameweekStat', () => {
  it('keeps expected_* as decimal strings and defaults defensive_contribution', () => {
    const h = elementSummary.history[0];
    const s = mapGameweekStat(h);
    expect(typeof s.expectedGoals).toBe('string');
    expect(s.expectedGoals).toBe(h.expected_goals);
    expect(s.value).toBe(h.value); // tenths, untouched
    expect(s.gameweekId).toBe(h.round);
    expect(s.defensiveContribution).toBe(h.defensive_contribution ?? 0);
  });
});

describe('seasonLabel', () => {
  it('derives a "YYYY/YY" label from the earliest event deadline', () => {
    expect(seasonLabel(bootstrap.events)).toMatch(/^\d{4}\/\d{2}$/);
  });
});
