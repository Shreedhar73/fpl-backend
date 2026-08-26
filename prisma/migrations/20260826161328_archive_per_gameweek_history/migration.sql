-- CreateTable
CREATE TABLE "archive_player_gameweek" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "fixture" INTEGER NOT NULL,
    "playerCode" INTEGER NOT NULL,
    "playerId" TEXT,
    "webName" TEXT NOT NULL,
    "position" "Position" NOT NULL,
    "teamCode" INTEGER,
    "opponentTeamCode" INTEGER,
    "wasHome" BOOLEAN NOT NULL,
    "kickoffTime" TIMESTAMP(3),
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
    "defensiveContribution" INTEGER,
    "clearancesBlocksInterceptions" INTEGER,
    "tackles" INTEGER,
    "recoveries" INTEGER,
    "expectedGoals" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "expectedAssists" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "expectedGoalsConceded" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "ictIndex" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "value" INTEGER NOT NULL DEFAULT 0,
    "selectedBy" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_player_gameweek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_season_scoring" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "scoring" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archive_season_scoring_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "archive_player_gameweek_season_round_idx" ON "archive_player_gameweek"("season", "round");

-- CreateIndex
CREATE INDEX "archive_player_gameweek_playerCode_idx" ON "archive_player_gameweek"("playerCode");

-- CreateIndex
CREATE UNIQUE INDEX "archive_player_gameweek_season_playerCode_round_fixture_key" ON "archive_player_gameweek"("season", "playerCode", "round", "fixture");

-- CreateIndex
CREATE UNIQUE INDEX "archive_season_scoring_season_key" ON "archive_season_scoring"("season");

-- AddForeignKey
ALTER TABLE "archive_player_gameweek" ADD CONSTRAINT "archive_player_gameweek_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
