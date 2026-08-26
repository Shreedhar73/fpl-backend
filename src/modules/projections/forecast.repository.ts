import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PositionCode } from '../fpl-sync/mappers';
import { HistoryRow } from './features';
import { RawScoring } from './scoring';

/** The completed seasons held in `archive_player_gameweek` (B-007 Phase 2b). */
export const ARCHIVE_SEASONS = ['2023-24', '2024-25', '2025-26'];

/**
 * Reads for the forward projection: this season's own rows in the same shape as the archive's, plus
 * the fixtures being projected and the availability that decides whether a player features at all.
 *
 * The point of the shared shape is that the model sees one history, not two. A player who appeared in
 * 2024-25 and again last week has both, joined on `Player.code`, and the feature engine cannot tell
 * which source a row came from — which is the only way a rate fitted on the archive means the same
 * thing when it is served.
 */
@Injectable()
export class ForecastRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The label this season's rows carry, matching the archive's format so they sort after them. */
  static readonly CURRENT_SEASON = '2026-27';

  /**
   * Every archive row, as history.
   *
   * Lives here rather than in the calibration module because the SERVING path needs it: a projection
   * for this August rests almost entirely on previous seasons. The backtest reads it through the same
   * method, so there is one definition of what history is.
   */
  async archiveHistory(
    seasons: string[] = ARCHIVE_SEASONS,
  ): Promise<HistoryRow[]> {
    const rows = await this.prisma.archivePlayerGameweek.findMany({
      where: { season: { in: seasons } },
      orderBy: [{ season: 'asc' }, { round: 'asc' }],
      select: {
        season: true,
        round: true,
        fixture: true,
        playerCode: true,
        webName: true,
        position: true,
        teamCode: true,
        opponentTeamCode: true,
        wasHome: true,
        minutes: true,
        starts: true,
        totalPoints: true,
        goalsScored: true,
        ownGoals: true,
        assists: true,
        cleanSheets: true,
        goalsConceded: true,
        saves: true,
        bonus: true,
        bps: true,
        defensiveContribution: true,
        expectedGoals: true,
        expectedAssists: true,
        value: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      position: r.position,
      expectedGoals: Number(r.expectedGoals),
      expectedAssists: Number(r.expectedAssists),
    }));
  }

  /** The current season's scoring table, which is what an upcoming gameweek is scored under. */
  async liveScoring(): Promise<RawScoring> {
    const row = await this.prisma.scoringConfig.findFirst({
      orderBy: { season: 'desc' },
    });
    if (!row) throw new Error('no scoring_config — run `pnpm sync:fpl` first');
    return row.scoring as unknown as RawScoring;
  }

  /**
   * This season's finished gameweeks, as `HistoryRow`.
   *
   * `fixtureId` is a cuid here and an integer in the archive, so it is mapped to a stable per-season
   * integer. Only its uniqueness within a round matters — it exists so a double gameweek stays two
   * rows.
   */
  async currentSeasonHistory(): Promise<HistoryRow[]> {
    const [stats, players, teams] = await Promise.all([
      this.prisma.playerGameweekStat.findMany({
        orderBy: [{ gameweekId: 'asc' }],
      }),
      this.prisma.player.findMany({
        select: {
          id: true,
          code: true,
          webName: true,
          position: true,
          teamId: true,
        },
      }),
      this.prisma.team.findMany({
        select: { id: true, fplId: true, code: true },
      }),
    ]);

    const player = new Map(players.map((p) => [p.id, p]));
    const codeByTeamId = new Map(teams.map((t) => [t.id, t.code]));
    const codeByTeamFplId = new Map(teams.map((t) => [t.fplId, t.code]));

    const fixtureNumber = new Map<string, number>();
    const numberFor = (cuid: string): number => {
      let n = fixtureNumber.get(cuid);
      if (n === undefined) {
        n = fixtureNumber.size + 1;
        fixtureNumber.set(cuid, n);
      }
      return n;
    };

    const rows: HistoryRow[] = [];
    for (const s of stats) {
      const p = player.get(s.playerId);
      if (!p) continue;
      rows.push({
        season: ForecastRepository.CURRENT_SEASON,
        round: s.gameweekId,
        fixture: numberFor(s.fixtureId),
        playerCode: p.code,
        webName: p.webName,
        position: p.position,
        teamCode: codeByTeamId.get(p.teamId) ?? null,
        opponentTeamCode: codeByTeamFplId.get(s.opponentTeamFplId) ?? null,
        wasHome: s.wasHome,
        minutes: s.minutes,
        starts: s.starts,
        totalPoints: s.totalPoints,
        goalsScored: s.goalsScored,
        ownGoals: s.ownGoals,
        assists: s.assists,
        cleanSheets: s.cleanSheets,
        goalsConceded: s.goalsConceded,
        saves: s.saves,
        bonus: s.bonus,
        bps: s.bps,
        defensiveContribution: s.defensiveContribution,
        expectedGoals: Number(s.expectedGoals),
        expectedAssists: Number(s.expectedAssists),
        value: s.value,
      });
    }
    return rows;
  }

  /**
   * The fixtures of a gameweek, as one synthetic row per player per fixture.
   *
   * These carry no outcome — they are the questions, not the answers. Every stat is 0 and nothing
   * reads them, because the feature engine yields a round's features BEFORE folding that round in, so
   * a synthetic row never contaminates what it is asking about.
   */
  async syntheticRowsFor(gameweekId: number): Promise<HistoryRow[]> {
    const [fixtures, players, teams] = await Promise.all([
      this.prisma.fixture.findMany({
        where: { gameweekId },
        select: { id: true, homeTeamId: true, awayTeamId: true },
      }),
      this.prisma.player.findMany({
        where: { removed: false },
        select: {
          code: true,
          webName: true,
          position: true,
          teamId: true,
          nowCost: true,
        },
      }),
      this.prisma.team.findMany({ select: { id: true, code: true } }),
    ]);

    const codeByTeamId = new Map(teams.map((t) => [t.id, t.code]));
    const byTeam = new Map<string, typeof players>();
    for (const p of players) {
      const list = byTeam.get(p.teamId) ?? [];
      list.push(p);
      byTeam.set(p.teamId, list);
    }

    const rows: HistoryRow[] = [];
    fixtures.forEach((f, index) => {
      for (const [teamId, isHome] of [
        [f.homeTeamId, true],
        [f.awayTeamId, false],
      ] as const) {
        const opponentId = isHome ? f.awayTeamId : f.homeTeamId;
        for (const p of byTeam.get(teamId) ?? []) {
          rows.push({
            season: ForecastRepository.CURRENT_SEASON,
            round: gameweekId,
            fixture: 10_000 + index,
            playerCode: p.code,
            webName: p.webName,
            position: p.position,
            teamCode: codeByTeamId.get(teamId) ?? null,
            opponentTeamCode: codeByTeamId.get(opponentId) ?? null,
            wasHome: isHome,
            minutes: 0,
            starts: 0,
            totalPoints: 0,
            goalsScored: 0,
            ownGoals: 0,
            assists: 0,
            cleanSheets: 0,
            goalsConceded: 0,
            saves: 0,
            bonus: 0,
            bps: 0,
            defensiveContribution: null,
            expectedGoals: 0,
            expectedAssists: 0,
            value: p.nowCost,
          });
        }
      }
    });
    return rows;
  }

  /**
   * Availability per player, preferring the deadline snapshot over the live row.
   *
   * The live `players` row is overwritten continuously; the snapshot is what was true before the
   * deadline. Using the snapshot where one exists is the difference between projecting a gameweek and
   * reporting one.
   */
  async availabilityByCode(
    gameweekId: number,
  ): Promise<
    Map<
      number,
      { status: string; chance: number | null; fromSnapshot: boolean }
    >
  > {
    const [players, snapshots] = await Promise.all([
      this.prisma.player.findMany({
        select: {
          id: true,
          code: true,
          status: true,
          chanceOfPlayingNextRound: true,
        },
      }),
      this.prisma.playerDeadlineSnapshot.findMany({
        where: { gameweekId },
        select: {
          playerId: true,
          status: true,
          chanceOfPlayingNextRound: true,
        },
      }),
    ]);

    const codeById = new Map(players.map((p) => [p.id, p.code]));
    const out = new Map<
      number,
      { status: string; chance: number | null; fromSnapshot: boolean }
    >();
    for (const p of players) {
      out.set(p.code, {
        status: p.status,
        chance: p.chanceOfPlayingNextRound,
        fromSnapshot: false,
      });
    }
    for (const s of snapshots) {
      const code = codeById.get(s.playerId);
      if (code === undefined) continue;
      out.set(code, {
        status: s.status,
        chance: s.chanceOfPlayingNextRound,
        fromSnapshot: true,
      });
    }
    return out;
  }

  async playerIdByCode(): Promise<Map<number, string>> {
    const rows = await this.prisma.player.findMany({
      select: { id: true, code: true },
    });
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  async nextGameweek(): Promise<number | null> {
    const row = await this.prisma.gameweek.findFirst({
      where: { deadlineTime: { gt: new Date() } },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }
}
