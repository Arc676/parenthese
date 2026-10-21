-- Personnes identifiées sur un souvenir (feat/souvenirs-personnes). Migration additive : nouvelle table, nouvelle valeur d'énumération.
-- AlterEnum
ALTER TYPE "ContributionEntityType" ADD VALUE 'media_people';

-- CreateTable
CREATE TABLE "media_person_tags" (
    "id" TEXT NOT NULL,
    "treeId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_person_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_person_tags_treeId_idx" ON "media_person_tags"("treeId");

-- CreateIndex
CREATE INDEX "media_person_tags_treeId_personId_idx" ON "media_person_tags"("treeId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "media_person_tags_mediaId_personId_key" ON "media_person_tags"("mediaId", "personId");

-- AddForeignKey
ALTER TABLE "media_person_tags" ADD CONSTRAINT "media_person_tags_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

