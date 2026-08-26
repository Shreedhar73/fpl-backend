# Deadline snapshots

`players` is a **snapshot table** — `status`, `chanceOfPlayingNextRound`, `epNext`, `epThis`, `form`,
`nowCost` and the set-piece orders are all scalars, upserted on every sync, with no history kept
anywhere and no public archive to backfill from. After a deadline they say what was true *after* the
matches, so a minutes model backtested against them is reading the answer.

B-007 Phase 2 builds `player_deadline_snapshot` to record this properly. It cannot land before the
GW2 deadline (**2026-08-28 17:30 UTC**), so the files here were a zero-code hedge for that one
gameweek: a `\copy` of `players` joined to `teams`, taken before the deadline and committed.

Run from the `fpl-backend` root. This is server-side `COPY … TO STDOUT` redirected by the shell, **not**
psql's `\copy`: `\copy` is a meta-command whose arguments end at the first newline, so it cannot be
written across lines like this and a pretty-printed version of it fails to parse.

```bash
URL=$(grep -h DATABASE_URL .env | sed 's/^[^=]*=//; s/^"//; s/"$//; s/?schema=public//')
TS=$(date -u +'%Y%m%dT%H%M%SZ')
psql "$URL" -c "COPY (
  select p.\"fplId\", p.\"webName\", p.position, t.\"fplId\" as team_fpl_id, t.\"shortName\" as team,
         p.\"nowCost\", p.status, p.\"chanceOfPlayingNextRound\", p.news, p.\"newsAddedAt\", p.removed,
         p.form, p.\"pointsPerGame\", p.\"epNext\", p.\"epThis\",
         p.\"expectedGoalsPer90\", p.\"expectedAssistsPer90\", p.\"expectedGoalsConcededPer90\",
         p.\"defensiveContributionPer90\", p.\"savesPer90\", p.\"startsPer90\",
         p.\"penaltiesOrder\", p.\"directFreekicksOrder\", p.\"cornersOrder\",
         p.\"seasonMinutes\", p.\"seasonStarts\", p.\"updatedAt\"
  from players p join teams t on t.id = p.\"teamId\"
  order by p.\"fplId\"
) TO STDOUT CSV HEADER" > "reports/snapshots/gw2-players-$TS.csv"
wc -l < "reports/snapshots/gw2-players-$TS.csv"   # expect 615 — 614 players plus the header
```

`COPY … TO STDOUT` needs no server file permissions and writes wherever the shell is pointed, so it
works against a local or a remote database alike.

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

`player_deadline_snapshot` now exists, and **GW2 was captured into it after all** (614 players, via
`pnpm sync:fpl -- --snapshot`), so this directory stops growing here. The CSV stays as the floor it was
taken to be, and as the only record of the state at 2026-08-26 15:45 UTC.
