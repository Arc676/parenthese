-- Personne décédée sans date connue (issue #77)
ALTER TABLE "persons" ADD COLUMN "isDeceased" BOOLEAN NOT NULL DEFAULT false;
