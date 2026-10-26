import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Panneau « Chercher quelqu'un » : seules les sources allumées par l'opérateur répondent, seulement pour
// quelqu'un qui lit l'arbre, et la réponse de matchID arrive au format commun du front.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    // Sessions fermées (lib/token-revocation.ts), rechargées au démarrage
    revokedSession: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: { count: vi.fn().mockResolvedValue(1) },
    treeMembership: { findUnique: vi.fn() },
    userTreeAccess: { findUnique: vi.fn().mockResolvedValue(null) },
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }))

let createApp: () => FastifyInstance

beforeAll(async () => {
  process.env.SEARCH_SOURCES = 'deces, inconnue'
  process.env.MATCHID_TOKEN = ''
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
  createApp = (await import('../src/app.js')).createApp
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function userToken(app: FastifyInstance) {
  return (app as any).jwt.sign(
    { kind: 'user', sub: 'user-1', jti: randomUUID(), userId: 'user-1', email: 'user@example.com' },
    { expiresIn: '1h' },
  )
}

const MATCHID_PAYLOAD = {
  response: {
    persons: [
      {
        id: 'abc123',
        name: { first: ['Jean', 'Louis'], last: 'Dupont' },
        sex: 'M',
        birth: { date: '18980314', location: { city: 'Tulle', departmentCode: '19', country: 'France' } },
        death: { date: '19871108', location: { city: 'Limoges', departmentCode: '87', country: 'France' } },
      },
      {
        id: 'def456',
        name: { first: ['Jean'], last: 'Dupont' },
        sex: 'M',
        birth: { date: '18980602', location: { city: 'Liège', country: 'Belgique' } },
        death: { date: '19740121', location: { city: 'Brive-la-Gaillarde', departmentCode: '19', country: 'France' } },
      },
    ],
  },
}

describe('search sources', () => {
  it('lists only the sources the operator enabled', async () => {
    const app = createApp()
    await app.ready()
    prismaMock.treeMembership.findUnique.mockResolvedValue({ treeId: 'tree-1', userId: 'user-1', role: 'owner', tree: { deletedAt: null } })
    const response = await app.inject({ method: 'GET', url: '/trees/tree-1/search-sources', headers: { authorization: `Bearer ${userToken(app)}` } })
    expect(response.json()).toEqual({ sources: ['deces'] })
    const anonymous = await app.inject({ method: 'GET', url: '/trees/tree-1/search-sources' })
    expect(anonymous.statusCode).toBe(401)
  })

  it('refuses a visitor without access, and a source that is not enabled', async () => {
    const app = createApp()
    await app.ready()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const anonymous = await app.inject({ method: 'POST', url: '/trees/tree-1/search-sources/deces', payload: { firstName: 'Jean', lastName: 'Dupont' } })
    expect(anonymous.statusCode).toBe(401)

    prismaMock.treeMembership.findUnique.mockResolvedValue(null)
    const stranger = await app.inject({
      method: 'POST', url: '/trees/tree-1/search-sources/deces',
      headers: { authorization: `Bearer ${userToken(app)}` },
      payload: { firstName: 'Jean', lastName: 'Dupont' },
    })
    expect(stranger.statusCode).toBe(403)

    prismaMock.treeMembership.findUnique.mockResolvedValue({ treeId: 'tree-1', userId: 'user-1', role: 'owner', tree: { deletedAt: null } })
    const disabled = await app.inject({
      method: 'POST', url: '/trees/tree-1/search-sources/wikitree',
      headers: { authorization: `Bearer ${userToken(app)}` },
      payload: { firstName: 'Jean', lastName: 'Dupont' },
    })
    expect(disabled.statusCode).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends only the name and birth year to matchID and returns the common format', async () => {
    const app = createApp()
    await app.ready()
    prismaMock.treeMembership.findUnique.mockResolvedValue({ treeId: 'tree-1', userId: 'user-1', role: 'owner', tree: { deletedAt: null } })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(MATCHID_PAYLOAD), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'POST', url: '/trees/tree-1/search-sources/deces',
      headers: { authorization: `Bearer ${userToken(app)}` },
      payload: { firstName: 'Jean', lastName: 'Dupont', birthYear: 1898, place: 'Tulle' },
    })
    expect(response.statusCode).toBe(200)

    const called = new URL(fetchMock.mock.calls[0][0])
    expect(called.origin + called.pathname).toBe('https://deces.matchid.io/deces/api/v1/search')
    expect(Object.fromEntries(called.searchParams)).toEqual({ firstName: 'Jean', lastName: 'Dupont', birthDate: '1898', size: '10' })

    const { results } = response.json()
    expect(results[0]).toEqual({
      id: 'abc123',
      firstName: 'Jean Louis',
      lastName: 'Dupont',
      sex: 'M',
      birth: { date: '1898-03-14', place: 'Tulle (19)' },
      death: { date: '1987-11-08', place: 'Limoges (87)' },
      url: 'https://deces.matchid.io/id/abc123',
      match: 'good',
    })
    // Né ailleurs que le lieu cherché : proposé, mais à comparer
    expect(results[1].birth.place).toBe('Liège, Belgique')
    expect(results[1].match).toBe('partial')
  })

  it('answers 502 when the service is down', async () => {
    const app = createApp()
    await app.ready()
    prismaMock.treeMembership.findUnique.mockResolvedValue({ treeId: 'tree-1', userId: 'user-1', role: 'owner', tree: { deletedAt: null } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 503 })))

    const response = await app.inject({
      method: 'POST', url: '/trees/tree-1/search-sources/deces',
      headers: { authorization: `Bearer ${userToken(app)}` },
      payload: { firstName: 'Jean', lastName: 'Dupont' },
    })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: 'source_unavailable' })
  })

  it('tells apart an exhausted anonymous quota', async () => {
    const app = createApp()
    await app.ready()
    prismaMock.treeMembership.findUnique.mockResolvedValue({ treeId: 'tree-1', userId: 'user-1', role: 'owner', tree: { deletedAt: null } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"temporary anonymous usage expired"}', { status: 422 })))

    const response = await app.inject({
      method: 'POST', url: '/trees/tree-1/search-sources/deces',
      headers: { authorization: `Bearer ${userToken(app)}` },
      payload: { firstName: 'Jean', lastName: 'Dupont' },
    })
    expect(response.json()).toEqual({ error: 'source_quota' })
  })
})
