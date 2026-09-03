import { ErrorCode } from '../../../common/error-codes';
import { HORIZON } from '../../optimizer/policy';
import type { UpcomingGameweekRow } from '../gameweeks.repository';
import { GameweeksService } from '../gameweeks.service';

function build(rows: UpcomingGameweekRow[]) {
  const repo = { upcoming: jest.fn().mockResolvedValue(rows) };
  return { repo, service: new GameweeksService(repo as never) };
}

const gw = (id: number): UpcomingGameweekRow => ({
  id,
  name: `Gameweek ${id}`,
  deadlineTime: new Date(Date.UTC(2026, 8, 1 + id, 17, 30)),
});

describe('GameweeksService.next', () => {
  it('serves the first upcoming gameweek and the horizon from it', async () => {
    const { service, repo } = build([gw(3), gw(4), gw(5), gw(6), gw(7)]);
    const now = new Date('2026-09-03T06:00:00Z');
    const next = await service.next(now);

    expect(next.id).toBe(3);
    expect(next.name).toBe('Gameweek 3');
    expect(next.deadlineTime).toBe('2026-09-04T17:30:00.000Z');
    expect(next.horizonGameweekIds).toEqual([3, 4, 5, 6, 7]);
    // One read of the clock, for the same horizon the optimizer solves over.
    expect(repo.upcoming).toHaveBeenCalledWith(HORIZON, now);
  });

  it('states a short horizon at the end of the season rather than padding it', async () => {
    const { service } = build([gw(37), gw(38)]);
    const next = await service.next();
    expect(next.horizonGameweekIds).toEqual([37, 38]);
  });

  it('is a coded 404, not a null, when every deadline has passed', async () => {
    const { service } = build([]);
    await expect(service.next()).rejects.toMatchObject({
      status: 404,
      response: { errorCode: ErrorCode.NO_UPCOMING_GAMEWEEK },
    });
  });
});
