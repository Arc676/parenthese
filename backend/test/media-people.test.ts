import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn(),
      update: vi.fn(),
    },
    tree: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    treeMembership: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    treeSettings: {
      create: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    treeAccessPasswords: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    treeSharePassword: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    userTreeAccess: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    person: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    union: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    parentChildLink: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    mediaItem: {
      count: vi.fn(),      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    lifeEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    annotation: {
      findMany: vi.fn(),
    },
    contributionSession: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn(),
    },
    contributionChange: {
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    mediaPersonTag: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}))

let createApp: () => FastifyInstance

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(async () => undefined), mkdir: vi.fn(async () => undefined) }
})

function applyTestEnv(): void {
  process.env.NODE_ENV = 'test'
  process.env.PORT = '4000'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.JWT_EXPIRES_IN = '7d'
  process.env.JWT_TREE_ACCESS_EXPIRES_IN = '24h'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
}

async function createUserToken(app: FastifyInstance, userId = 'user-1'): Promise<string> {
  await app.ready()
  return (app as any).jwt.sign(
    { kind: 'user', sub: userId, jti: randomUUID(), userId, email: 'user@example.com' },
    { expiresIn: '1h' },
  )
}

const URL_PEOPLE = '/trees/tree-1/media/media-1/people'

beforeAll(async () => {
  applyTestEnv()
  const module = await import('../src/app.js')
  createApp = module.createApp
})

function setRole(role: string) {
  prismaMock.treeMembership.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    userId: 'user-1',
    role,
    contributionModeOverride: null,
    tree: { deletedAt: null, rootPersonId: null, settings: { memberContributionPolicy: 'pending' } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue(null)
  prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null })
  setRole('owner')
  prismaMock.mediaItem.findFirst.mockResolvedValue({ id: 'media-1', personId: 'person-1' })
  prismaMock.person.count.mockImplementation(async ({ where }: any) => where.id.in.length)
  prismaMock.person.findMany.mockImplementation(async ({ where }: any) => where.id.in.map((id: string) => ({ id })))
  prismaMock.mediaPersonTag.findMany.mockResolvedValue([{ personId: 'person-2', x: null, y: null }])
  prismaMock.mediaPersonTag.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.mediaPersonTag.createMany.mockResolvedValue({ count: 2 })
  prismaMock.contributionSession.count.mockResolvedValue(0)
  prismaMock.contributionSession.create.mockResolvedValue({ id: 'session-1' })
  prismaMock.contributionChange.create.mockResolvedValue({ id: 'change-1' })
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

const PEOPLE = [
  { personId: 'person-2', x: 0.25, y: 0.4 },
  { personId: 'person-3' },
]

async function put(app: FastifyInstance, payload: unknown) {
  const token = await createUserToken(app)
  return app.inject({ method: 'PUT', url: URL_PEOPLE, headers: { authorization: `Bearer ${token}` }, payload })
}

describe('PUT media people (identifier des personnes sur un souvenir)', () => {
  it('saves directly for an admin, without a contribution session', async () => {
    const app = createApp()
    const response = await put(app, { people: PEOPLE })
    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('approved')
    expect(prismaMock.mediaPersonTag.deleteMany).toHaveBeenCalledWith({ where: { treeId: 'tree-1', mediaId: 'media-1' } })
    const created = prismaMock.mediaPersonTag.createMany.mock.calls[0][0].data
    expect(created.map((tag: any) => [tag.personId, tag.x, tag.y])).toEqual([['person-2', 0.25, 0.4], ['person-3', null, null]])
    expect(prismaMock.contributionSession.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('turns a contributor request into a pending proposal, nothing applied', async () => {
    setRole('contributor')
    const app = createApp()
    const response = await put(app, { people: PEOPLE, submittedByLabel: 'Lucie' })
    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('pending')
    expect(prismaMock.mediaPersonTag.createMany).not.toHaveBeenCalled()
    expect(prismaMock.mediaPersonTag.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.contributionSession.create.mock.calls[0][0].data).toMatchObject({ status: 'pending', submittedByLabel: 'Lucie' })
    const change = prismaMock.contributionChange.create.mock.calls[0][0].data
    expect(change).toMatchObject({ entityType: 'media_people', entityId: 'media-1', action: 'update' })
    expect(change.beforeJson.people).toEqual([{ personId: 'person-2', x: null, y: null }])
    expect(change.afterJson.people).toHaveLength(2)
    await app.close()
  })

  it('refuses a person from another tree', async () => {
    prismaMock.person.count.mockResolvedValueOnce(1)
    const app = createApp()
    const response = await put(app, { people: PEOPLE })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_person_reference')
    expect(prismaMock.mediaPersonTag.createMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('answers 404 for a missing or pending souvenir', async () => {
    prismaMock.mediaItem.findFirst.mockResolvedValueOnce(null)
    const app = createApp()
    const response = await put(app, { people: PEOPLE })
    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('rejects a duplicate person, a lone coordinate and a point outside the photo', async () => {
    const app = createApp()
    const duplicate = await put(app, { people: [{ personId: 'person-2' }, { personId: 'person-2' }] })
    expect(duplicate.statusCode).toBe(400)
    const lone = await put(app, { people: [{ personId: 'person-2', x: 0.5 }] })
    expect(lone.statusCode).toBe(400)
    const outside = await put(app, { people: [{ personId: 'person-2', x: 1.2, y: 0.5 }] })
    expect(outside.statusCode).toBe(400)
    expect(prismaMock.mediaPersonTag.createMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('clears every identification with an empty list', async () => {
    const app = createApp()
    const response = await put(app, { people: [] })
    expect(response.statusCode).toBe(200)
    expect(prismaMock.mediaPersonTag.deleteMany).toHaveBeenCalled()
    expect(prismaMock.mediaPersonTag.createMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('requires a session', async () => {
    const app = createApp()
    await app.ready()
    const response = await app.inject({ method: 'PUT', url: URL_PEOPLE, payload: { people: [] } })
    expect(response.statusCode).toBe(401)
    await app.close()
  })
})
