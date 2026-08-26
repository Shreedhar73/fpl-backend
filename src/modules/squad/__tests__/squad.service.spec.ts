import { FplHttpError } from '../../../infra/fpl/fpl-api.client';
import { SquadService } from '../squad.service';
import { SquadErrorCode } from '../squad.errors';
import { ENTRY_1, PICKS_1, PLAYER_ROWS } from './fixtures';

/**
 * The importer's job is to turn a recorded upstream payload into rows and a DTO without losing or
 * inventing anything, and to name each failure with the code the frontend switches on.
 *
 * The payloads are recorded from the live API, not invented (fpl-testing-contract): the field that
 * matters most here is one that does not exist upstream — a pick carries no purchase price — and a
 * hand-made fixture would happily have included one.
 */

type Fpl = { getEntry: jest.Mock; getEntryPicks: jest.Mock };
type Repo = {
  playersByFplId: jest.Mock;
  playersByIds: jest.Mock;
  gameweekExists: jest.Mock;
  latestReadableGameweek: jest.Mock;
  upsertSquad: jest.Mock;
  findSquad: jest.Mock;
};

function build(overrides: { fpl?: Partial<Fpl>; repo?: Partial<Repo> } = {}) {
  const fpl: Fpl = {
    getEntry: jest.fn().mockResolvedValue(ENTRY_1),
    getEntryPicks: jest.fn().mockResolvedValue(PICKS_1),
    ...overrides.fpl,
  };
  const repo: Repo = {
    playersByFplId: jest
      .fn()
      .mockResolvedValue(new Map(PLAYER_ROWS.map((p) => [p.fplId, p]))),
    playersByIds: jest.fn().mockResolvedValue(new Map()),
    gameweekExists: jest.fn().mockResolvedValue(true),
    latestReadableGameweek: jest.fn().mockResolvedValue(1),
    upsertSquad: jest.fn().mockResolvedValue(undefined),
    findSquad: jest.fn().mockResolvedValue(null),
    ...overrides.repo,
  };
  const optimizer = { run: jest.fn(), loadRules: jest.fn() };
  const service = new SquadService(
    fpl as never,
    repo as never,
    optimizer as never,
  );
  return { service, fpl, repo, optimizer };
}

/** The shape the repository returns for an already-stored squad. */
function stored(gameweekId = 1) {
  return {
    managerId: 1,
    gameweekId,
    bank: 0,
    teamValue: 1000,
    activeChip: null,
    picks: PICKS_1.picks.map((p, i) => ({
      playerId: PLAYER_ROWS[i].id,
      slot: p.position,
      multiplier: p.multiplier,
      isCaptain: p.is_captain,
      isViceCaptain: p.is_vice_captain,
      player: PLAYER_ROWS[i],
    })),
  };
}

describe('SquadService.importSquad — the mapping', () => {
  it('maps a recorded payload to 15 picks with slots, captain and vice preserved', async () => {
    const { service } = build();
    const dto = await service.importSquad(1);

    expect(dto.picks).toHaveLength(15);
    expect(dto.managerId).toBe(1);
    expect(dto.managerName).toBe('Chris Musson');
    expect(dto.gameweekId).toBe(1);
    expect(dto.source).toBe('import');

    // Slots are upstream's `position`, 1-15 in order — the bench order is inside them.
    expect(dto.picks.map((p) => p.slot)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);

    const captain = dto.picks.filter((p) => p.isCaptain);
    const vice = dto.picks.filter((p) => p.isViceCaptain);
    expect(captain).toHaveLength(1);
    expect(vice).toHaveLength(1);
    expect(captain[0].fplId).toBe(426);
    expect(vice[0].fplId).toBe(427);
    expect(captain[0].multiplier).toBe(2);
  });

  it('carries bank and team value through in tenths, untouched', async () => {
    const { service } = build();
    const dto = await service.importSquad(1);
    expect(dto.bank).toBe(PICKS_1.entry_history.bank);
    expect(dto.teamValue).toBe(PICKS_1.entry_history.value);
  });

  it('leaves sellValue null on every pick — no public endpoint carries a purchase price', async () => {
    const { service } = build();
    const dto = await service.importSquad(1);
    expect(dto.picks.map((p) => p.sellValue)).toEqual(Array(15).fill(null));
    // Break-on-purpose guard: if someone "helpfully" defaults it to nowCost, the line above goes
    // red rather than silently handing B-008 a wrong sell value.
    expect(dto.picks.every((p) => p.sellValue !== p.nowCost)).toBe(true);
  });

  it('persists the squad it returns, with isPlanned false implied by the repository', async () => {
    const { service, repo } = build();
    await service.importSquad(1);
    expect(repo.upsertSquad).toHaveBeenCalledTimes(1);
    const calls = repo.upsertSquad.mock.calls as unknown as [
      { managerId: number; gameweekId: number; picks: unknown[] },
    ][];
    const written = calls[0][0];
    expect(written.managerId).toBe(1);
    expect(written.gameweekId).toBe(1);
    expect(written.picks).toHaveLength(15);
  });
});

