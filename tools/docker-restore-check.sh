#!/usr/bin/env bash
# Sauvegarde puis restauration d'une installation compose avec les commandes du README, et contrôle
# que rien ne s'est perdu : comptes, arbres, personnes, migrations et fichiers des médias.
#
# Usage : bash tools/docker-restore-check.sh   (depuis le dossier du dépôt, installation démarrée)
# La CI le lance après le test de fumée, qui a déjà créé un compte et un arbre.
# Attention : la base et les médias sont effacés puis restaurés. Jamais sur une installation en service.
set -euo pipefail

cd "$(dirname "$0")/.."
DB_USER="${POSTGRES_USER:-parenthese}"
DB_NAME="${POSTGRES_DB:-parenthese}"
MEDIA_VOLUME="parenthese_media"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "ÉCHEC : $*" >&2; exit 1; }
sql() { docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -At -c "$1"; }
counts() { sql "SELECT (SELECT count(*) FROM users) || ' ' || (SELECT count(*) FROM trees) || ' ' || (SELECT count(*) FROM persons) || ' ' || (SELECT count(*) FROM _prisma_migrations)"; }

docker run --rm -v "$MEDIA_VOLUME":/data alpine sh -c 'echo "souvenir de test" > /data/restore-check.txt'
before="$(counts)"
read -r users trees _ _ <<< "$before"
[ "$users" -ge 1 ] && [ "$trees" -ge 1 ] || fail "il faut au moins un compte et un arbre avant la sauvegarde (lancer d'abord tools/docker-smoke.sh)"
echo "Avant : $before (comptes, arbres, personnes, migrations)"

# Sauvegarde, mêmes commandes que le README (fichiers écrits dans un dossier temporaire)
DUMP="$WORK/parenthese-db-$(date +%F).dump"
ARCHIVE="parenthese-media-$(date +%F).tar.gz"
docker compose exec -T db pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$DUMP"
docker run --rm -v "$MEDIA_VOLUME":/data -v "$WORK":/backup alpine tar -czf "/backup/$ARCHIVE" -C /data .
[ -s "$DUMP" ] || fail "dump vide"

# Perte simulée : base vidée, médias effacés
docker compose stop api
sql "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
docker run --rm -v "$MEDIA_VOLUME":/data alpine find /data -mindepth 1 -delete
[ "$(sql "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")" = 0 ] || fail "la base n'a pas été vidée"

# Restauration, mêmes commandes que le README
docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists < "$DUMP"
docker run --rm -v "$MEDIA_VOLUME":/data -v "$WORK":/backup alpine tar -xzf "/backup/$ARCHIVE" -C /data

after="$(counts)"
echo "Après : $after"
[ "$after" = "$before" ] || fail "la restauration ne rend pas les mêmes données ($before avant, $after après)"
[ "$(docker run --rm -v "$MEDIA_VOLUME":/data alpine cat /data/restore-check.txt)" = "souvenir de test" ] || fail "fichier des médias absent après restauration"
docker run --rm -v "$MEDIA_VOLUME":/data alpine rm -f /data/restore-check.txt

docker compose start api
echo "OK : sauvegarde et restauration du README vérifiées"
