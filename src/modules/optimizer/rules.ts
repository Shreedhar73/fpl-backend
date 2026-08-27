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
  /** how many free transfers may be BANKED beyond the one granted each gameweek */
  max_extra_free_transfers?: number;
  /** the fraction of a price RISE the seller keeps — 0.5 today, and it has not always been */
  transfers_sell_on_fee?: number;
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
  /**
   * The most free transfers that can be held at once — one granted per gameweek plus the bank.
   *
   * `max_extra_free_transfers` is 4 today, so the cap is 5. Read rather than assumed: it was 1 and
   * then 2 in living memory (`fpl-domain-rules`), and a rule that has changed will change again.
   */
  freeTransferCap(): number {
    return (this.rules.max_extra_free_transfers ?? 4) + 1;
  }
  /** The share of a price rise the seller keeps. 0.5 today — the sell-on fee. */
  sellOnFee(): number {
    return this.rules.transfers_sell_on_fee ?? 0.5;
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
    if (!row)
      throw new Error(`no quota for position ${p} in scoring_config.positions`);
    return row;
  }
}
