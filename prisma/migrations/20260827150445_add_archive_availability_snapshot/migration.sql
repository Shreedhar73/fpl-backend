-- CreateTable
CREATE TABLE "archive_availability_snapshot" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "playerCode" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "chanceOfPlayingNextRound" INTEGER,
    "news" TEXT,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "gapHours" DECIMAL(7,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_availability_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "archive_availability_snapshot_season_round_idx" ON "archive_availability_snapshot"("season", "round");

-- CreateIndex
CREATE UNIQUE INDEX "archive_availability_snapshot_season_round_playerCode_key" ON "archive_availability_snapshot"("season", "round", "playerCode");
