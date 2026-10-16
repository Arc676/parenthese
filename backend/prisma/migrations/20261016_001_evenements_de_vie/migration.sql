-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "birthDateEnd" TIMESTAMP(3),
ADD COLUMN     "birthDatePrecision" TEXT,
ADD COLUMN     "deathDateEnd" TIMESTAMP(3),
ADD COLUMN     "deathDatePrecision" TEXT,
ADD COLUMN     "deathPlace" TEXT,
ADD COLUMN     "nickname" TEXT;

-- AlterTable
ALTER TABLE "unions" ADD COLUMN     "startDatePrecision" TEXT,
ADD COLUMN     "startPlace" TEXT;

-- CreateTable
CREATE TABLE "life_events" (
    "id" TEXT NOT NULL,
    "treeId" TEXT NOT NULL,
    "personId" TEXT,
    "unionId" TEXT,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "date" TIMESTAMP(3),
    "dateEnd" TIMESTAMP(3),
    "datePrecision" TEXT,
    "dateText" TEXT,
    "place" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "sources" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "life_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "life_events_treeId_idx" ON "life_events"("treeId");

-- CreateIndex
CREATE INDEX "life_events_treeId_personId_idx" ON "life_events"("treeId", "personId");

-- CreateIndex
CREATE INDEX "life_events_treeId_unionId_idx" ON "life_events"("treeId", "unionId");

-- AddForeignKey
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
