-- Cadrage du portrait (feat/recadrage-portrait). Migration additive : colonne nullable, sans défaut.
-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "avatarCrop" JSONB;
