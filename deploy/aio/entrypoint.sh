#!/bin/bash
# Démarrage de l'image tout-en-un (Dockerfile.aio) : PostgreSQL, puis l'API, puis nginx.
#
# Au premier démarrage, crée dans /data la base, le mot de passe de la base et la clé de signature des sessions
# (JWT_SECRET), gardés pour les démarrages suivants. Une variable JWT_SECRET passée au conteneur l'emporte sur
# la clé générée. Si l'un des trois processus s'arrête, le conteneur s'arrête, et le redémarrage automatique
# de Docker le relance.
set -euo pipefail

DATA_DIR=/data
PGDATA="$DATA_DIR/postgres"
MEDIA_DIR="$DATA_DIR/media"
SECRETS_DIR="$DATA_DIR/secrets"
DB_NAME=parenthese
DB_USER=parenthese

log() { echo "[parenthese] $*" >&2; }

mkdir -p "$MEDIA_DIR" "$SECRETS_DIR" /run/postgresql
chmod 700 "$SECRETS_DIR"
chown postgres:postgres /run/postgresql
chown node:node "$MEDIA_DIR"

# Secrets générés une fois, lisibles par root seulement.
secret() {
  local file="$SECRETS_DIR/$1"
  if [ ! -s "$file" ]; then
    (umask 077 && openssl rand -hex "$2" > "$file")
    log "secret $1 créé dans $file"
  fi
  cat "$file"
}

DB_PASSWORD="$(secret db_password 24)"
if [ -z "${JWT_SECRET:-}" ]; then
  JWT_SECRET="$(secret jwt_secret 48)"
fi

# PostgreSQL, à l'écoute de la machine seule.
FIRST_START=0
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "première installation : création de la base dans $PGDATA"
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"
  runuser -u postgres -- initdb -D "$PGDATA" --encoding=UTF8 --locale=C.UTF-8 \
    --auth-local=peer --auth-host=scram-sha-256 >/dev/null
  FIRST_START=1
fi
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

runuser -u postgres -- pg_ctl -D "$PGDATA" -w -t 60 \
  -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/run/postgresql" \
  -l "$PGDATA/postgres.log" start >/dev/null

if [ "$FIRST_START" = 1 ]; then
  runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -c "CREATE ROLE $DB_USER LOGIN"
  runuser -u postgres -- createdb -O "$DB_USER" "$DB_NAME"
fi
# Le mot de passe suit le fichier de /data à chaque démarrage (hexadécimal, sans guillemet possible).
runuser -u postgres -- psql -q -v ON_ERROR_STOP=1 -c "ALTER ROLE $DB_USER PASSWORD '$DB_PASSWORD'"

export NODE_ENV=production
export PORT=4000
export HOST=127.0.0.1
export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME"
export MEDIA_STORAGE_PATH="$MEDIA_DIR"
export JWT_SECRET

stop_all() {
  log "arrêt"
  [ -n "${NGINX_PID:-}" ] && kill -QUIT "$NGINX_PID" 2>/dev/null || true
  [ -n "${API_PID:-}" ] && kill -TERM "$API_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  runuser -u postgres -- pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
}
trap 'stop_all; exit 0' TERM INT

cd /app
log "migrations"
runuser -u node -- env PATH="$PATH" prisma migrate deploy

log "démarrage de l'API"
runuser -u node -- env PATH="$PATH" node dist/server.js &
API_PID=$!

for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:4000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
    break
  fi
  kill -0 "$API_PID" 2>/dev/null || { log "l'API s'est arrêtée au démarrage"; stop_all; exit 1; }
  sleep 1
done

log "démarrage de nginx"
nginx -g 'daemon off;' &
NGINX_PID=$!

log "prêt sur le port 80"
set +e
wait -n "$API_PID" "$NGINX_PID"
status=$?
log "un processus s'est arrêté (code $status)"
stop_all
exit "$status"
