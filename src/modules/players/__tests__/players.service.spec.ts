import { HttpException } from '@nestjs/common';
import { MODEL_VERSION } from '../../projections/projections.service';
import type {
  PlayerDetailRow,
  PlayersRepository,
  ProjectionRow,
  RecentStatRow,
  TeamFixtureRow,
} from '../players.repository';
import { PlayersService, RECENT_MATCHES } from '../players.service';

/**
 * The player detail (plan 030) against an in-memory repository double. What is checked here is
 * the composition, not the SQL: that an absence stays an absence, that the horizon keeps its
 * order, that fixtures land on the gameweek they belong to, and that the list reads the pin.
 */

const ROW: PlayerDetailRow = {
  playerId: 'p1',
  fplId: 1,
  webName: 'Haaland',
  fullName: 'Erling Haaland',
  position: 'FWD',
  teamId: 't-mci',
  teamShortName: 'MCI',
  teamName: 'Man City',
  nowCost: 155,
  status: 'a',
  news: null,
  chanceOfPlayingNextRound: null,
  form: 7.5,
  pointsPerGame: 6.8,
  seasonMinutes: 180,
  seasonStarts: 2,
  penaltiesOrder: 1,
  directFreekicksOrder: null,
  cornersOrder: null,
};

function projection(gameweekId: number, ep: number): ProjectionRow {
  return {
    gameweekId,
    expectedPoints: ep,
    expectedMinutes: 84,
    playProbability: 0.97,
    sd: 3.1,
    pBlank: 0.3,
    pHaul: 0.12,
    components: { goals: 2.1, appearance: 1.9 },
  };
}

function fixture(
  gameweekId: number,
  opponentShortName: string,
  isHome: boolean,
): TeamFixtureRow {
  return {
    gameweekId,
    opponentShortName,
    isHome,
    difficulty: isHome ? 2 : 4,
    kickoffTime: new Date('2026-09-05T14:00:00Z'),
  };
}

const RECENT: RecentStatRow = {
  gameweekId: 2,
  opponentShortName: 'TOT',
  wasHome: true,
  minutes: 90,
  points: 13,
  goals: 2,
  assists: 0,
  cleanSheets: 0,
  bonus: 3,
  expectedGoals: 1.4,
  expectedAssists: 0.1,
};

type Overrides = Partial<{
  row: PlayerDetailRow | null;
  version: string | null;
  horizon: number[];
  projections: ProjectionRow[];
  fixtures: TeamFixtureRow[];
  recent: RecentStatRow[];
  totals: Awaited<ReturnType<PlayersRepository['seasonTotals']>>;
  ownership: number | null;
  price: Awaited<ReturnType<PlayersRepository['priceBounds']>>;
}>;

function build(o: Overrides = {}) {
  const repo = {
    listAll: jest.fn().mockResolvedValue([]),
    servedModelVersion: jest
      .fn()
      .mockResolvedValue(o.version === undefined ? MODEL_VERSION : o.version),
    nextGameweek: jest.fn().mockResolvedValue(3),
    horizonGameweeks: jest.fn().mockResolvedValue(o.horizon ?? [3, 4, 5, 6, 7]),
    projectionsFor: jest.fn().mockResolvedValue(new Map()),
    detail: jest.fn().mockResolvedValue(o.row === undefined ? ROW : o.row),
    horizonProjections: jest.fn().mockResolvedValue(o.projections ?? []),
    fixturesForTeam: jest.fn().mockResolvedValue(o.fixtures ?? []),
    recentStats: jest.fn().mockResolvedValue(o.recent ?? []),
    seasonTotals: jest.fn().mockResolvedValue(o.totals ?? null),
    latestOwnership: jest.fn().mockResolvedValue(o.ownership ?? null),
    priceBounds: jest.fn().mockResolvedValue(o.price ?? null),
  };
  return { repo, service: new PlayersService(repo as never) };
}

