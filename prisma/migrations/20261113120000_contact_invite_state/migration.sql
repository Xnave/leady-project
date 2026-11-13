-- Documents auto-invite state per synced contact.
ALTER TABLE "Contact" ADD COLUMN "inviteStatus" TEXT NOT NULL DEFAULT '',
ADD COLUMN "inviteStopReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN "inviteClaimedAt" TIMESTAMP(3),
ADD COLUMN "inviteOpenerAt" TIMESTAMP(3),
ADD COLUMN "inviteReminderAt" TIMESTAMP(3),
ADD COLUMN "inviteEscalatedAt" TIMESTAMP(3),
ADD COLUMN "inviteStartedAt" TIMESTAMP(3),
ADD COLUMN "inviteConversationId" TEXT NOT NULL DEFAULT '';

CREATE INDEX "Contact_tenantId_inviteStatus_idx" ON "Contact"("tenantId", "inviteStatus");
