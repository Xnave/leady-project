-- Contact stores one mapped payload and an optional raw row.
ALTER TABLE "Contact" RENAME COLUMN "fields" TO "mapped";
ALTER TABLE "Contact" ADD COLUMN "raw" JSONB NOT NULL DEFAULT '{}';

-- Lower bound for contact sync. Connectors use the precision they can.
ALTER TABLE "ClientSource" ADD COLUMN "syncSince" TIMESTAMP(3);

-- Smart NPV clients now live on Contact. An earlier draft migration of this
-- branch (20261110120000_smart_npv_client_sync, since removed) created these
-- tables on some dev/staging databases; drop them there, no-op elsewhere.
DROP TABLE IF EXISTS "SmartNpvClient";
DROP TABLE IF EXISTS "SmartNpvSync";
