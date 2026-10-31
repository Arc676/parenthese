import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

// dotenv 17+ écrit « injected env (N) from .env » à chaque démarrage, même sans fichier : les journaux
// de l'API restent au format JSON de Fastify
loadDotenv({ quiet: true })

const DEV_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
const DEV_JWT_SECRET = 'dev-secret-change-me-please'

// Valeurs d'exemple publiées dans le dépôt : une instance qui les garde a un secret connu de tous
const PUBLISHED_PLACEHOLDER_SECRETS = [
  DEV_JWT_SECRET,
  'change-me-in-production',
  'changeme',
]

// Adresses des proxys de confiance devant l'API (liste séparée par des virgules, mots-clés de proxy-addr :
// loopback, uniquelocal, linklocal, ou IP/CIDR). Par défaut : nginx sur la même machine (pm2) ou dans le
// réseau Docker (compose). L'adresse du client est la dernière entrée de X-Forwarded-For ajoutée par un
// proxy de confiance. `true` lirait l'adresse dans un en-tête que le client écrit lui-même, et Fastify
// ignore un nombre de sauts : ni l'un ni l'autre n'est accepté.
function parseTrustProxy(value: string): boolean | string {
  if (value === 'false') return false
  if (value === 'true' || /^\d+$/.test(value)) {
    throw new Error('TRUST_PROXY must list the proxy addresses (e.g. "loopback,uniquelocal"), not true or a hop count')
  }
  return value
}

// « true » ou « false », sans tenir compte de la casse. z.coerce.boolean lirait « false » comme vrai.
function parseBooleanFlag(name: string) {
  return (value: string): boolean => {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    throw new Error(`${name} must be "true" or "false"`)
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  TRUST_PROXY: z.string().default('loopback,uniquelocal').transform(parseTrustProxy),
  DATABASE_URL: z.string().min(1).default(DEV_DATABASE_URL),
  JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().default('7d'),
  // Les sessions de compte émises avant cette date sont refusées. Jusqu'au 30/09/2026, des sessions complètes
  // ont pu être écrites dans les annotations photo et les journaux : elles tombent toutes, chacun se reconnecte
  // une fois. Avancer cette date (ISO 8601) déconnecte tout le monde, sans changer JWT_SECRET (qui chiffre aussi
  // les mots de passe de partage lisibles).
  SESSIONS_NOT_BEFORE: z.coerce.date().default(new Date('2026-10-01T00:00:00Z')),
  JWT_TREE_ACCESS_EXPIRES_IN: z.string().default('24h'),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
  MEDIA_STORAGE_PATH: z.string().default('./storage/media'),
  // Place disque par arbre, et part réservée aux envois de la famille en attente de relecture
  MEDIA_QUOTA_PER_TREE_MB: z.coerce.number().int().positive().default(5120),
  MEDIA_PENDING_QUOTA_PER_TREE_MB: z.coerce.number().int().positive().default(500),
  // Instances Immich autorisées sur ce serveur, séparées par des virgules. Les administrateurs
  // d'un arbre choisissent leur connexion parmi cette liste : sans elle, la reconnaissance
  // des visages reste éteinte et le serveur ne peut pas servir de proxy vers un service interne.
  IMMICH_ALLOWED_API_URLS: z.string().default(''),
  // Création de compte. À « false », seuls les comptes existants se connectent : une instance ouverte sur
  // Internet ne laisse pas un inconnu qui trouve l'adresse créer ses arbres. Une instance sans aucun compte
  // accepte quand même le premier, celui du propriétaire (voir lib/registration.ts).
  ALLOW_REGISTRATION: z.string().default('true').transform(parseBooleanFlag('ALLOW_REGISTRATION')),
  // Invitations à créer son propre arbre, ajoutées pour l'instance hébergée app.parenthese.io : « Faire le mien »
  // dans le menu Ajouter de la famille, l'inscription proposée dans les messages de la démo, message d'invitation
  // de Noël. Éteintes par défaut : une instance auto-hébergée n'a pas à pousser vers la création de compte.
  // L'instance hébergée les allume dans ecosystem.config.cjs.
  SIGNUP_PROMPTS: z.string().default('false').transform(parseBooleanFlag('SIGNUP_PROMPTS')),
  // Connexion par un fournisseur d'identité OIDC (#115 ; Authentik, Authelia, Keycloak, Pocket ID…). Éteinte sans
  // OIDC_ISSUER. Le fournisseur renvoie vers OIDC_REDIRECT_URI, l'adresse publique de /auth/oidc/callback.
  OIDC_ISSUER: z.string().trim().default(''),
  OIDC_CLIENT_ID: z.string().trim().default(''),
  // Vide : client public, protégé par PKCE seul
  OIDC_CLIENT_SECRET: z.string().default(''),
  OIDC_REDIRECT_URI: z.string().trim().default(''),
  // Où l'app s'ouvre après la connexion. Par défaut l'origine de OIDC_REDIRECT_URI (Docker : front et API sur la
  // même adresse) ; à renseigner quand le front a sa propre adresse (développement).
  OIDC_APP_URL: z.string().trim().default(''),
  OIDC_SCOPES: z.string().default('openid email profile'),
  // Nom du bouton « Se connecter avec … »
  OIDC_PROVIDER_NAME: z.string().trim().max(40).default('SSO'),
  // Un compte n'est créé ou relié par son email que si le fournisseur le dit vérifié (email_verified). À false
  // seulement pour un fournisseur qui ne l'envoie pas et où personne ne choisit lui-même son adresse.
  OIDC_REQUIRE_VERIFIED_EMAIL: z.string().default('true').transform(parseBooleanFlag('OIDC_REQUIRE_VERIFIED_EMAIL')),
  // À false, plus de mot de passe Parenthèse : connexion par le fournisseur OIDC seulement
  PASSWORD_LOGIN: z.string().default('true').transform(parseBooleanFlag('PASSWORD_LOGIN')),
  // Sources publiques que le panneau « Chercher quelqu'un » interroge depuis le serveur, séparées par des
  // virgules : deces (décès en France depuis 1970, INSEE par matchID), wikitree. Vide : aucun nom ne quitte
  // l'instance, le panneau ne propose que des liens vers les sites, ouverts par le navigateur.
  SEARCH_SOURCES: z.string().default(''),
  // Facultatif : jeton matchID (gratuit, après inscription) au-delà d'une centaine de recherches
  MATCHID_TOKEN: z.string().trim().default(''),
})

