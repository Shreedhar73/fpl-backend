-- CreateTable
CREATE TABLE "gameweek_live_snapshot" (
    "gameweekId" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "elements" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gameweek_live_snapshot_pkey" PRIMARY KEY ("gameweekId")
);

-- AddForeignKey
ALTER TABLE "gameweek_live_snapshot" ADD CONSTRAINT "gameweek_live_snapshot_gameweekId_fkey" FOREIGN KEY ("gameweekId") REFERENCES "gameweeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
