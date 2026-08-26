import { PositionCode } from '../fpl-sync/mappers';

/**
 * Typed accessor over the `scoring_config.scoring` JSON (mirror of `game_config.scoring`). The points
 * engine reads points from HERE, never from constants — FPL changed goalkeeper goal scoring and added
 * the defensive-contribution category within two seasons, and a hardcoded table is silently wrong the
 * day it changes (`fpl-domain-rules`). Per-position events (`goals_scored`, `clean_sheets`,
 * `goals_conceded`, `defensive_contribution`) are keyed by position; the rest are scalars.
 */
type PerPosition = Record<PositionCode, number>;

export interface RawScoring {
  long_play: number;
  short_play: number;
  goals_scored: PerPosition;
  clean_sheets: PerPosition;
  goals_conceded: PerPosition;
  defensive_contribution: PerPosition;
  assists: number;
  saves: number;
  bonus: number;
}

export class Scoring {
  constructor(private readonly s: RawScoring) {}

  static from(json: unknown): Scoring {
    return new Scoring(json as RawScoring);
  }

  longPlay(): number {
    return this.s.long_play;
  }
  shortPlay(): number {
    return this.s.short_play;
  }
  goal(pos: PositionCode): number {
    return this.s.goals_scored[pos];
  }
  assist(): number {
    return this.s.assists;
  }
  cleanSheet(pos: PositionCode): number {
    return this.s.clean_sheets[pos];
  }
  /** Points per two goals conceded (negative for GKP/DEF). */
  goalsConceded(pos: PositionCode): number {
    return this.s.goals_conceded[pos];
  }
  defensiveContribution(pos: PositionCode): number {
    return this.s.defensive_contribution[pos];
  }
  savePoint(): number {
    return this.s.saves;
  }
}
