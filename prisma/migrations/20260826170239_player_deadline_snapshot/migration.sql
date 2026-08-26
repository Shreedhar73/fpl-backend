-- CreateTable
CREATE TABLE "player_deadline_snapshot" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameweekId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "chanceOfPlayingNextRound" INTEGER,
    "news" TEXT,
    "newsAddedAt" TIMESTAMP(3),
    "epNext" DECIMAL(6,2),
    "epThis" DECIMAL(6,2),
    "form" DECIMAL(6,2),
    "nowCost" INTEGER NOT NULL,
    "penaltiesOrder" INTEGER,
    "directFreekicksOrder" INTEGER,
    "cornersOrder" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hoursToDeadline" DECIMAL(6,2) NOT NULL,

    CONSTRAINT "player_deadline_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_deadline_snapshot_gameweekId_idx" ON "player_deadline_snapshot"("gameweekId");

-- CreateIndex
CREATE UNIQUE INDEX "player_deadline_snapshot_playerId_gameweekId_key" ON "player_deadline_snapshot"("playerId", "gameweekId");

-- AddForeignKey
ALTER TABLE "player_deadline_snapshot" ADD CONSTRAINT "player_deadline_snapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_deadline_snapshot" ADD CONSTRAINT "player_deadline_snapshot_gameweekId_fkey" FOREIGN KEY ("gameweekId") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
