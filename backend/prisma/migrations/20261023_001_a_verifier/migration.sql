-- « À vérifier » sur une personne (feat/a-verifier). Migration additive : booléen à faux par défaut.
-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "toVerify" BOOLEAN NOT NULL DEFAULT false;
