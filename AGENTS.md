# fpl-backend

NestJS API for the FPL AI manager. **Owns everything that is not UI**: the sync from the official
Fantasy Premier League API, the Postgres database, the expected-points model, and the squad
optimizer. Runs on **:5001**. The Next.js frontend in `../fpl-frontend` (:4000) is a typed shell
over it and talks to nothing else.

Postgres 16 + Prisma 7. `pnpm start:dev` serves on :5001; health is at `/health`, everything else is
under `/api`.

## Non-obvious constraints

Things a fresh read of the code will not tell you, and that are expensive to get wrong:

- **This is the only repo that calls the FPL API, and the only one that talks to Postgres.** Data
  flows one way: upstream → sync job → Postgres → HTTP → frontend. An upstream call on a request
  path turns their outage into ours.
- **Money is an integer in tenths, everywhere.** `55` is £5.5m — in the schema, the service, the DTO
  and on the wire. A float pound value anywhere is a bug.
- **Selling is not at market price.** Purchase price plus half the rise, rounded down to £0.1m. Using
  market price silently invents budget and proposes squads the user cannot buy.
- **Never hardcode a scoring value or a squad constraint.** `bootstrap-static.game_config` serves
  them live; they are synced into `scoring_config` and the engine reads from there. FPL changed
  goalkeeper goal scoring and added a whole scoring category within two seasons.
- **`chance_of_playing_next_round: null` means fully fit**, not unknown. Treating it as 0 benches
  every healthy player.
- **`finished` is not final.** Bonus and stat corrections land after it flips; only `data_checked`
  means the numbers stopped moving. Backtesting on `finished` rows leaks data that did not exist at
  decision time — the bug that makes a broken model look excellent.
- **`player_price_history` and `player_ownership_history` exist only here.** Upstream serves no
  history. `prisma migrate reset` destroys them permanently; the `pre-bash-guard` hook denies it
  against a non-local `DATABASE_URL`.
- **Prisma 7 keeps the connection URL in `prisma.config.ts`, not in `schema.prisma`**, and the client
  takes a `PrismaPg` driver adapter. The generated client lands in `src/generated/prisma` and is
  gitignored — run `pnpm prisma:generate` after a clone.
- **`PrismaService` is the only construction of a client.** It belongs in `*.repository.ts` files;
  a controller or service that imports it has collapsed the layering.
- **Every response leaves through the envelope interceptor.** Controllers return plain data. Errors
  leave through the exception filter in the same shape. `/health` is deliberately outside both —
  `scripts/dev.sh` and `doctor.sh` poll it and must not depend on the app's conventions.
- **Every sync is idempotent.** Re-running one must produce the same rows. A sync that double-writes
  on retry poisons the backtest silently.
- **A schema change the frontend can see is a contract change** — regenerate the frontend types in
  the same commit.

## Layering

`controller → service → repository → Prisma`. No layer skipped. Modules live in `src/modules/<domain>/`,
cross-cutting code in `src/common/`, infrastructure in `src/infra/`. A module never imports another
module's repository or `dto/` internals.

## Where the depth lives

Fourteen skills carry this project's real knowledge, symlinked into `.claude/skills/` from
`../fpl-orchestrator/skills/`. Each states its own triggers; load the matching one **before** acting
rather than reasoning from this file. Do not restate skill content here — when reality and a skill
disagree, fix the skill.

The ones that bite most often here: `fpl-architecture-contract`, `fpl-data-model`, `fpl-domain-rules`,
`fpl-api-reference`, `fpl-optimizer`.

If `.claude/skills/` is empty or full of dangling links, run
`bash ../fpl-orchestrator/scripts/link-skills.sh` — symlinks are machine-local and not committed.

`/new-feature` is mandatory before writing code for anything touching more than one file.

## Change flow

Plan file in `../fpl-orchestrator/docs/plans/` → branch → implement → `pnpm typecheck && pnpm lint &&
pnpm test` → verify the real thing (curl the endpoint and read the body) → conventional commit. Never
add AI/Claude `Co-Authored-By` trailers. Full loop and evidence bar:
`../fpl-orchestrator/orchestration/workflow.md`.

## Docs of record

**`AGENTS.md` is the real file; `CLAUDE.md` is a symlink to it.** Same inode, so they cannot drift.
Edit `AGENTS.md`.
