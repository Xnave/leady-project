-- One opted-in business per phone: the platform number knows the owner only
-- by the sender phone, so two opted-in rows would make replies pick a tenant
-- arbitrarily. Unconfirmed rows keep phone '' and are excluded.
CREATE UNIQUE INDEX "DigestRecipient_phone_opted_in_key" ON "DigestRecipient"("phone") WHERE "optedInAt" IS NOT NULL AND "phone" <> '';
