-- CreateEnum
CREATE TYPE "Position" AS ENUM ('GKP', 'DEF', 'MID', 'FWD');

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "fplId" INTEGER NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "strength" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "fplId" INTEGER NOT NULL,
    "code" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "secondName" TEXT NOT NULL,
    "webName" TEXT NOT NULL,
    "position" "Position" NOT NULL,
    "teamId" TEXT NOT NULL,
    "nowCost" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "chanceOfPlayingNextRound" INTEGER,
    "news" TEXT,
    "newsAddedAt" TIMESTAMP(3),
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gameweeks" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "deadlineTime" TIMESTAMPTZ(3) NOT NULL,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "dataChecked" BOOLEAN NOT NULL DEFAULT false,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "isNext" BOOLEAN NOT NULL DEFAULT false,
    "averageScore" INTEGER,
    "highestScore" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gameweeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixtures" (
    "id" TEXT NOT NULL,
    "fplId" INTEGER NOT NULL,
    "gameweekId" INTEGER,
    "kickoffTime" TIMESTAMPTZ(3),
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "homeDifficulty" INTEGER NOT NULL,
    "awayDifficulty" INTEGER NOT NULL,
    "started" BOOLEAN NOT NULL DEFAULT false,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixtures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_gameweek_stats" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameweekId" INTEGER NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "wasHome" BOOLEAN NOT NULL,
    "opponentTeamFplId" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "goalsScored" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "cleanSheets" INTEGER NOT NULL DEFAULT 0,
    "goalsConceded" INTEGER NOT NULL DEFAULT 0,
    "ownGoals" INTEGER NOT NULL DEFAULT 0,
    "penaltiesSaved" INTEGER NOT NULL DEFAULT 0,
    "penaltiesMissed" INTEGER NOT NULL DEFAULT 0,
    "yellowCards" INTEGER NOT NULL DEFAULT 0,
    "redCards" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "bps" INTEGER NOT NULL DEFAULT 0,
    "defensiveContribution" INTEGER NOT NULL DEFAULT 0,
    "expectedGoals" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "expectedAssists" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "expectedGoalsConceded" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "ictIndex" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "value" INTEGER NOT NULL,
    "selectedBy" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_gameweek_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_price_history" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "player_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_ownership_history" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "selectedByPercent" DECIMAL(5,2) NOT NULL,
    "transfersInEvent" INTEGER NOT NULL DEFAULT 0,
    "transfersOutEvent" INTEGER NOT NULL DEFAULT 0,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "player_ownership_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projections" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameweekId" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "expectedPoints" DECIMAL(6,2) NOT NULL,
    "expectedMinutes" DECIMAL(6,2) NOT NULL,
    "playProbability" DECIMAL(4,3) NOT NULL,
    "components" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "squads" (
    "id" TEXT NOT NULL,
    "managerId" INTEGER NOT NULL,
    "gameweekId" INTEGER NOT NULL,
    "bank" INTEGER NOT NULL,
    "teamValue" INTEGER NOT NULL,
    "activeChip" TEXT,
    "isPlanned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "squads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "squad_picks" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "multiplier" INTEGER NOT NULL DEFAULT 1,
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "isViceCaptain" BOOLEAN NOT NULL DEFAULT false,
    "sellValue" INTEGER NOT NULL,

    CONSTRAINT "squad_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optimizer_runs" (
    "id" TEXT NOT NULL,
    "gameweekId" INTEGER NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "horizon" INTEGER NOT NULL,
    "freeTransfers" INTEGER NOT NULL,
    "hitsTaken" INTEGER NOT NULL,
    "objectiveValue" DECIMAL(8,2) NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "reasoning" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optimizer_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "payloadHash" TEXT,
    "error" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_config" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "scoring" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_fplId_key" ON "teams"("fplId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_code_key" ON "teams"("code");

-- CreateIndex
CREATE UNIQUE INDEX "players_fplId_key" ON "players"("fplId");

-- CreateIndex
CREATE UNIQUE INDEX "players_code_key" ON "players"("code");

-- CreateIndex
CREATE INDEX "players_teamId_idx" ON "players"("teamId");

-- CreateIndex
CREATE INDEX "players_position_idx" ON "players"("position");

-- CreateIndex
CREATE INDEX "players_status_idx" ON "players"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fixtures_fplId_key" ON "fixtures"("fplId");

-- CreateIndex
CREATE INDEX "fixtures_gameweekId_idx" ON "fixtures"("gameweekId");

-- CreateIndex
CREATE INDEX "fixtures_homeTeamId_gameweekId_idx" ON "fixtures"("homeTeamId", "gameweekId");

-- CreateIndex
CREATE INDEX "fixtures_awayTeamId_gameweekId_idx" ON "fixtures"("awayTeamId", "gameweekId");

-- CreateIndex
CREATE INDEX "player_gameweek_stats_playerId_gameweekId_idx" ON "player_gameweek_stats"("playerId", "gameweekId");

-- CreateIndex
CREATE INDEX "player_gameweek_stats_gameweekId_idx" ON "player_gameweek_stats"("gameweekId");

-- CreateIndex
CREATE UNIQUE INDEX "player_gameweek_stats_playerId_gameweekId_fixtureId_key" ON "player_gameweek_stats"("playerId", "gameweekId", "fixtureId");

-- CreateIndex
CREATE INDEX "player_price_history_playerId_recordedAt_idx" ON "player_price_history"("playerId", "recordedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "player_price_history_playerId_recordedAt_key" ON "player_price_history"("playerId", "recordedAt");

-- CreateIndex
CREATE INDEX "player_ownership_history_playerId_recordedAt_idx" ON "player_ownership_history"("playerId", "recordedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "player_ownership_history_playerId_recordedAt_key" ON "player_ownership_history"("playerId", "recordedAt");

-- CreateIndex
CREATE INDEX "projections_gameweekId_modelVersion_expectedPoints_idx" ON "projections"("gameweekId", "modelVersion", "expectedPoints" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "projections_playerId_gameweekId_modelVersion_key" ON "projections"("playerId", "gameweekId", "modelVersion");

-- CreateIndex
CREATE UNIQUE INDEX "squads_managerId_gameweekId_isPlanned_key" ON "squads"("managerId", "gameweekId", "isPlanned");

-- CreateIndex
CREATE INDEX "squad_picks_playerId_idx" ON "squad_picks"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "squad_picks_squadId_position_key" ON "squad_picks"("squadId", "position");

-- CreateIndex
CREATE INDEX "optimizer_runs_gameweekId_createdAt_idx" ON "optimizer_runs"("gameweekId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "sync_runs_endpoint_startedAt_idx" ON "sync_runs"("endpoint", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scoring_config_season_key" ON "scoring_config"("season");

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_gameweekId_fkey" FOREIGN KEY ("gameweekId") REFERENCES "gameweeks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_gameweek_stats" ADD CONSTRAINT "player_gameweek_stats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_gameweek_stats" ADD CONSTRAINT "player_gameweek_stats_gameweekId_fkey" FOREIGN KEY ("gameweekId") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_gameweek_stats" ADD CONSTRAINT "player_gameweek_stats_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "fixtures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_price_history" ADD CONSTRAINT "player_price_history_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_ownership_history" ADD CONSTRAINT "player_ownership_history_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projections" ADD CONSTRAINT "projections_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projections" ADD CONSTRAINT "projections_gameweekId_fkey" FOREIGN KEY ("gameweekId") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squads" ADD CONSTRAINT "squads_gameweekId_fkey" FOREIGN KEY ("gameweekId") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_picks" ADD CONSTRAINT "squad_picks_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "squad_picks" ADD CONSTRAINT "squad_picks_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
