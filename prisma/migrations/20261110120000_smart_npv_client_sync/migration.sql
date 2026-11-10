-- CreateTable
CREATE TABLE "SmartNpvSync" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cursorDate" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartNpvSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartNpvClient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "smartClientId" TEXT NOT NULL,
    "phone1" TEXT NOT NULL DEFAULT '',
    "phone2" TEXT NOT NULL DEFAULT '',
    "profile" JSONB NOT NULL DEFAULT '{}',
    "createdOn" TEXT NOT NULL DEFAULT '',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartNpvClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmartNpvSync_tenantId_key" ON "SmartNpvSync"("tenantId");

-- CreateIndex
CREATE INDEX "SmartNpvClient_tenantId_phone1_idx" ON "SmartNpvClient"("tenantId", "phone1");

-- CreateIndex
CREATE INDEX "SmartNpvClient_tenantId_phone2_idx" ON "SmartNpvClient"("tenantId", "phone2");

-- CreateIndex
CREATE UNIQUE INDEX "SmartNpvClient_tenantId_smartClientId_key" ON "SmartNpvClient"("tenantId", "smartClientId");

-- AddForeignKey
ALTER TABLE "SmartNpvSync" ADD CONSTRAINT "SmartNpvSync_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartNpvClient" ADD CONSTRAINT "SmartNpvClient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
