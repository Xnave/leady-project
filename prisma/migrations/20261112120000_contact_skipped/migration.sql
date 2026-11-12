-- Stored client that now matches a skip rule: still synced, left out of audiences.
ALTER TABLE "Contact" ADD COLUMN "skipped" BOOLEAN NOT NULL DEFAULT false;
