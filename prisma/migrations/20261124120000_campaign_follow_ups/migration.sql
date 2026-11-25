-- Follow-up steps live on the campaign. One person still has one CampaignSend row.
-- No ContactInvite table: a campaign that follows a source is the opener.
-- SmartNpvClient was a draft migration staging already applied. This branch has no model for it.

DROP TABLE IF EXISTS "SmartNpvClient";
DROP TABLE IF EXISTS "SmartNpvSync";

ALTER TABLE "Campaign" ADD COLUMN "followUps" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "CampaignSend" ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "reminderClaimedAt" TIMESTAMP(3),
ADD COLUMN "reminderSentAt" TIMESTAMP(3),
ADD COLUMN "escalatedAt" TIMESTAMP(3),
-- Set once the opener has been copied onto the lead conversation, after Zernio accepted the send.
ADD COLUMN "threadRecordedAt" TIMESTAMP(3);
