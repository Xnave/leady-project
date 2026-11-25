-- Phones an owner adds to the campaign test list from the composer.
CREATE TABLE "CampaignAllowPhone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignAllowPhone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignAllowPhone_tenantId_phone_key" ON "CampaignAllowPhone"("tenantId", "phone");
CREATE INDEX "CampaignAllowPhone_tenantId_idx" ON "CampaignAllowPhone"("tenantId");

ALTER TABLE "CampaignAllowPhone" ADD CONSTRAINT "CampaignAllowPhone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
