# syntax=docker/dockerfile:1
# API Parenthèse (Fastify + Prisma). Contexte de build : le dossier backend/.
# Étape 1 : dépendances complètes, client Prisma (généré dans src/generated), compilation TypeScript.
# Étape 2 : image finale avec les seules dépendances de production, plus la CLI Prisma
#           installée à part (nécessaire à `prisma migrate deploy` au démarrage).

FROM node:24-bookworm-slim AS build

# openssl : requis par le moteur de migration de Prisma (cible debian-openssl-3.0.x).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build


FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances de production seules.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# CLI Prisma : c'est une devDependency, donc absente de l'installation précédente. Elle est installée
# dans un dossier séparé, à la version exacte du package-lock, pour ne pas toucher à node_modules
# (un `npm install --omit=dev prisma` dans /app l'ignorerait, puisqu'elle est déclarée en dev).
RUN PRISMA_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
  && mkdir -p /opt/prisma \
  && cd /opt/prisma \
  && echo '{"private":true}' > package.json \
  && npm install --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
  && npm cache clean --force

# Schéma, migrations et configuration : indispensables à `prisma migrate deploy`. Le client Prisma est compilé dans dist.
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/storage/media && chown -R node:node /app/storage

ENV NODE_ENV=production \
    PORT=4000 \
    MEDIA_STORAGE_PATH=/app/storage/media \
    CHECKPOINT_DISABLE=1 \
    PATH=/opt/prisma/node_modules/.bin:$PATH

USER node
EXPOSE 4000

# Applique les migrations en attente puis démarre l'API.
CMD ["sh", "-c", "prisma migrate deploy && exec node dist/server.js"]
