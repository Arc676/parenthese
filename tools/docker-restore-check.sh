#!/usr/bin/env bash
# Sauvegarde puis restauration d'une installation compose avec les commandes du README, et contrôle
# que rien ne s'est perdu : comptes, arbres, personnes, migrations et fichiers des médias.
#
# Usage : bash tools/docker-restore-check.sh [http://localhost:8080]   (depuis le dossier du dépôt, installation démarrée)
# Nécessite curl et jq. La CI le lance après le test de fumée.
# Attention : la base et les médias sont effacés puis restaurés. Jamais sur une installation en service.
set -euo pipefail

cd "$(dirname "$0")/.."
BASE_URL="${1:-http://localhost}"
BASE_URL="${BASE_URL%/}"
DB_USER="${POSTGRES_USER:-parenthese}"
DB_NAME="${POSTGRES_DB:-parenthese}"
MEDIA_VOLUME="parenthese_media"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { echo "ÉCHEC : $*" >&2; exit 1; }
sql() { docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -At -c "$1"; }
counts() { sql "SELECT (SELECT count(*) FROM users) || ' ' || (SELECT count(*) FROM trees) || ' ' || (SELECT count(*) FROM persons) || ' ' || (SELECT count(*) FROM _prisma_migrations)"; }

# Données à retrouver : un compte, un arbre et une personne créés par l'API, un fichier dans les médias
api() {
  local method="$1" path="$2" body="$3" token="${4:-}"
  curl -fsS --max-time 30 -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json' \
    ${token:+-H "Authorization: Bearer $token"} --data "$body"
}
stamp="$(date +%s)-$RANDOM"
token="$(api POST /auth/register "$(jq -nc --arg e "restore-$stamp@example.com" '{firstName: "Test", email: $e, password: "restauration-test-1"}')" | jq -r .token)"
tree_id="$(api POST /trees "$(jq -nc --arg s "restore-$stamp" '{name: "Arbre de restauration", slug: $s, visitorPassword: "visiteur-test-1", contributorPassword: "contributeur-test-1"}')" "$token" | jq -r .tree.id)"
api POST "/trees/$tree_id/persons" '{"firstName": "Jeanne", "lastName": "Test"}' "$token" >/dev/null
docker run --rm -v "$MEDIA_VOLUME":/data alpine sh -c 'echo "souvenir de test" > /data/restore-check.txt'

before="$(counts)"
read -r users trees persons _ <<< "$before"
[ "$users" -ge 1 ] && [ "$trees" -ge 1 ] && [ "$persons" -ge 1 ] || fail "données de test absentes avant la sauvegarde ($before)"
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
