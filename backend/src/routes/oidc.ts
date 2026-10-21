import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { env } from '../config/env.js'
import {
  appBaseUrl,
  finishAuthorization,
  isOidcEnabled,
  safeReturnTo,
  startAuthorization,
  type OidcIdentity,
  type OidcPending,
} from '../lib/oidc.js'
import { confirmsWithPassword } from '../lib/auth.js'
import { createAccountIfAllowed } from '../lib/registration.js'
import { signUserSession } from '../lib/user-session.js'

// Parcours : /auth/oidc/start pose un cookie signé (state, nonce, vérificateur PKCE) et part chez le fournisseur ;
// /auth/oidc/callback vérifie tout, trouve ou crée le compte, et renvoie vers l'app avec un jeton de passage dans le
// fragment (#oidc=…, jamais envoyé à un serveur ni écrit dans un journal) ; l'app l'échange une seule fois contre
// une session sur /auth/oidc/exchange. Le cookie lie le retour au navigateur qui a commencé la connexion.

const PENDING_COOKIE = 'parenthese_oidc'
const PENDING_MAX_AGE_S = 10 * 60
const HANDOFF_TTL_S = 60

type HandoffPayload = { kind: 'oidc_handoff'; sub: string; jti: string; exp?: number }

// Jetons de passage déjà échangés, jusqu'à leur expiration (une seule instance de l'API, comme les sessions révoquées)
const usedHandoffs = new Map<string, number>()
function consumeHandoff(jti: string, expSeconds: number): boolean {
  const now = Date.now()
  for (const [key, expiresAt] of usedHandoffs) {
    if (expiresAt < now) usedHandoffs.delete(key)
  }
  if (usedHandoffs.has(jti)) return false
  usedHandoffs.set(jti, expSeconds * 1000)
  return true
}

const pendingSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  codeVerifier: z.string().min(43),
  returnTo: z.string(),
})

const exchangeSchema = z.object({
  code: z.string().min(1).max(4096),
})

type AccountResult = { userId: string } | { error: 'registration_closed' | 'oidc_email_missing' | 'oidc_email_unverified' | 'oidc_email_taken' }

// Compte relié à cette identité ; sinon le compte qui a cet email, si le fournisseur le garantit ; sinon un compte
// neuf, seulement si l'instance en accepte (ALLOW_REGISTRATION, ou instance encore vide).
async function resolveAccount(app: FastifyInstance, identity: OidcIdentity): Promise<AccountResult> {
  const linked = await app.prisma.userIdentity.findUnique({
    where: { issuer_subject: { issuer: identity.issuer, subject: identity.subject } },
    select: { userId: true },
  })
  if (linked) return { userId: linked.userId }

  if (!identity.email) return { error: 'oidc_email_missing' }
  if (env.OIDC_REQUIRE_VERIFIED_EMAIL && !identity.emailVerified) return { error: 'oidc_email_unverified' }

  const existing = await app.prisma.user.findUnique({
    where: { email: identity.email },
    select: { id: true, passwordHash: true, identities: { select: { id: true }, take: 1 } },
  })
  if (existing) {
    // Relier un compte existant demande toujours un email vérifié, même avec OIDC_REQUIRE_VERIFIED_EMAIL=false :
    // sinon quiconque déclare l'adresse d'un autre chez le fournisseur prendrait son compte
    if (!identity.emailVerified) return { error: 'oidc_email_unverified' }
    // Jamais vers un compte à mot de passe : l'inscription ne vérifie pas l'adresse, un tiers aurait pu créer ce
    // compte avec l'email de la victime, et sa connexion par le fournisseur y serait reliée, lisible par le tiers
    if (existing.passwordHash) return { error: 'oidc_email_taken' }
    // Un compte déjà relié à une autre identité (un autre sujet) n'est jamais repris par un nouveau sujet qui
    // présente le même email : le fournisseur a pu réattribuer l'adresse. Le compte reste à celui qui l'a relié.
    if (existing.identities?.length) return { error: 'oidc_email_taken' }

    await app.prisma.userIdentity.create({
      data: { userId: existing.id, issuer: identity.issuer, subject: identity.subject },
    })
    return { userId: existing.id }
  }

  const created = await createAccountIfAllowed(app.prisma, (tx) => tx.user.create({
    data: {
      email: identity.email as string,
      firstName: identity.firstName,
      passwordHash: null,
      identities: { create: { issuer: identity.issuer, subject: identity.subject } },
    },
    select: { id: true },
  }))
  return created ? { userId: created.id } : { error: 'registration_closed' }
}

