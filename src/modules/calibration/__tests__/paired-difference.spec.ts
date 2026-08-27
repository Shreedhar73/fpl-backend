import { pairedDifference, RoundDecision } from '../xi-decision';

const rounds = (points: number[]): RoundDecision[] =>
  points.map((p, i) => ({
    season: '2025-26',
    round: i + 1,
    points: p,
    ceiling: 0,
    captainPoints: 0,
    bestFieldedPoints: 0,
    substitutions: 0,
  }));

/**
 * The noise band under every season comparison in `reports/decision-quality.md`. B-030 put the
 * template arm through this same path; before that it was printed as a bare season difference with
 * no standard error and called the report's headline finding.
 */
describe('pairedDifference', () => {
  it('reads exactly zero when an arm is compared with itself', () => {
    const a = rounds([50, 71, 33, 64, 48]);
    const d = pairedDifference(a, a);
    expect(d).not.toBeNull();
    expect(d!.rounds).toBe(5);
    expect(d!.meanDifference).toBe(0);
    expect(d!.standardError).toBe(0);
    expect(d!.clearsNoise).toBe(false);
  });

  it('pairs on the round, not on position in the array', () => {
    const a = rounds([10, 20, 30]);
    const b = [...rounds([1, 2, 3])].reverse();
    const d = pairedDifference(a, b);
    // round 1: 10-1, round 2: 20-2, round 3: 30-3  ->  mean 18
    expect(d!.meanDifference).toBeCloseTo(18, 10);
  });

  it('drops a round the other arm never played rather than counting it as zero', () => {
    const d = pairedDifference(rounds([10, 20, 30]), rounds([1, 2]));
    expect(d!.rounds).toBe(2);
  });

  it('a constant offset is all signal and no noise', () => {
    const d = pairedDifference(rounds([10, 20, 30, 40]), rounds([7, 17, 27, 37]));
    expect(d!.meanDifference).toBeCloseTo(3, 10);
    expect(d!.standardError).toBeCloseTo(0, 10);
    expect(d!.clearsNoise).toBe(true);
  });

  it('a difference smaller than two standard errors does not clear noise', () => {
    // mean +1.0, wide spread
    const d = pairedDifference(
      rounds([30, 10, 40, 0, 21]),
      rounds([10, 30, 20, 20, 6]),
    );
    expect(d!.meanDifference).toBeCloseTo(3, 10);
    expect(d!.clearsNoise).toBe(false);
  });

  it('refuses a verdict on fewer than two paired rounds', () => {
    expect(pairedDifference(rounds([10]), rounds([1]))).toBeNull();
  });
});
