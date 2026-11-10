-- Document checklist for the documents capability.
CREATE TABLE "Dossier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL DEFAULT '',
    "smartClientId" TEXT NOT NULL DEFAULT '',
    "profile" JSONB NOT NULL DEFAULT '{}',
    "slots" JSONB NOT NULL DEFAULT '[]',
    "activeStage" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'gathering',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dossier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL DEFAULT '',
    "docType" TEXT NOT NULL DEFAULT '',
    "filename" TEXT NOT NULL DEFAULT '',
    "mime" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'stored',
    "validation" JSONB NOT NULL DEFAULT '{}',
    "remoteId" TEXT NOT NULL DEFAULT '',
    "bytesEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dossier_tenantId_leadId_idx" ON "Dossier"("tenantId", "leadId");
CREATE INDEX "Dossier_tenantId_status_idx" ON "Dossier"("tenantId", "status");
CREATE INDEX "LeadDocument_tenantId_dossierId_idx" ON "LeadDocument"("tenantId", "dossierId");
CREATE INDEX "LeadDocument_tenantId_leadId_idx" ON "LeadDocument"("tenantId", "leadId");
CREATE INDEX "LeadDocument_tenantId_messageId_idx" ON "LeadDocument"("tenantId", "messageId");

ALTER TABLE "Dossier" ADD CONSTRAINT "Dossier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dossier" ADD CONSTRAINT "Dossier_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
