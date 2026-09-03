-- CreateTable
CREATE TABLE "archive_deadline_market" (
    "id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "playerCode" INTEGER NOT NULL,
    "epNext" DECIMAL(6,2),
    "epThis" DECIMAL(6,2),
    "form" DECIMAL(6,2),
    "nowCost" INTEGER NOT NULL,
    "selectedBy" DECIMAL(5,2) NOT NULL,
    "epNextEvent" INTEGER,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "gapHours" DECIMAL(7,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_deadline_market_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "archive_deadline_market_season_round_idx" ON "archive_deadline_market"("season", "round");

-- CreateIndex
CREATE UNIQUE INDEX "archive_deadline_market_season_round_playerCode_key" ON "archive_deadline_market"("season", "round", "playerCode");
