-- Moments proposés par la famille (relus par l'administrateur) et plusieurs souvenirs par moment
ALTER TABLE "life_events" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "life_events" ADD COLUMN "contributionSessionId" TEXT;
ALTER TABLE "media_items" ADD COLUMN "lifeEventId" TEXT;
CREATE INDEX "media_items_lifeEventId_idx" ON "media_items"("lifeEventId");

-- Les photos déjà rattachées par life_events.mediaId passent sur le souvenir
UPDATE "media_items" AS m SET "lifeEventId" = e."id"
FROM "life_events" AS e
WHERE e."mediaId" = m."id" AND e."deletedAt" IS NULL;
