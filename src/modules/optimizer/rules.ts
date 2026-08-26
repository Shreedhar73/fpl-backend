import { PositionCode } from '../fpl-sync/mappers';

/**
 * Typed accessor over `scoring_config.rules` + `scoring_config.positions`. The optimizer reads every
 * squad constraint from HERE, never from constants (`fpl-domain-rules`): FPL can change the budget,
 * the squad size or a position quota between seasons, and a hardcoded 2/5/5/3 is silently wrong the
 * day it does.
 */
interface RawRules {
  squad_squadsize: number;
  squad_squadplay: number;
  squad_total_spend: number; // tenths
  squad_team_limit: number;
}

interface RawPosition {
  position: PositionCode;
  squadSelect: number;
  squadMinPlay: number;
  squadMaxPlay: number;
}

export const POSITIONS: PositionCode[] = ['GKP', 'DEF', 'MID', 'FWD'];

export class Rules {
  private readonly rules: RawRules;
  private readonly positions: Map<PositionCode, RawPosition>;

  constructor(rules: unknown, positions: unknown) {
    this.rules = rules as RawRules;
    const list = (positions as RawPosition[]) ?? [];
    this.positions = new Map(list.map((p) => [p.position, p]));
    if (this.positions.size !== POSITIONS.length) {
      throw new Error('scoring_config.positions is missing — re-run the sync');
    }
  }

  squadSize(): number {
    return this.rules.squad_squadsize;
  }
  xiSize(): number {
    return this.rules.squad_squadplay;
  }
  budget(): number {
    return this.rules.squad_total_spend;
  }
  clubLimit(): number {
    return this.rules.squad_team_limit;
  }
  squadSelect(pos: PositionCode): number {
    return this.pos(pos).squadSelect;
  }
  minPlay(pos: PositionCode): number {
    return this.pos(pos).squadMinPlay;
  }
  maxPlay(pos: PositionCode): number {
    return this.pos(pos).squadMaxPlay;
  }

  private pos(p: PositionCode): RawPosition {
    const row = this.positions.get(p);
    if (!row) throw new Error(`no quota for position ${p} in scoring_config.positions`);
    return row;
  }
}
