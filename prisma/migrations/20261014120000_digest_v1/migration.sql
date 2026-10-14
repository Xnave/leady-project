-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "digestSector" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "DigestRecipient" ADD COLUMN "optInCode" TEXT,
ADD COLUMN "optInCodeAt" TIMESTAMP(3),
ADD COLUMN "conversationId" TEXT NOT NULL DEFAULT '',
ADD COLUMN "lastInboundAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "DigestRecipient_optInCode_key" ON "DigestRecipient"("optInCode");

-- Opt-in now proves phone ownership through WhatsApp; earlier self-declared
-- opt-ins are reset so every recipient re-confirms (the feature was never on).
UPDATE "DigestRecipient" SET "optedInAt" = NULL;