describe('PlayersService.detail', () => {
  it('renders a player the model has not reached as absence, never as zeros', async () => {
    const { service } = build();
    const d = await service.detail('p1');

    expect(d.projections).toEqual([]);
    expect(d.modelVersion).toBeNull();
    expect(d.seasonTotals).toBeNull();
    expect(d.selectedByPercent).toBeNull();
    expect(d.priceChangeSinceTracked).toBeNull();
    expect(d.recent).toEqual([]);
    // The horizon is still stated — it is a fact about the calendar, not about the player.
    expect(d.horizonGameweekIds).toEqual([3, 4, 5, 6, 7]);
  });

  it('keeps the horizon in gameweek order and lands each fixture on its own gameweek', async () => {
    const { service } = build({
      projections: [projection(3, 6.1), projection(4, 5.2), projection(5, 7.0)],
      fixtures: [
        fixture(3, 'BHA', true),
        fixture(5, 'ARS', false),
        fixture(5, 'LIV', true), // a double
      ],
    });
    const d = await service.detail('p1');

    expect(d.modelVersion).toBe(MODEL_VERSION);
    expect(d.projections.map((p) => p.gameweekId)).toEqual([3, 4, 5]);
    expect(d.projections[0].fixtures).toEqual([
      {
        opponentShortName: 'BHA',
        isHome: true,
        difficulty: 2,
        kickoffTime: '2026-09-05T14:00:00.000Z',
      },
    ]);
    // A blank is an empty list, not a missing projection.
    expect(d.projections[1].fixtures).toEqual([]);
    expect(d.projections[2].fixtures.map((f) => f.opponentShortName)).toEqual([
      'ARS',
      'LIV',
    ]);
    // The distribution comes through untouched, nullable fields included.
    expect(d.projections[0].sd).toBe(3.1);
    expect(d.projections[0].components).toEqual({
      goals: 2.1,
      appearance: 1.9,
    });
  });

  it('never asks for projections when nothing is served under the pin', async () => {
    const { service, repo } = build({ version: null });
    const d = await service.detail('p1');

    expect(repo.horizonProjections).not.toHaveBeenCalled();
    expect(d.projections).toEqual([]);
    expect(d.modelVersion).toBeNull();
  });

  it('dates the price change and names it as since-tracked, not since-season', async () => {
    const { service } = build({
      price: {
        first: { cost: 150, recordedAt: new Date('2026-08-20T00:00:00Z') },
        last: { cost: 155, recordedAt: new Date('2026-09-02T00:00:00Z') },
      },
      ownership: 61.3,
      recent: [RECENT],
    });
    const d = await service.detail('p1');

    expect(d.priceChangeSinceTracked).toBe(5);
    expect(d.priceTrackedSince).toBe('2026-08-20T00:00:00.000Z');
    expect(d.selectedByPercent).toBe(61.3);
    expect(d.recent).toEqual([RECENT]);
  });

  it('asks for exactly the number of recent matches the sheet shows', async () => {
    const { service, repo } = build();
    await service.detail('p1');
    expect(repo.recentStats).toHaveBeenCalledWith('p1', RECENT_MATCHES);
  });

  it('throws the coded 404 for an id with no row behind it', async () => {
    const { service, repo } = build({ row: null });
    await expect(service.detail('nope')).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'UNKNOWN_PLAYER' },
    });
    const err = await service.detail('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    // The remaining reads never run for a missing player.
    expect(repo.fixturesForTeam).not.toHaveBeenCalled();
  });
});

describe('PlayersService.list', () => {
  it('prices the list under the served pin, not whichever projection row is newest', async () => {
    const { service, repo } = build();
    repo.listAll.mockResolvedValue([
      {
        playerId: 'p1',
        fplId: 1,
        webName: 'Haaland',
        position: 'FWD',
        teamShortName: 'MCI',
        nowCost: 155,
        status: 'a',
        news: null,
      },
    ]);
    repo.projectionsFor.mockResolvedValue(
      new Map([['p1', { expectedPoints: 6.1, playProbability: 0.97 }]]),
    );

    const list = await service.list();

    expect(repo.projectionsFor).toHaveBeenCalledWith(3, MODEL_VERSION);
    expect(list.modelVersion).toBe(MODEL_VERSION);
    expect(list.players[0].epNextGw).toBe(6.1);
  });

  it('serves the roster with null projections when the pin has no rows', async () => {
    const { service, repo } = build({ version: null });
    repo.listAll.mockResolvedValue([
      {
        playerId: 'p1',
        fplId: 1,
        webName: 'Haaland',
        position: 'FWD',
        teamShortName: 'MCI',
        nowCost: 155,
        status: 'a',
        news: null,
      },
    ]);

    const list = await service.list();

    expect(repo.projectionsFor).not.toHaveBeenCalled();
    expect(list.modelVersion).toBeNull();
    expect(list.gameweekId).toBeNull();
    expect(list.players[0].epNextGw).toBeNull();
  });
});
