import * as client from 'openid-client'

import { env } from '../config/env.js'

// Connexion par un fournisseur OIDC (#115). Tout le protocole passe par openid-client : découverte, PKCE (S256),
// state et nonce, échange du code, puis vérification de l'ID token (signature par les clés publiées du
// fournisseur, émetteur, audience = notre client, expiration, nonce). Aucun jeton n'est décodé à la main ici.

export type OidcPending = {
  state: string
  nonce: string
  codeVerifier: string
  returnTo: string
  // Rattachement demandé depuis un compte connecté (ticket de /auth/oidc/link) : l'identité du fournisseur rejoint
  // ce compte, au lieu d'en chercher un par email
  linkUserId?: string
}

export type OidcIdentity = {
  issuer: string
  subject: string
  email: string | null
  emailVerified: boolean
  firstName: string | null
}

export function isOidcEnabled(): boolean {
  return Boolean(env.OIDC_ISSUER)
}

let configuration: Promise<client.Configuration> | null = null

// Découverte faite au premier besoin puis gardée ; un échec (fournisseur injoignable) sera retenté à la connexion suivante
export function getOidcConfiguration(): Promise<client.Configuration> {
  configuration ??= discover().catch((error: unknown) => {
    configuration = null
    throw error
  })
  return configuration
}

function discover(): Promise<client.Configuration> {
  const issuer = new URL(env.OIDC_ISSUER)
  // Sans secret : client public, PKCE seul. Avec : client_secret_basic, la méthode par défaut d'OIDC.
  const authentication = env.OIDC_CLIENT_SECRET ? client.ClientSecretBasic(env.OIDC_CLIENT_SECRET) : client.None()
  // Un fournisseur en http (réseau local) doit être autorisé explicitement par openid-client
  const options = issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined
  return client.discovery(issuer, env.OIDC_CLIENT_ID, undefined, authentication, options)
}

// Adresse de l'app où revenir : OIDC_APP_URL, sinon l'origine de l'adresse de retour (front et API sur la même adresse)
export function appBaseUrl(): string {
  return (env.OIDC_APP_URL || new URL(env.OIDC_REDIRECT_URI).origin).replace(/\/$/, '')
}

// Seules la racine, l'adresse d'un arbre partagé et celle d'une invitation à co-gérer un arbre sont acceptées
// comme retour : pas de redirection ouverte
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/(arbre\/[A-Za-z0-9-]{3,64}|invitation\/[A-Za-z0-9_-]{20,100})?$/.test(value) ? value : '/'
}

export async function startAuthorization(returnTo: string): Promise<{ url: URL; pending: OidcPending }> {
  const config = await getOidcConfiguration()
  const codeVerifier = client.randomPKCECodeVerifier()
  const pending: OidcPending = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier,
    returnTo,
  }
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: env.OIDC_REDIRECT_URI,
    scope: env.OIDC_SCOPES,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state: pending.state,
    nonce: pending.nonce,
  })
  return { url, pending }
}

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Retour du fournisseur. L'adresse vérifiée est OIDC_REDIRECT_URI plus les paramètres reçus, jamais l'en-tête Host.
export async function finishAuthorization(callbackQuery: string, pending: OidcPending): Promise<OidcIdentity> {
  const config = await getOidcConfiguration()
  const currentUrl = new URL(env.OIDC_REDIRECT_URI)
  currentUrl.search = callbackQuery

  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: pending.state,
    expectedNonce: pending.nonce,
    idTokenExpected: true,
  })

  const claims = tokens.claims()
  if (!claims) {
    throw new Error('oidc_missing_id_token')
  }

  let email = stringClaim(claims.email)
  let emailVerified = claims.email_verified === true
  let firstName = stringClaim(claims.given_name) ?? stringClaim(claims.name)

  // Certains fournisseurs (Authelia par défaut) ne mettent l'email que dans userinfo. Le sujet attendu est
  // celui de l'ID token : une réponse userinfo pour un autre compte est refusée par openid-client.
  if (!email && tokens.access_token) {
    const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub)
    email = stringClaim(info.email)
    emailVerified = info.email_verified === true
    firstName ??= stringClaim(info.given_name) ?? stringClaim(info.name)
  }

  return {
    issuer: claims.iss,
    subject: claims.sub,
    email: email?.toLowerCase() ?? null,
    emailVerified,
    firstName: firstName?.slice(0, 60) ?? null,
  }
}

// Pour les tests : oublie la configuration découverte
export function resetOidcConfiguration() {
  configuration = null
}