function redirectToApp(reply: FastifyReply, returnTo: string, fragment: string) {
  reply.clearCookie(PENDING_COOKIE, { path: '/' })
  return reply.redirect(`${appBaseUrl()}${returnTo}#${fragment}`, 302)
}

export const oidcRoutes: FastifyPluginAsync = async (app) => {
  if (!isOidcEnabled()) return

  const secureCookie = new URL(env.OIDC_REDIRECT_URI).protocol === 'https:'

  app.get(
    '/start',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const returnTo = safeReturnTo((request.query as Record<string, unknown> | undefined)?.returnTo)
      let start: Awaited<ReturnType<typeof startAuthorization>>
      try {
        start = await startAuthorization(returnTo)
      } catch (error) {
        request.log.error({ err: error }, 'OIDC discovery failed')
        return redirectToApp(reply, returnTo, 'oidc_error=oidc_unavailable')
      }

      reply.setCookie(PENDING_COOKIE, JSON.stringify(start.pending), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax', // envoyé au retour du fournisseur, qui est une navigation de premier niveau
        secure: secureCookie,
        signed: true,
        maxAge: PENDING_MAX_AGE_S,
      })
      return reply.redirect(start.url.href, 302)
    },
  )

  app.get(
    '/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const raw = request.cookies[PENDING_COOKIE]
      const unsigned = raw ? request.unsignCookie(raw) : null
      let pending: OidcPending | null = null
      if (unsigned?.valid && unsigned.value) {
        try {
          const parsed = pendingSchema.safeParse(JSON.parse(unsigned.value))
          pending = parsed.success ? parsed.data : null
        } catch {
          pending = null
        }
      }
      if (!pending) {
        // Pas de connexion commencée dans ce navigateur (cookie absent, expiré ou modifié)
        return redirectToApp(reply, '/', 'oidc_error=oidc_failed')
      }

      const returnTo = safeReturnTo(pending.returnTo)
      const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : ''

      let identity: OidcIdentity
      try {
        identity = await finishAuthorization(query, pending)
      } catch (error) {
        // Refus chez le fournisseur, state ou nonce faux, ID token invalide (signature, émetteur, audience, date)
        request.log.warn({ err: error }, 'OIDC callback rejected')
        return redirectToApp(reply, returnTo, 'oidc_error=oidc_failed')
      }

      let result: AccountResult
      try {
        result = await resolveAccount(app, identity)
      } catch (error) {
        // Deux retours simultanés pour la même identité : le second retrouve le lien créé par le premier
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          result = await resolveAccount(app, identity)
        } else {
          throw error
        }
      }
      if ('error' in result) {
        return redirectToApp(reply, returnTo, `oidc_error=${result.error}`)
      }

      const handoff = app.jwt.sign(
        { kind: 'oidc_handoff', sub: result.userId, jti: randomUUID() },
        { expiresIn: `${HANDOFF_TTL_S}s` },
      )
      return redirectToApp(reply, returnTo, `oidc=${encodeURIComponent(handoff)}`)
    },
  )

  app.post(
    '/exchange',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = exchangeSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload' })
      }

      let payload: HandoffPayload
      try {
        payload = app.jwt.verify<HandoffPayload>(parsed.data.code)
      } catch {
        return reply.code(401).send({ error: 'invalid_handoff' })
      }
      if (payload.kind !== 'oidc_handoff' || typeof payload.exp !== 'number' || !consumeHandoff(payload.jti, payload.exp)) {
        return reply.code(401).send({ error: 'invalid_handoff' })
      }

      const user = await app.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, firstName: true, passwordHash: true },
      })
      if (!user) {
        return reply.code(401).send({ error: 'invalid_handoff' })
      }

      return reply.send({
        token: signUserSession(app, user),
        user: { id: user.id, email: user.email, firstName: user.firstName, hasPassword: confirmsWithPassword(user.passwordHash) },
      })
    },
  )
}
