import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V4Model, V4Scorer } from '../model-v4';

const dir = join(__dirname, '..');
const load = (position: string): V4Model =>
  JSON.parse(readFileSync(join(dir, `model-${position}.json`), 'utf8'));

interface ParityRow {
  position: string;
  playerCode: number;
  round: number;
  features: Record<string, number | null>;
  expected: number;
}
const fixture: { rows: ParityRow[] } = JSON.parse(
  readFileSync(join(dir, 'parity-fixture.json'), 'utf8'),
);

/**
 * Parity is the whole contract (B-035). The fixture rows are TEST-season rows scored BLIND by the
 * Python fit; this file reproducing them to 1e-6 is the only evidence the TS walker and the
 * committed models agree. A walker that mis-reads one field — the wrong child on a missing value, a
 * dropped base_score, the overfit tail scored past best_iteration — produces plausible numbers with
 * no other tell.
 */
describe('v4 parity: TypeScript reproduces the Python predictions', () => {
  const scorers = new Map<string, V4Scorer>();
  beforeAll(() => {
    for (const p of ['GKP', 'DEF', 'MID', 'FWD'])
      scorers.set(p, new V4Scorer(load(p)));
  });

  it('has a real fixture to check against', () => {
    expect(fixture.rows.length).toBeGreaterThanOrEqual(200);
    expect(
      new Set(fixture.rows.map((r) => r.expected.toFixed(6))).size,
    ).toBeGreaterThan(50);
  });

  it.each(['GKP', 'DEF', 'MID', 'FWD'])(
    '%s: every fixture row within 1e-6',
    (position) => {
      const scorer = scorers.get(position)!;
      const rows = fixture.rows.filter((r) => r.position === position);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const m = new Map<string, number | null>(Object.entries(row.features));
        const got = scorer.predict(m);
        if (Math.abs(got - row.expected) > 1e-6) {
          throw new Error(
            `${position} player ${row.playerCode} round ${row.round}: ` +
              `TS ${got} vs Python ${row.expected}`,
          );
        }
      }
    },
  );

  it('the fixture exercises the missing path end to end', () => {
    // Parity passing over rows that CARRY nulls is the end-to-end evidence that NaN routing agrees
    // with Python. This asserts such rows exist; the walker's default_left semantics are pinned
    // deterministically below, because on a 50-row sample the missing leaf and the zero leaf can
    // coincide by chance for every sampled row.
    expect(
      fixture.rows.filter((r) =>
        Object.values(r.features).some((v) => v === null),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('default_left routes a missing value where zero would not go', () => {
    // One split on feature f: threshold -1. A present 0 fails `0 < -1` and goes RIGHT (leaf 5);
    // a missing value follows default_left and goes LEFT (leaf 7). If the walker ever treats
    // missing as zero, this returns 5.
    const model: V4Model = {
      position: 'TEST',
      target: 'points',
      features: ['f'],
      hyperparameters: { best_iteration: 0 },
      provenance: { date: '', seed: 0 },
      model: {
        learner: {
          learner_model_param: { base_score: '[0]' },
          gradient_booster: {
            model: {
              trees: [
                {
                  split_indices: [0, 0, 0],
                  split_conditions: [-1, 7, 5],
                  left_children: [1, -1, -1],
                  right_children: [2, -1, -1],
                  default_left: [1, 0, 0],
                },
              ],
            },
          },
        },
      },
    };
    const scorer = new V4Scorer(model);
    expect(scorer.predict(new Map([['f', 0]]))).toBe(5);
    expect(scorer.predict(new Map([['f', null]]))).toBe(7);
    expect(scorer.predict(new Map())).toBe(7);
  });

  it('the models carry provenance', () => {
    for (const p of ['GKP', 'DEF', 'MID', 'FWD']) {
      const m = load(p);
      expect(m.provenance.seed).toBe(20260827);
      expect(m.features.length).toBeGreaterThan(100);
    }
  });
});
