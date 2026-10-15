-- CreateTable
CREATE TABLE "RapidDemo" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "tenantId" TEXT,
    "websiteHost" TEXT NOT NULL DEFAULT '',
    "ipHash" TEXT NOT NULL DEFAULT '',
    "browserId" TEXT NOT NULL DEFAULT '',
    "knowledgeMd" TEXT NOT NULL DEFAULT '',
    "extract" JSONB NOT NULL DEFAULT '{}',
    "expiresAt" TIMESTAMP(3),
    "boundPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RapidDemo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RapidDemo_code_key" ON "RapidDemo"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RapidDemo_tenantId_key" ON "RapidDemo"("tenantId");

-- CreateIndex
CREATE INDEX "RapidDemo_status_expiresAt_idx" ON "RapidDemo"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RapidDemo_ipHash_createdAt_idx" ON "RapidDemo"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "RapidDemo_browserId_createdAt_idx" ON "RapidDemo"("browserId", "createdAt");

-- CreateIndex
CREATE INDEX "RapidDemo_websiteHost_status_idx" ON "RapidDemo"("websiteHost", "status");

-- CreateIndex
CREATE INDEX "RapidDemo_boundPhone_status_idx" ON "RapidDemo"("boundPhone", "status");

-- One live demo per IP and per browser. Empty identity columns are excluded.
CREATE UNIQUE INDEX "RapidDemo_one_active_ip" ON "RapidDemo"("ipHash") WHERE "status" = 'active' AND "ipHash" <> '';

CREATE UNIQUE INDEX "RapidDemo_one_active_browser" ON "RapidDemo"("browserId") WHERE "status" = 'active' AND "browserId" <> '';

-- AddForeignKey
ALTER TABLE "RapidDemo" ADD CONSTRAINT "RapidDemo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
