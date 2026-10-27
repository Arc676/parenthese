import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { registerIdempotency, resetIdempotency } from '../src/lib/idempotency.js'

// Un envoi rejoué avec la même clé (réponse perdue sur un réseau faible) ne crée rien une seconde fois
let app: FastifyInstance
let created = 0
let failNext = false

const KEY = 'a1b2c3d4-e5f6-4789-9abc-def012345678'
const send = (headers: Record<string, string> = {}, url = '/trees/t1/contributions/sessions') =>
  app.inject({ method: 'POST', url, headers: { authorization: 'Bearer famille', ...headers }, payload: { title: 'x' } })

beforeAll(async () => {
  app = Fastify()
  registerIdempotency(app)
  app.post('/trees/:id/contributions/sessions', async (_request, reply) => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    if (failNext) {
      failNext = false
      return reply.code(503).send({ error: 'busy' })
    }
    created += 1
    return reply.code(201).send({ session: { id: `s${created}` } })
  })
  app.post('/trees/:id/autre', async () => {
    created += 1
    return { ok: created }
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  created = 0
  failNext = false
  resetIdempotency()
})

describe('Idempotency-Key', () => {
  it('rejoue la première réponse sans recréer', async () => {
    const first = await send({ 'idempotency-key': KEY })
    const second = await send({ 'idempotency-key': KEY })
    expect(created).toBe(1)
    expect(second.statusCode).toBe(201)
    expect(second.json()).toEqual(first.json())
    expect(second.headers['idempotent-replayed']).toBe('true')
  })

  it('deux essais simultanés : un seul est traité', async () => {
    const [a, b] = await Promise.all([send({ 'idempotency-key': KEY }), send({ 'idempotency-key': KEY })])
    expect(created).toBe(1)
    expect(a.json()).toEqual(b.json())
  })

  it('un échec n’est pas gardé : l’essai suivant refait la requête', async () => {
    failNext = true
    const first = await send({ 'idempotency-key': KEY })
    const second = await send({ 'idempotency-key': KEY })
    expect(first.statusCode).toBe(503)
    expect(second.statusCode).toBe(201)
    expect(created).toBe(1)
  })

  it('la clé d’une autre personne ne rejoue rien', async () => {
    await send({ 'idempotency-key': KEY })
    await send({ 'idempotency-key': KEY, authorization: 'Bearer quelquun-dautre' })
    expect(created).toBe(2)
  })

  it('sans clé, ou avec une clé mal formée, chaque envoi compte', async () => {
    await send()
    await send()
    await send({ 'idempotency-key': 'court' })
    await send({ 'idempotency-key': 'court' })
    expect(created).toBe(4)
  })

  it('les autres routes ne sont pas concernées', async () => {
    await send({ 'idempotency-key': KEY }, '/trees/t1/autre')
    await send({ 'idempotency-key': KEY }, '/trees/t1/autre')
    expect(created).toBe(2)
  })
})
