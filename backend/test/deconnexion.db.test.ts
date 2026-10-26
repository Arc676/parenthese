import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Une session fermée reste fermée après un redémarrage de l'API (un déploiement), sur une vraie base. Avant, la
// déconnexion ne vivait qu'en mémoire et le jeton redevenait valable jusqu'à 7 jours. Lancé seulement avec
// TEST_DATABASE_URL (base jetable, migrée) :
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/genealogy_test npx vitest run test/deconnexion.db.test.ts
const TEST_DB = process.env.TEST_DATABASE_URL

let app: FastifyInstance
let ip = 0
const nextIp = () => `10.5.${Math.floor(++ip / 250)}.${ip % 250 + 1}`
const run = Date.now().toString(36)

async function call(method: string, url: string, token?: string, payload?: unknown) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    payload: payload as Record<string, unknown>,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    remoteAddress: nextIp(),
  })
  return { status: res.statusCode, body: res.body ? res.json() : null }
}

// Nouveau processus : la mémoire des déconnexions repart de zéro, puis l'API la recharge depuis la base
async function restart() {
  await app.close()
  const { forgetRevokedTokensInMemory } = await import('../src/lib/token-revocation.js')
  forgetRevokedTokensInMemory()
  const { createApp } = await import('../src/app.js')
  app = createApp()
  await app.ready()
}

async function login(name: string) {
  const email = `${name}-${run}@exemple.fr`
  const reg = await call('POST', '/auth/register', undefined, { email, password: 'mot-de-passe-solide', firstName: name })
  expect(reg.status).toBe(201)
  return reg.body.token as string
}

describe.skipIf(!TEST_DB)('déconnexion durable, vraie base', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = TEST_DB
    process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
    process.env.CORS_ORIGIN = 'http://localhost:5173'
    const { env } = await import('../src/config/env.js')
    env.ALLOW_REGISTRATION = true
    const { createApp } = await import('../src/app.js')
    app = createApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('un jeton déconnecté reste refusé après un redémarrage', async () => {
    const token = await login('deconnecte')
    const other = await login('reste')
    expect((await call('GET', '/auth/me', token)).status).toBe(200)
    expect((await call('POST', '/auth/logout', token)).status).toBe(200)
    expect((await call('GET', '/auth/me', token)).status).toBe(401)

    await restart()
    expect((await call('GET', '/auth/me', token)).status).toBe(401)
    // Une autre session, jamais fermée, passe toujours
    expect((await call('GET', '/auth/me', other)).status).toBe(200)
  })

  it('une déconnexion expirée est effacée au démarrage', async () => {
    const { prisma } = await import('../src/lib/prisma.js')
    const jti = `expire-${run}`
    await prisma.revokedSession.create({ data: { jti, expiresAt: new Date(Date.now() - 1000) } })
    await restart()
    expect(await prisma.revokedSession.findUnique({ where: { jti } })).toBeNull()
  })
})
