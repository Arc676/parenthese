-- Co-gestion d'un arbre (issue #145) : invitations du propriétaire. Migration additive, une table neuve.
-- CreateTable
CREATE TABLE "tree_invitations" (
    "id" TEXT NOT NULL,
    "treeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "tree_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tree_invitations_tokenHash_key" ON "tree_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "tree_invitations_treeId_idx" ON "tree_invitations"("treeId");

-- CreateIndex
CREATE INDEX "tree_invitations_email_idx" ON "tree_invitations"("email");

-- AddForeignKey
ALTER TABLE "tree_invitations" ADD CONSTRAINT "tree_invitations_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_invitations" ADD CONSTRAINT "tree_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

