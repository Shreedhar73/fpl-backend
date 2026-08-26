-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "strengthAttackAway" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "strengthAttackHome" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "strengthDefenceAway" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "strengthDefenceHome" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "strengthOverallAway" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "strengthOverallHome" INTEGER NOT NULL DEFAULT 0;
