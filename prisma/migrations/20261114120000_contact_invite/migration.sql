-- Documents auto-invite: one row per invited synced contact, apart from the CRM mirror on Contact.
CREATE TABLE "ContactInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stopReason" TEXT NOT NULL DEFAULT '',
    "claimedAt" TIMESTAMP(3),
    "openerAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "zernioConversationId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactInvite_contactId_key" ON "ContactInvite"("contactId");
CREATE INDEX "ContactInvite_tenantId_status_idx" ON "ContactInvite"("tenantId", "status");

ALTER TABLE "ContactInvite" ADD CONSTRAINT "ContactInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactInvite" ADD CONSTRAINT "ContactInvite_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
