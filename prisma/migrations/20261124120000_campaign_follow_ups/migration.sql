-- Follow-up steps live on the campaign. One person still has one CampaignSend row.
-- No ContactInvite table: a campaign that follows a source is the opener.

ALTER TABLE "Campaign" ADD COLUMN "followUps" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "CampaignSend" ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "reminderClaimedAt" TIMESTAMP(3),
ADD COLUMN "reminderSentAt" TIMESTAMP(3),
ADD COLUMN "escalatedAt" TIMESTAMP(3);
