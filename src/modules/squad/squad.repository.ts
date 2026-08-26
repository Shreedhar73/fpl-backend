import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { Position } from '../../generated/prisma/enums';

export interface PlayerRow {
  id: string;
  fplId: number;
  webName: string;
  position: Position;
  nowCost: number;
  teamShortName: string;
}

export interface PersistPick {
  playerId: string;
  slot: number;
  multiplier: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export interface PersistedSquad {
  managerId: number;
  gameweekId: number;
  bank: number;
  teamValue: number;
  activeChip: string | null;
  picks: (PersistPick & { player: PlayerRow })[];
}

/** The only file in this module that touches Prisma — fpl-architecture-contract §2. */
@Injectable()
export class SquadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve FPL element ids to our own player rows, in one query. The caller checks the count:
   * a missing element must be an error, not a shorter squad.
   */
  async playersByFplId(fplIds: number[]): Promise<Map<number, PlayerRow>> {
    const rows = await this.prisma.player.findMany({
      where: { fplId: { in: fplIds } },
      select: {
        id: true,
        fplId: true,
        webName: true,
        position: true,
        nowCost: true,
        team: { select: { shortName: true } },
      },
    });
    return new Map(
      rows.map((r) => [
        r.fplId,
        {
          id: r.id,
          fplId: r.fplId,
          webName: r.webName,
          position: r.position,
          nowCost: r.nowCost,
          teamShortName: r.team.shortName,
        },
      ]),
    );
  }

  async playersByIds(ids: string[]): Promise<Map<string, PlayerRow>> {
    const rows = await this.prisma.player.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        fplId: true,
        webName: true,
        position: true,
        nowCost: true,
        team: { select: { shortName: true } },
      },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          fplId: r.fplId,
          webName: r.webName,
          position: r.position,
          nowCost: r.nowCost,
          teamShortName: r.team.shortName,
        },
      ]),
    );
  }

  async gameweekExists(id: number): Promise<boolean> {
    return (await this.prisma.gameweek.count({ where: { id } })) > 0;
  }

  /**
   * The latest gameweek whose picks are public — the deadline has passed. Used to answer "do we
   * already have this manager's current squad?" without an upstream call. A manager who joined
   * later has an earlier `current_event`, so a miss here simply falls through to the fetch; the
   * check never produces a wrong squad, only sometimes no answer.
   */
  async latestReadableGameweek(): Promise<number | null> {
    const row = await this.prisma.gameweek.findFirst({
      where: { deadlineTime: { lte: new Date() } },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Upsert the squad and replace its picks wholesale, in one transaction.
   *
   * Picks are deleted and re-inserted rather than upserted one by one: a re-import after a
   * transfer has a different set of players, and a per-pick upsert would leave the players who
   * are no longer in the squad sitting in the table. `sellValue` is deliberately not written —
   * see the schema comment.
   */
  async upsertSquad(input: {
    managerId: number;
    gameweekId: number;
    bank: number;
    teamValue: number;
    activeChip: string | null;
    picks: PersistPick[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const squad = await tx.squad.upsert({
        where: {
          managerId_gameweekId_isPlanned: {
            managerId: input.managerId,
            gameweekId: input.gameweekId,
            isPlanned: false,
          },
        },
        create: {
          managerId: input.managerId,
          gameweekId: input.gameweekId,
          bank: input.bank,
          teamValue: input.teamValue,
          activeChip: input.activeChip,
          isPlanned: false,
        },
        update: {
          bank: input.bank,
          teamValue: input.teamValue,
          activeChip: input.activeChip,
        },
        select: { id: true },
      });

      await tx.squadPick.deleteMany({ where: { squadId: squad.id } });
      await tx.squadPick.createMany({
        data: input.picks.map((p) => ({
          squadId: squad.id,
          playerId: p.playerId,
          position: p.slot,
          multiplier: p.multiplier,
          isCaptain: p.isCaptain,
          isViceCaptain: p.isViceCaptain,
        })),
      });
    });
  }

  /** The most recently imported squad for a manager, or one specific gameweek's. */
  async findSquad(
    managerId: number,
    gameweekId?: number,
  ): Promise<PersistedSquad | null> {
    const row = await this.prisma.squad.findFirst({
      where: {
        managerId,
        isPlanned: false,
        ...(gameweekId ? { gameweekId } : {}),
      },
      orderBy: { gameweekId: 'desc' },
      select: {
        managerId: true,
        gameweekId: true,
        bank: true,
        teamValue: true,
        activeChip: true,
        picks: {
          orderBy: { position: 'asc' },
          select: {
            playerId: true,
            position: true,
            multiplier: true,
            isCaptain: true,
            isViceCaptain: true,
            player: {
              select: {
                id: true,
                fplId: true,
                webName: true,
                position: true,
                nowCost: true,
                team: { select: { shortName: true } },
              },
            },
          },
        },
      },
    });
    if (!row) return null;

    return {
      managerId: row.managerId,
      gameweekId: row.gameweekId,
      bank: row.bank,
      teamValue: row.teamValue,
      activeChip: row.activeChip,
      picks: row.picks.map((p) => ({
        playerId: p.playerId,
        slot: p.position,
        multiplier: p.multiplier,
        isCaptain: p.isCaptain,
        isViceCaptain: p.isViceCaptain,
        player: {
          id: p.player.id,
          fplId: p.player.fplId,
          webName: p.player.webName,
          position: p.player.position,
          nowCost: p.player.nowCost,
          teamShortName: p.player.team.shortName,
        },
      })),
    };
  }
}
