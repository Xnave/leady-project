-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "agentRepliesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN "agentRepliesEnabled" BOOLEAN NOT NULL DEFAULT true;
