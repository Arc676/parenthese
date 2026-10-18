-- Prénom du compte, facultatif (comptes existants : vide). Migration additive.
ALTER TABLE "users" ADD COLUMN "firstName" TEXT;
