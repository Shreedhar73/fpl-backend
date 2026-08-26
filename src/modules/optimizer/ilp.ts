import { PositionCode } from '../fpl-sync/mappers';
import { Rules, POSITIONS } from './rules';

/**
 * Builds the squad-selection integer linear program as a CPLEX LP-format string for HiGHS — pure, no
 * solver import, so it is unit-testable on its own. This is a real ILP, not a greedy picker: greedy on
 * points-per-million is provably wrong under a budget plus a 3-per-club cap (`fpl-optimizer`).
 *
 * HiGHS, not javascript-lp-solver: the latter returns wrong (non-optimal) integer solutions even on a
 * three-variable problem — it picked a 21-point pair over the optimal 45-point one under a slack
 * budget. HiGHS (the Edinburgh solver, WASM) solves to optimality.
 *
 * One binary per candidate: `x` = in the 15. The XI, captain and bench are chosen from the 15
 * afterwards by exact enumeration (`pickBestXi`) — a tiny secondary problem kept out of the ILP.
 */
export interface Candidate {
  key: string; // LP variable name, e.g. "p_<playerId>" (alphanumeric — LP-safe)
  playerId: string;
  webName: string;
  position: PositionCode;
  teamId: string;
  cost: number; // tenths
  ep: number; // horizon expected points
  pPlay: number;
}

/** Join additive terms as an LP expression, wrapping across lines but keeping the `+` at each break
 * (a linear expression may span lines only after an operator). */
function expr(parts: string[]): string {
  return parts.join(' +\n  ');
}

export function buildLp(candidates: Candidate[], rules: Rules): string {
  const clubs = [...new Set(candidates.map((c) => c.teamId))];
  const inPos = (pos: PositionCode) => candidates.filter((c) => c.position === pos);
  const inClub = (teamId: string) => candidates.filter((c) => c.teamId === teamId);

  const lines: string[] = [];
  lines.push('Maximize');
  lines.push(' obj: ' + expr(candidates.map((c) => `${c.ep.toFixed(4)} ${c.key}`)));

  lines.push('Subject To');
  lines.push(` squad: ${expr(candidates.map((c) => c.key))} = ${rules.squadSize()}`);
  for (const pos of POSITIONS) {
    lines.push(` sel_${pos}: ${expr(inPos(pos).map((c) => c.key))} = ${rules.squadSelect(pos)}`);
  }
  lines.push(` budget: ${expr(candidates.map((c) => `${c.cost} ${c.key}`))} <= ${rules.budget()}`);
  for (const teamId of clubs) {
    lines.push(` club_${teamId}: ${expr(inClub(teamId).map((c) => c.key))} <= ${rules.clubLimit()}`);
  }

  lines.push('Binary');
  // Binary section lists variable names only — no '+' operators.
  lines.push('  ' + candidates.map((c) => c.key).join('\n  '));
  lines.push('End');
  return lines.join('\n');
}

export interface XiResult {
  starters: Set<string>; // candidate keys
  formation: string; // "DEF-MID-FWD"
}

/**
 * Best legal starting XI from the chosen 15: exactly 1 GKP, and a DEF/MID/FWD split within each
 * position's min/max play that sums to 10 outfield. Enumerates the handful of legal formations and
 * takes the highest-EP players per position in each — exact, tiny.
 */
export function pickBestXi(squad: Candidate[], rules: Rules): XiResult {
  const byPos = (pos: PositionCode) =>
    squad.filter((c) => c.position === pos).sort((a, b) => b.ep - a.ep);
  const gk = byPos('GKP');
  const def = byPos('DEF');
  const mid = byPos('MID');
  const fwd = byPos('FWD');

  let best: { starters: Set<string>; formation: string; ep: number } | null = null;
  for (let d = rules.minPlay('DEF'); d <= Math.min(rules.maxPlay('DEF'), def.length); d++) {
    for (let m = rules.minPlay('MID'); m <= Math.min(rules.maxPlay('MID'), mid.length); m++) {
      const f = rules.xiSize() - 1 - d - m; // outfield left for FWD
      if (f < rules.minPlay('FWD') || f > Math.min(rules.maxPlay('FWD'), fwd.length)) continue;
      const chosen = [...gk.slice(0, 1), ...def.slice(0, d), ...mid.slice(0, m), ...fwd.slice(0, f)];
      const ep = chosen.reduce((s, c) => s + c.ep, 0);
      if (!best || ep > best.ep) {
        best = { starters: new Set(chosen.map((c) => c.key)), formation: `${d}-${m}-${f}`, ep };
      }
    }
  }
  if (!best) throw new Error('no legal XI from the chosen squad');
  return { starters: best.starters, formation: best.formation };
}
