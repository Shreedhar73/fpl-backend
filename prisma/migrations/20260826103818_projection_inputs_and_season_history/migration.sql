-- AlterTable
ALTER TABLE "players" ADD COLUMN     "cornersOrder" INTEGER,
ADD COLUMN     "defensiveContributionPer90" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "directFreekicksOrder" INTEGER,
ADD COLUMN     "epNext" DECIMAL(6,2),
ADD COLUMN     "epThis" DECIMAL(6,2),
ADD COLUMN     "expectedAssistsPer90" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "expectedGoalsConcededPer90" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "expectedGoalsPer90" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "form" DECIMAL(6,2),
ADD COLUMN     "penaltiesOrder" INTEGER,
ADD COLUMN     "pointsPerGame" DECIMAL(6,2),
ADD COLUMN     "savesPer90" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "seasonMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seasonStarts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startsPer90" DECIMAL(5,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "player_season_history" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "goalsScored" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "cleanSheets" INTEGER NOT NULL DEFAULT 0,
    "goalsConceded" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "bps" INTEGER NOT NULL DEFAULT 0,
    "defensiveContribution" INTEGER NOT NULL DEFAULT 0,
    "expectedGoals" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "expectedAssists" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "expectedGoalsConceded" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "startCost" INTEGER NOT NULL,
    "endCost" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_season_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_season_history_playerId_idx" ON "player_season_history"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "player_season_history_playerId_season_key" ON "player_season_history"("playerId", "season");

-- AddForeignKey
ALTER TABLE "player_season_history" ADD CONSTRAINT "player_season_history_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
