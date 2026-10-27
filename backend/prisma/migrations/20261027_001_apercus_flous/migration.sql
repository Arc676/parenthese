-- Aperçus flous (BlurHash) des portraits et des photos, montrés pendant le chargement.
-- Migration additive : deux colonnes facultatives, remplies ensuite par l'API (lib/blurhash.ts).
-- AlterTable
ALTER TABLE "persons" ADD COLUMN "avatarBlurhash" TEXT;

-- AlterTable
ALTER TABLE "media_items" ADD COLUMN "blurhash" TEXT;
