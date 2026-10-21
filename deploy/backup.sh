#!/bin/bash
# Parenthèse : sauvegarde de la base et des médias.
#
# Lancé chaque nuit par cron sur le VPS (/etc/cron.d/parenthese-backup), sans dépendre d'une connexion SSH depuis GitHub.
# La base est sauvegardée à chaque passage. L'archive des médias n'est refaite que si les médias ont
# changé (sinon une archive identique par jour), et seules les
# BACKUP_MEDIA_KEEP dernières archives sont gardées.
#
# Envoi hors du serveur (facultatif, BACKUP_S3_BUCKET) : si BACKUP_AGE_RECIPIENT est renseigné (une ou
# plusieurs clés publiques séparées par des espaces, « age1... » ou « ssh-ed25519 AAAA... » sans commentaire),
# le dump et l'archive sont chiffrés avec age avant l'envoi et seules les copies chiffrées (.age) partent.
# Les fichiers gardés sur le serveur restent en clair, lisibles par root seulement.
# Restauration d'une copie chiffrée : age -d -i cle-privee.txt fichier.dump.age > fichier.dump
set -euo pipefail
# Dumps, archives et empreintes lisibles par le seul propriétaire
umask 077

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_ENV_FILE="$REPO_DIR/backend/.env"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/genealogy/backup.env}"

if [ ! -f "$BACKEND_ENV_FILE" ]; then
  echo "ERROR: Missing $BACKEND_ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$BACKEND_ENV_FILE"
if [ -f "$BACKUP_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
fi
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required for backups."
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump is not installed."
  exit 1
fi

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/genealogy}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_MEDIA_KEEP="${BACKUP_MEDIA_KEEP:-2}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

DB_DIR="$BACKUP_ROOT/db"
MEDIA_DIR="$BACKUP_ROOT/media"
META_DIR="$BACKUP_ROOT/meta"
MANIFEST_FILE="$META_DIR/media-manifest.sha256"

mkdir -p "$DB_DIR" "$MEDIA_DIR" "$META_DIR"

DB_BACKUP_FILE="$DB_DIR/genealogy-db-$TIMESTAMP.dump"
CHECKSUM_FILE="$META_DIR/genealogy-$TIMESTAMP.sha256"

echo "[$(date -u +%FT%TZ)] Sauvegarde Parenthèse"

echo "[1/5] Backup PostgreSQL..."
pg_dump "$DATABASE_URL" --format=custom --file "$DB_BACKUP_FILE"

