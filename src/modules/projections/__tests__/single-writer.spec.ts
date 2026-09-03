import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_VERSION } from '../projections.service';
import { FITTED_PARAMS } from '../fitted';

/**
 * There must be exactly one thing that writes projections.
 *
 * Serving picks the model version by `createdAt desc`, so two writers do not conflict — they take
 * turns, silently, and the app serves whichever ran last. That happened: `pnpm project` wrote a v1
 * heuristic while `pnpm forecast` wrote the fitted model, and `/fpl:plan-gameweek` step 4 would have
 * reverted the app to v1 on the next weekly run with no error and nothing visible.
 *
 * These are structural checks rather than behavioural ones, because the failure is structural: the
 * question is not "does the writer work" but "how many are there".
 */
describe('one projection writer', () => {
  const root = join(__dirname, '../../../..');

  it('serves a version derived from the fitted parameters, never a hardcoded label', () => {
    // A hand-typed version string is how two builds end up claiming to be the same model.
    expect(MODEL_VERSION).toBe(`v5-fitted-${FITTED_PARAMS.provenance.date}`);
    // The MAJOR number is asserted loosely on purpose: it moves when the model's structure changes
    // (v2 -> v3 at B-019/B-020/B-014), and pinning it exactly turns every honest structural change
    // into a red test that says nothing. What must never drift is the DATE half — that is the part
    // derived from the parameters, and a hand-typed one is how two builds claim to be one model.
    expect(MODEL_VERSION).toMatch(/^v\d+-fitted-/);
    expect(MODEL_VERSION.endsWith(FITTED_PARAMS.provenance.date)).toBe(true);
  });

  it('exposes no second projection entry point', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const writers = Object.entries(pkg.scripts).filter(([name]) =>
      ['forecast', 'project'].includes(name),
    );
    expect(writers.map(([name]) => name)).toEqual(['project']);
  });

  it('has no second projection model left in the tree to be wired up', () => {
    // The v1 files were deleted rather than left as shells. A superseded model sitting in the
    // repository is a second writer waiting for someone to import it.
    for (const gone of [
      'src/modules/projections/model.ts',
      'src/modules/projections/minutes.ts',
      'src/modules/projections/team-strength.ts',
      'src/scripts/forecast.ts',
    ]) {
      expect(() => readFileSync(join(root, gone), 'utf8')).toThrow();
    }
  });
});
