# Deadline snapshots

`players` is a **snapshot table** — `status`, `chanceOfPlayingNextRound`, `epNext`, `epThis`, `form`,
`nowCost` and the set-piece orders are all scalars, upserted on every sync, with no history kept
anywhere and no public archive to backfill from. After a deadline they say what was true *after* the
matches, so a minutes model backtested against them is reading the answer.

B-007 Phase 2 builds `player_deadline_snapshot` to record this properly. It cannot land before the
GW2 deadline (**2026-08-28 11:45 UTC**), so the files here are a zero-code hedge for that one
gameweek: a `\copy` of `players` joined to `teams`, taken before the deadline and committed.

```bash
URL=$(grep -h DATABASE_URL .env | sed 's/^[^=]*=//; s/^"//; s/"$//; s/?schema=public//')
TS=$(date -u +'%Y%m%dT%H%M%SZ')
psql "$URL" -c "\copy (select p.\"fplId\", p.\"webName\", p.position, t.\"fplId\" as team_fpl_id,
  t.\"shortName\" as team, p.\"nowCost\", p.status, p.\"chanceOfPlayingNextRound\", p.news,
  p.\"newsAddedAt\", p.removed, p.form, p.\"pointsPerGame\", p.\"epNext\", p.\"epThis\",
  p.\"expectedGoalsPer90\", p.\"expectedAssistsPer90\", p.\"expectedGoalsConcededPer90\",
  p.\"defensiveContributionPer90\", p.\"savesPer90\", p.\"startsPer90\", p.\"penaltiesOrder\",
  p.\"directFreekicksOrder\", p.\"cornersOrder\", p.\"seasonMinutes\", p.\"seasonStarts\",
  p.\"updatedAt\" from players p join teams t on t.id = p.\"teamId\" order by p.\"fplId\")
  TO 'reports/snapshots/gw2-players-$TS.csv' CSV HEADER"
```

Filename is `gw<N>-players-<UTC timestamp>.csv`. The timestamp is the capture time, not the deadline —
several captures per gameweek are expected and **the latest one before the deadline is the one to
read**, because news moves until the deadline.

Keyed on `fplId` and `team_fpl_id`, never the internal cuids, so the file survives a database reset.

Two things a future session needs to know:

- **This is a flat file, not a queryable snapshot.** No query finds it by accident. The calibration
  harness (Phase 3) has to read it for GW2 explicitly, or GW2 is skipped like any snapshot-less
  gameweek — which is the correct default, not a bug.
- **`chanceOfPlayingNextRound` empty means fully fit**, not unknown. CSV renders the `NULL` as an
  empty field, and reading it as 0 benches every healthy player.

Once `player_deadline_snapshot` exists, this directory stops growing — GW3 onward lives in the
database. These files stay as the record for GW2.
