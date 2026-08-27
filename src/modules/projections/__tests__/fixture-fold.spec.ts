import { pmfAt, summarise } from '../distributions';
import { foldFixture, PlayerForecast } from '../forecast.service';

/**
 * B-012 Phase 5 — doubles and blanks on the serving path.
 *
 * `forecast.service.ts` sums a player's fixtures and emits no entry for a player with none. That was
 * true and untested: doubles and blanks are the highest-leverage weeks of a season and the ones naive
 * code silently gets wrong, and a season simulation walks into both every year.
 */

const entry = (): PlayerForecast => ({
  playerCode: 1,
  playerId: null,
  webName: 'Player',
  position: 'MID',
  nowCost: 50,
  expectedPoints: 0,
  expectedMinutes: 0,
  playProbability: 0.9,
  components: {},
  distribution: summarise(pmfAt(0)),
  fixtures: 0,
  availabilityFromSnapshot: false,
  status: 'a',
});

describe('a double gameweek', () => {
  it('adds both fixtures rather than overwriting', () => {
    // Points from both matches count. Overwriting would price a double as a single and is the
    // classic silent failure of code keyed by gameweek instead of by fixture.
    const e = entry();
    foldFixture(e, { ep: 4, components: { goals: 2, bonus: 1 } }, 80);
    foldFixture(e, { ep: 3, components: { goals: 1, cleanSheet: 0.5 } }, 70);
    expect(e.expectedPoints).toBe(7);
    expect(e.expectedMinutes).toBe(150);
    expect(e.fixtures).toBe(2);
  });

  it('adds components term by term, including ones only the second fixture had', () => {
    const e = entry();
    foldFixture(e, { ep: 4, components: { goals: 2 } }, 80);
    foldFixture(e, { ep: 3, components: { goals: 1, cleanSheet: 0.5 } }, 70);
    expect(e.components.goals).toBe(3);
    expect(e.components.cleanSheet).toBe(0.5);
  });

  it('keeps the components summing to the total, so the "why" panel cannot disagree with the number', () => {
    const e = entry();
    foldFixture(e, { ep: 3, components: { a: 2, b: 1 } }, 90);
    foldFixture(e, { ep: 5, components: { a: 3, b: 2 } }, 90);
    const summed = Object.values(e.components).reduce((s, v) => s + v, 0);
    expect(summed).toBeCloseTo(e.expectedPoints, 9);
  });
});

describe('a blank gameweek', () => {
  it('is the absence of a fold, and is distinct from a zero-scoring fixture', () => {
    // A blank is not a projection of 0 — it is no projection at all, and the caller emits no entry.
    // A player who has a fixture and is projected 0 is a different fact and keeps his fixture count.
    const blanked = entry();
    expect(blanked.fixtures).toBe(0);

    const played = entry();
    foldFixture(played, { ep: 0, components: {} }, 0);
    expect(played.fixtures).toBe(1);
    expect(played.expectedPoints).toBe(0);
  });
});
