-- AlterTable
ALTER TABLE "archive_player_gameweek" ALTER COLUMN "starts" DROP NOT NULL,
ALTER COLUMN "starts" DROP DEFAULT,
ALTER COLUMN "expectedGoals" DROP NOT NULL,
ALTER COLUMN "expectedGoals" DROP DEFAULT,
ALTER COLUMN "expectedAssists" DROP NOT NULL,
ALTER COLUMN "expectedAssists" DROP DEFAULT,
ALTER COLUMN "expectedGoalsConceded" DROP NOT NULL,
ALTER COLUMN "expectedGoalsConceded" DROP DEFAULT;
