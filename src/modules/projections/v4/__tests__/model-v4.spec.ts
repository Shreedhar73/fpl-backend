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

  it('missing features route through default_left, not through zero', () => {
    const scorer = scorers.get('MID')!;
    const row = fixture.rows.find(
      (r) =>
        r.position === 'MID' &&
        Object.values(r.features).some((v) => v === null),
    );
    // If no fixture row carries a missing value the fixture cannot prove the missing path — fail
    // loudly rather than passing on an untested branch.
    expect(row).toBeDefined();
    const asZero = new Map<string, number | null>(
      Object.entries(row!.features).map(([k, v]) => [k, v ?? 0]),
    );
    const asMissing = new Map<string, number | null>(
      Object.entries(row!.features),
    );
    // zero-filling must CHANGE the answer; if it does not, missingness was never exercised
    expect(scorer.predict(asZero)).not.toBeCloseTo(
      scorer.predict(asMissing),
      9,
    );
  });

  it('the models carry provenance', () => {
    for (const p of ['GKP', 'DEF', 'MID', 'FWD']) {
      const m = load(p);
      expect(m.provenance.seed).toBe(20260827);
      expect(m.features.length).toBeGreaterThan(100);
    }
  });
});
