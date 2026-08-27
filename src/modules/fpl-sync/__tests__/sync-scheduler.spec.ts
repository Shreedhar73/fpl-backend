import { SyncScheduler } from '../sync.scheduler';
import { SyncService } from '../sync.service';
import { SyncRepository } from '../sync.repository';
import { ProjectionsService } from '../../projections/projections.service';

/**
 * The window rule that keeps the prospective verdict fed (B-037): projections run on the sync tick
 * exactly when the next deadline is inside the snapshot window, and a projection failure is loud
 * without failing the sync.
 */
describe('projectIfDeadlineNear', () => {
  const at = (deadlineHoursAway: number | null) =>
    ({
      nextDeadline: async () =>
        deadlineHoursAway === null
          ? null
          : {
              gameweekId: 3,
              deadlineTime: new Date(NOW.getTime() + deadlineHoursAway * 3_600_000),
            },
    }) as unknown as SyncRepository;
  const NOW = new Date('2026-08-27T12:00:00Z');

  const scheduler = (
    repo: SyncRepository,
    run: () => Promise<{ rowsWritten: number }>,
  ) =>
    new SyncScheduler(
      {} as SyncService,
      { run } as unknown as ProjectionsService,
      repo,
    );

  it('projects inside the window', async () => {
    let ran = 0;
    const s = scheduler(at(10), async () => ((ran++, { rowsWritten: 1 })));
    expect(await s.projectIfDeadlineNear(NOW)).toBe(true);
    expect(ran).toBe(1);
  });

  it('does nothing outside the window', async () => {
    let ran = 0;
    const s = scheduler(at(48), async () => ((ran++, { rowsWritten: 1 })));
    expect(await s.projectIfDeadlineNear(NOW)).toBe(false);
    expect(ran).toBe(0);
  });

  it('does nothing after the season ends', async () => {
    const s = scheduler(at(null), async () => {
      throw new Error('must not run');
    });
    expect(await s.projectIfDeadlineNear(NOW)).toBe(false);
  });

  it('a projection failure returns false and does not throw into the sync tick', async () => {
    const s = scheduler(at(2), async () => {
      throw new Error('db down');
    });
    await expect(s.projectIfDeadlineNear(NOW)).resolves.toBe(false);
  });
});