export const env = envSchema.parse(process.env)

function assertHttpUrl(name: string, value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a full URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be an http(s) URL`)
  }
}

if (env.OIDC_ISSUER) {
  assertHttpUrl('OIDC_ISSUER', env.OIDC_ISSUER)
  if (!env.OIDC_CLIENT_ID) throw new Error('OIDC_CLIENT_ID is required with OIDC_ISSUER')
  if (!env.OIDC_REDIRECT_URI) throw new Error('OIDC_REDIRECT_URI is required with OIDC_ISSUER (public address of /auth/oidc/callback)')
  assertHttpUrl('OIDC_REDIRECT_URI', env.OIDC_REDIRECT_URI)
  if (env.OIDC_APP_URL) assertHttpUrl('OIDC_APP_URL', env.OIDC_APP_URL)
  if (!env.OIDC_SCOPES.split(/\s+/).includes('openid')) throw new Error('OIDC_SCOPES must include openid')
}

// Sans mot de passe ni fournisseur, personne ne pourrait se connecter
if (!env.PASSWORD_LOGIN && !env.OIDC_ISSUER) {
  throw new Error('PASSWORD_LOGIN=false needs OIDC_ISSUER: otherwise nobody can sign in')
}

// Corps maximal des routes qui reçoivent un fichier en base64 ou un gros envoi (le reste de l'API : 1 Mo)
export const UPLOAD_BODY_LIMIT = 12 * 1024 * 1024

// Sans NODE_ENV, le schéma suppose « development » et la clé de signature retomberait sur une valeur publiée :
// un `node dist/server.js` lancé à la main avec un .env incomplet signerait alors les sessions avec une clé
// connue de tous. Hors développement ou test déclaré, une valeur publiée est refusée.
if (!process.env.NODE_ENV && PUBLISHED_PLACEHOLDER_SECRETS.includes(env.JWT_SECRET)) {
  throw new Error('JWT_SECRET is a published example value and NODE_ENV is not set: set NODE_ENV=development for local work, or generate a secret with `openssl rand -base64 48`')
}

if (env.NODE_ENV === 'production') {
  if (PUBLISHED_PLACEHOLDER_SECRETS.includes(env.JWT_SECRET)) {
    throw new Error('JWT_SECRET is a published example value: generate one with `openssl rand -base64 48`')
  }

  if (env.JWT_SECRET.length < 32) {
    console.warn('JWT_SECRET is shorter than 32 characters: generate a longer one with `openssl rand -base64 48`')
  }

  if (env.DATABASE_URL === DEV_DATABASE_URL) {
    throw new Error('DATABASE_URL must be overridden in production')
  }
}
