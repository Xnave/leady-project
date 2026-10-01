-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digestHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "attentionAt" TIMESTAMP(3),
ADD COLUMN     "attentionReason" TEXT,
ADD COLUMN     "lastLeadMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "nextStepAt" TIMESTAMP(3),
ADD COLUMN     "nextStepText" TEXT,
ADD COLUMN     "pipelineStage" TEXT NOT NULL DEFAULT 'new',
ADD COLUMN     "pipelineStageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "pipelineStageReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pipelineStageSource" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "snoozedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeadStageEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorLabel" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL,
    "optedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "itemCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DigestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadStageEvent_tenantId_leadId_createdAt_idx" ON "LeadStageEvent"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadStageEvent_tenantId_to_createdAt_idx" ON "LeadStageEvent"("tenantId", "to", "createdAt");

-- CreateIndex
CREATE INDEX "LeadNote_tenantId_leadId_idx" ON "LeadNote"("tenantId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestRecipient_tenantId_clerkUserId_key" ON "DigestRecipient"("tenantId", "clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestLog_tenantId_date_key" ON "DigestLog"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Lead_tenantId_attentionReason_attentionAt_idx" ON "Lead"("tenantId", "attentionReason", "attentionAt");

-- CreateIndex
CREATE INDEX "Lead_tenantId_pipelineStage_updatedAt_idx" ON "Lead"("tenantId", "pipelineStage", "updatedAt");

-- AddForeignKey
ALTER TABLE "LeadStageEvent" ADD CONSTRAINT "LeadStageEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStageEvent" ADD CONSTRAINT "LeadStageEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestRecipient" ADD CONSTRAINT "DigestRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestLog" ADD CONSTRAINT "DigestLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