describe('SquadService.importSquad — the upstream call happens once', () => {
  it('serves an already-stored squad without calling upstream at all', async () => {
    const { service, fpl, repo } = build({
      repo: { findSquad: jest.fn().mockResolvedValue(stored(1)) },
    });

    const dto = await service.importSquad(1);

    expect(fpl.getEntry).not.toHaveBeenCalled();
    expect(fpl.getEntryPicks).not.toHaveBeenCalled();
    expect(repo.upsertSquad).not.toHaveBeenCalled();
    expect(dto.picks).toHaveLength(15);
  });

  it('falls through to upstream when the store has nothing for the readable gameweek', async () => {
    const { service, fpl } = build();
    await service.importSquad(1);
    expect(fpl.getEntry).toHaveBeenCalledTimes(1);
    expect(fpl.getEntryPicks).toHaveBeenCalledTimes(1);
  });

  it('falls through when no gameweek is readable yet, rather than guessing', async () => {
    const { service, fpl, repo } = build({
      repo: { latestReadableGameweek: jest.fn().mockResolvedValue(null) },
    });
    await service.importSquad(1);
    expect(repo.findSquad).not.toHaveBeenCalled();
    expect(fpl.getEntry).toHaveBeenCalledTimes(1);
  });
});

describe('SquadService.importSquad — every failure gets its own code', () => {
  async function codeOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (err) {
      const body = (
        err as { getResponse: () => { errorCode: string } }
      ).getResponse();
      return body.errorCode;
    }
    throw new Error('expected the call to throw, and it did not');
  }

  it('MANAGER_NOT_FOUND when the entry itself 404s', async () => {
    const { service } = build({
      fpl: {
        getEntry: jest.fn().mockRejectedValue(new FplHttpError('nope', 404)),
      },
    });
    expect(await codeOf(service.importSquad(7))).toBe(
      SquadErrorCode.MANAGER_NOT_FOUND,
    );
  });

  it('SQUAD_NOT_AVAILABLE_YET when the manager has never played a gameweek', async () => {
    const { service } = build({
      fpl: {
        getEntry: jest
          .fn()
          .mockResolvedValue({ ...ENTRY_1, current_event: null }),
      },
    });
    expect(await codeOf(service.importSquad(1))).toBe(
      SquadErrorCode.SQUAD_NOT_AVAILABLE_YET,
    );
  });

  it('SQUAD_NOT_AVAILABLE_YET — not MANAGER_NOT_FOUND — when the picks 404 after the entry resolved', async () => {
    const { service } = build({
      fpl: {
        getEntryPicks: jest
          .fn()
          .mockRejectedValue(new FplHttpError('not public', 404)),
      },
    });
    // The distinction is the whole point: the manager plainly exists, we just fetched them.
    expect(await codeOf(service.importSquad(1))).toBe(
      SquadErrorCode.SQUAD_NOT_AVAILABLE_YET,
    );
  });

  it('SQUAD_NOT_AVAILABLE_YET when the gameweek has not been synced locally', async () => {
    const { service } = build({
      repo: { gameweekExists: jest.fn().mockResolvedValue(false) },
    });
    expect(await codeOf(service.importSquad(1))).toBe(
      SquadErrorCode.SQUAD_NOT_AVAILABLE_YET,
    );
  });

  it("FPL_UPSTREAM_UNAVAILABLE on a timeout, which is not the user's fault", async () => {
    const { service } = build({
      fpl: {
        getEntry: jest
          .fn()
          .mockRejectedValue(new FplHttpError('timeout', undefined, true)),
      },
    });
    expect(await codeOf(service.importSquad(1))).toBe(
      SquadErrorCode.FPL_UPSTREAM_UNAVAILABLE,
    );
  });

  it('FPL_UPSTREAM_UNAVAILABLE on a 503', async () => {
    const { service } = build({
      fpl: {
        getEntry: jest.fn().mockRejectedValue(new FplHttpError('down', 503)),
      },
    });
    expect(await codeOf(service.importSquad(1))).toBe(
      SquadErrorCode.FPL_UPSTREAM_UNAVAILABLE,
    );
  });

  it('UNKNOWN_PLAYER rather than a short squad when an element has no local row', async () => {
    const partial = new Map(PLAYER_ROWS.slice(0, 14).map((p) => [p.fplId, p]));
    const { service, repo } = build({
      repo: { playersByFplId: jest.fn().mockResolvedValue(partial) },
    });
    expect(await codeOf(service.importSquad(1))).toBe(
      SquadErrorCode.UNKNOWN_PLAYER,
    );
    // And nothing was written — a 14-player squad must never reach the database.
    expect(repo.upsertSquad).not.toHaveBeenCalled();
  });

  it('SQUAD_NOT_IMPORTED when reading a manager we have never fetched', async () => {
    const { service } = build();
    expect(await codeOf(service.getSquad(4242))).toBe(
      SquadErrorCode.SQUAD_NOT_IMPORTED,
    );
  });
});
