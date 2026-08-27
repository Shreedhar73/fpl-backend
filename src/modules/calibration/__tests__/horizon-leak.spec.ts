import { HistoryRow, walkRounds } from '../../projections/features';
import { FITTED_PARAMS } from '../../projections/fitted';

const row = (over: Partial<HistoryRow> & { round: number }): HistoryRow => ({
  season: '2025-26',
  fixture: over.round * 100 + (over.playerCode ?? 1),
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
  minutes: 90,
  starts: 1,
  totalPoints: 2,
  goalsScored: 0,
  ownGoals: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 1,
  saves: 0,
  bonus: 0,
  bps: 15,
  defensiveContribution: null,
  expectedGoals: 0.1,
  expectedAssists: 0.1,
  value: 50,
  ...over,
});

/** Two players so the league has both sides of a fixture, over `rounds` rounds. */
const season = (rounds: number, over: (r: number) => Partial<HistoryRow> = () => ({})): HistoryRow[] => {
  const out: HistoryRow[] = [];
  for (let r = 1; r <= rounds; r++) {
    out.push(row({ round: r, playerCode: 1, teamCode: 1, opponentTeamCode: 2, ...over(r) }));
    out.push(
      row({
        round: r,
        playerCode: 2,
        webName: 'Other',
        teamCode: 2,
        opponentTeamCode: 1,
        wasHome: false,
      }),
    );
  }
  return out;
};

/**
 * The leak plan 010's invariant 2 exists for. A horizon is several rounds of projections taken at ONE
 * deadline; if each future round were scored with its own context, it would read features built from
 * rounds nobody had played when the decision was made — and produce no error and nothing
 * wrong-looking in the output.
 */
describe('the horizon is frozen at the deadline', () => {
  const contexts = (horizon: number, rows = season(10)) => [
    ...walkRounds(rows, FITTED_PARAMS, { horizon }),
  ];

  it('yields nothing ahead when no horizon is asked for', () => {
    for (const c of contexts(1)) expect(c.future).toEqual([]);
  });

  it('yields the next rounds of the same season, in order', () => {
    const c = contexts(5).find((x) => x.round === 3)!;
    expect(c.future.map((f) => f.round)).toEqual([4, 5, 6, 7]);
  });

  it('runs off the end of a season rather than wrapping into the next', () => {
    const c = contexts(5).find((x) => x.round === 9)!;
    expect(c.future.map((f) => f.round)).toEqual([10]);
  });

  // The invariant itself: a future round is scored with THIS deadline's features. If the walk folded
  // the intervening rounds in first, these would differ.
  it('scores a future round with the features of the deadline, not of that round', () => {
    const c = contexts(5).find((x) => x.round === 5)!;
    const now = c.items.find((i) => i.row.playerCode === 1)!;
    for (const ahead of c.future) {
      const later = ahead.items.find((i) => i.row.playerCode === 1)!;
      expect(later.features).toEqual(now.features);
    }
  });

  // Sharper: make the intervening rounds impossible to ignore. If any of them leaked in, the
  // features would move.
  it('does not see a haul that happens between the deadline and the future round', () => {
    const quiet = contexts(5, season(10));
    const loud = contexts(
      5,
      season(10, (r) =>
        r >= 6 ? { totalPoints: 20, goalsScored: 3, expectedGoals: 2.5 } : {},
      ),
    );
    const at5 = (cs: ReturnType<typeof contexts>) =>
      cs.find((x) => x.round === 5)!;
    const a = at5(quiet).future.at(-1)!.items.find((i) => i.row.playerCode === 1)!;
    const b = at5(loud).future.at(-1)!.items.find((i) => i.row.playerCode === 1)!;
    // Round 9 is inside round 5's horizon and rounds 6-8 have already happened in `loud`. The
    // features must be identical: at deadline 5 none of them had been played.
    expect(b.features).toEqual(a.features);
  });

  it('still lets the walk itself see the haul once the rounds are folded in', () => {
    const loud = contexts(
      5,
      season(10, (r) =>
        r >= 6 ? { totalPoints: 20, goalsScored: 3, expectedGoals: 2.5 } : {},
      ),
    );
    const before = loud.find((x) => x.round === 5)!;
    const after = loud.find((x) => x.round === 9)!;
    const f = (c: typeof before) =>
      c.items.find((i) => i.row.playerCode === 1)!.features;
    expect(f(after)).not.toEqual(f(before));
  });
});
