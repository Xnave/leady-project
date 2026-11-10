-- CreateTable
CREATE TABLE "TenantCampaignSettings" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "adPrefixEnabled" BOOLEAN NOT NULL DEFAULT true,
    "adPrefixOffNote" TEXT NOT NULL DEFAULT '',
    "adPrefixOffBy" TEXT NOT NULL DEFAULT '',
    "adPrefixOffAt" TIMESTAMP(3),
    "dailySendCeiling" INTEGER NOT NULL DEFAULT 200,
    "termsVersion" TEXT NOT NULL DEFAULT '',
    "termsAcceptedAt" TIMESTAMP(3),
    "termsAcceptedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantCampaignSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "examples" JSONB NOT NULL DEFAULT '[]',
    "text" TEXT NOT NULL,
    "footer" TEXT NOT NULL DEFAULT '',
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_tenantId_name_language_key" ON "WhatsAppTemplate"("tenantId", "name", "language");

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_tenantId_status_idx" ON "WhatsAppTemplate"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_accountId_name_language_idx" ON "WhatsAppTemplate"("accountId", "name", "language");

-- AddForeignKey
ALTER TABLE "TenantCampaignSettings" ADD CONSTRAINT "TenantCampaignSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
