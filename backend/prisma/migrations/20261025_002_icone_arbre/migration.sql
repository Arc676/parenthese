-- Icône d'un arbre (un emoji), facultative. Migration additive : colonne vide par défaut.
ALTER TABLE "trees" ADD COLUMN "icon" TEXT;
