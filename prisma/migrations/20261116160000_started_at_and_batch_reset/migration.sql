-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "resetBatch" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Contact" RENAME COLUMN "dealDate" TO "startedAt";
ALTER TABLE "Contact" RENAME COLUMN "dealDateSource" TO "startedAtSource";
ALTER TABLE "Contact" RENAME COLUMN "dealDateConfidence" TO "startedAtConfidence";

-- RenameIndex
ALTER INDEX "Contact_tenantId_dealDate_idx" RENAME TO "Contact_tenantId_startedAt_idx";
