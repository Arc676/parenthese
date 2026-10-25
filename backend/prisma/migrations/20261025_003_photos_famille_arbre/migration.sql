-- Photos posées sur l'arbre par la famille, en attente de relecture (1.5.1). Migration additive, une table neuve.
-- CreateTable
CREATE TABLE "annotation_photo_uploads" (
    "id" TEXT NOT NULL,
    "treeId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotation_photo_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "annotation_photo_uploads_treeId_createdAt_idx" ON "annotation_photo_uploads"("treeId", "createdAt");

-- AddForeignKey
ALTER TABLE "annotation_photo_uploads" ADD CONSTRAINT "annotation_photo_uploads_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
