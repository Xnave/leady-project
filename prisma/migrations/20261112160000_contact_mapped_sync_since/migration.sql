-- Contact stores one mapped payload and an optional raw row.
ALTER TABLE "Contact" RENAME COLUMN "fields" TO "mapped";
ALTER TABLE "Contact" ADD COLUMN "raw" JSONB NOT NULL DEFAULT '{}';

-- Lower bound for contact sync. Connectors use the precision they can.
ALTER TABLE "ClientSource" ADD COLUMN "syncSince" TIMESTAMP(3);

-- Smart NPV clients now live on Contact. These tables exist only on the documents branch.
DROP TABLE IF EXISTS "SmartNpvClient";
DROP TABLE IF EXISTS "SmartNpvSync";