echo "[2/5] Backup media files..."
MEDIA_STORAGE_PATH_VALUE="${MEDIA_STORAGE_PATH:-./storage/media}"
if [[ "$MEDIA_STORAGE_PATH_VALUE" != /* ]]; then
  MEDIA_STORAGE_PATH_VALUE="$REPO_DIR/backend/$MEDIA_STORAGE_PATH_VALUE"
fi

# Empreinte des médias : chemin, taille et date de chaque fichier. Même empreinte = rien de nouveau.
if [ -d "$MEDIA_STORAGE_PATH_VALUE" ]; then
  CURRENT_MANIFEST="$(cd "$MEDIA_STORAGE_PATH_VALUE" && find . -type f -printf '%P\t%s\t%T@\n' | LC_ALL=C sort | sha256sum | cut -d' ' -f1)"
else
  CURRENT_MANIFEST="empty"
fi
LAST_MANIFEST="$(cat "$MANIFEST_FILE" 2>/dev/null || true)"
LATEST_MEDIA="$(ls -1t "$MEDIA_DIR"/*.tar.gz 2>/dev/null | head -1 || true)"

MEDIA_IS_NEW=0
if [ -n "$LATEST_MEDIA" ] && [ "$CURRENT_MANIFEST" = "$LAST_MANIFEST" ] && [ "${FORCE_MEDIA_BACKUP:-0}" != "1" ]; then
  echo "Médias inchangés depuis $(basename "$LATEST_MEDIA"), pas de nouvelle archive."
  MEDIA_BACKUP_FILE="$LATEST_MEDIA"
else
  MEDIA_BACKUP_FILE="$MEDIA_DIR/genealogy-media-$TIMESTAMP.tar.gz"
  if [ -d "$MEDIA_STORAGE_PATH_VALUE" ]; then
    tar -czf "$MEDIA_BACKUP_FILE" -C "$MEDIA_STORAGE_PATH_VALUE" .
  else
    echo "WARNING: Media path '$MEDIA_STORAGE_PATH_VALUE' does not exist, creating empty archive."
    tar -czf "$MEDIA_BACKUP_FILE" --files-from /dev/null
  fi
  echo "$CURRENT_MANIFEST" > "$MANIFEST_FILE"
  MEDIA_IS_NEW=1
fi

echo "[3/5] Generate checksums..."
(
  cd "$BACKUP_ROOT"
  sha256sum "db/$(basename "$DB_BACKUP_FILE")"
  # Archive du jour ou archive gardée : son empreinte est recalculée, celle du jour où elle a été faite
  # disparaît avec la rotation des fichiers d'empreintes (14 jours) alors que l'archive reste
  sha256sum "media/$(basename "$MEDIA_BACKUP_FILE")"
) > "$CHECKSUM_FILE"

echo "[4/5] Optional offsite upload..."
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: BACKUP_S3_BUCKET is set but aws CLI is not installed."
    exit 1
  fi

  BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-genealogy}"
  S3_BASE_URI="s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX"
  S3_ARGS=()
  if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
    S3_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  fi
  if [ -n "${BACKUP_S3_REGION:-}" ]; then
    S3_ARGS+=(--region "$BACKUP_S3_REGION")
  fi

  # Copies à envoyer : chiffrées si une clé age est configurée, sinon les fichiers tels quels (comportement historique)
  UPLOAD_DB_FILE="$DB_BACKUP_FILE"
  UPLOAD_MEDIA_FILE="$MEDIA_BACKUP_FILE"
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    if ! command -v age >/dev/null 2>&1; then
      echo "ERROR: BACKUP_AGE_RECIPIENT is set but age is not installed (apt install age)."
      exit 1
    fi
    AGE_ARGS=()
    read -r -a AGE_KEYS <<< "$BACKUP_AGE_RECIPIENT"
    # Une clé ssh s'écrit en deux mots (« ssh-ed25519 AAAA... ») : on recolle type et clé
    i=0
    while [ "$i" -lt "${#AGE_KEYS[@]}" ]; do
      key="${AGE_KEYS[$i]}"
      if [[ "$key" == ssh-* ]]; then
        i=$((i + 1))
        key="$key ${AGE_KEYS[$i]:-}"
      fi
      AGE_ARGS+=(-r "$key")
      i=$((i + 1))
    done
    ENCRYPT_DIR="$(mktemp -d "$BACKUP_ROOT/.offsite-XXXXXX")"
    trap 'rm -rf "$ENCRYPT_DIR"' EXIT
    UPLOAD_DB_FILE="$ENCRYPT_DIR/$(basename "$DB_BACKUP_FILE").age"
    age "${AGE_ARGS[@]}" -o "$UPLOAD_DB_FILE" "$DB_BACKUP_FILE"
    if [ "$MEDIA_IS_NEW" = "1" ]; then
      UPLOAD_MEDIA_FILE="$ENCRYPT_DIR/$(basename "$MEDIA_BACKUP_FILE").age"
      age "${AGE_ARGS[@]}" -o "$UPLOAD_MEDIA_FILE" "$MEDIA_BACKUP_FILE"
    fi
    echo "Copies chiffrées avec age avant envoi."
  elif [ "${BACKUP_ALLOW_PLAINTEXT:-0}" = "1" ]; then
    echo "WARNING: BACKUP_AGE_RECIPIENT absent et BACKUP_ALLOW_PLAINTEXT=1 : les sauvegardes partent en clair."
  else
    # Des arbres de familles (noms, dates, photos) chez un hébergeur tiers, en clair : refusé par défaut.
    # La copie locale ci-dessus est faite ; seul l'envoi hors du serveur est sauté.
    echo "ERROR: BACKUP_S3_BUCKET est défini sans BACKUP_AGE_RECIPIENT : envoi refusé (chiffrez avec age, ou BACKUP_ALLOW_PLAINTEXT=1)."
    exit 1
  fi

  aws s3 cp "$UPLOAD_DB_FILE" "$S3_BASE_URI/db/$(basename "$UPLOAD_DB_FILE")" "${S3_ARGS[@]}"
  if [ "$MEDIA_IS_NEW" = "1" ]; then
    aws s3 cp "$UPLOAD_MEDIA_FILE" "$S3_BASE_URI/media/$(basename "$UPLOAD_MEDIA_FILE")" "${S3_ARGS[@]}"
  fi
  aws s3 cp "$CHECKSUM_FILE" "$S3_BASE_URI/meta/$(basename "$CHECKSUM_FILE")" "${S3_ARGS[@]}"
else
  echo "No BACKUP_S3_BUCKET configured, skipping offsite upload."
fi

echo "[5/5] Local retention cleanup..."
find "$DB_DIR" -type f -name '*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -delete
find "$META_DIR" -type f -name 'genealogy-*.sha256' -mtime +"$BACKUP_RETENTION_DAYS" -delete
# Médias : par nombre d'archives et non par âge, l'archive en cours peut dater de plusieurs semaines
ls -1t "$MEDIA_DIR"/*.tar.gz 2>/dev/null | tail -n +"$((BACKUP_MEDIA_KEEP + 1))" | xargs -r rm -f

echo "Backup complete:"
echo "  DB: $DB_BACKUP_FILE"
echo "  Media: $MEDIA_BACKUP_FILE$([ "$MEDIA_IS_NEW" = "1" ] || echo " (inchangé)")"
echo "  Checksums: $CHECKSUM_FILE"
