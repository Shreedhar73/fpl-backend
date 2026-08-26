import { withinTimeCut, timeCut } from '../backtest';

/**
 * What survives of the v1 projection tests.
 *
 * v1 itself is gone: `model.ts`, `minutes.ts`, `team-strength.ts` and the rate-blending in
 * `projections.service.ts` were deleted when `pnpm project` became the fitted path (B-007 Phase 4e).
 * Their behaviour is not untested — it is superseded, and what replaced it is covered by
 * `calibration/__tests__/calibration.spec.ts` and measured in `reports/calibration-*.md`.
 *
 * Keeping the shells around would have been worse than deleting them: a second projection model
 * sitting in the tree is a second writer waiting to be wired up, which is the exact footgun this
 * change removes.
 *
 * The single-season time cut stays because the live path still uses it — a live gameweek has a
 * `dataChecked` flag and the archive's finished seasons do not.
 */
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
