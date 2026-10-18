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

const URL_MEDIA = '/trees/tree-1/persons/person-1/media/media-1'

beforeAll(async () => {
  applyTestEnv()
  const module = await import('../src/app.js')
  createApp = module.createApp
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue(null)
  prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null })
  prismaMock.treeMembership.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    userId: 'user-1',
    role: 'owner',
    tree: { deletedAt: null, rootPersonId: null },
  })
  prismaMock.mediaItem.findFirst.mockResolvedValue({ id: 'media-1', type: 'photo', filePath: 'tree-1/person-1/media-1.jpg' })
  prismaMock.mediaItem.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.lifeEvent.findFirst.mockResolvedValue({ personId: 'person-1', unionId: null, status: 'approved' })
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
})

describe('PATCH media (modifier un souvenir)', () => {
  it('refuses a visitor', async () => {
    prismaMock.treeMembership.findUnique.mockResolvedValueOnce({ treeId: 'tree-1', userId: 'user-1', role: 'visitor', tree: { deletedAt: null } })
    const app = createApp()
    const token = await createUserToken(app)
    const response = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'Titre' } })
    expect(response.statusCode).toBe(403)
    expect(prismaMock.mediaItem.updateMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('refuses a contributor', async () => {
    prismaMock.treeMembership.findUnique.mockResolvedValueOnce({ treeId: 'tree-1', userId: 'user-1', role: 'contributor', tree: { deletedAt: null } })
    const app = createApp()
    const token = await createUserToken(app)
    const response = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'Titre' } })
    expect(response.statusCode).toBe(403)
    expect(prismaMock.mediaItem.updateMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('accepts an admin and updates title and life event', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const response = await app.inject({
      method: 'PATCH',
      url: URL_MEDIA,
      headers: { authorization: `Bearer ${token}` },
      payload: { caption: 'Mariage à Caen', lifeEventId: 'event-1' },
    })
    expect(response.statusCode).toBe(200)
    expect(prismaMock.mediaItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'media-1', treeId: 'tree-1', personId: 'person-1' }),
      data: { caption: 'Mariage à Caen', lifeEventId: 'event-1' },
    }))
    expect(response.json().media).toEqual({ id: 'media-1', caption: 'Mariage à Caen', lifeEventId: 'event-1' })
    await app.close()
  })

  it('clears the life event with null and keeps it when the key is absent', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'Photo', lifeEventId: null } })
    expect(prismaMock.mediaItem.updateMany.mock.calls.at(-1)?.[0].data).toEqual({ caption: 'Photo', lifeEventId: null })
    await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'Photo' } })
    expect(prismaMock.mediaItem.updateMany.mock.calls.at(-1)?.[0].data).toEqual({ caption: 'Photo' })
    await app.close()
  })

  it('rejects an empty title and a photo title above 280 characters', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const empty = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: '   ' } })
    expect(empty.statusCode).toBe(400)
    const long = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'a'.repeat(281) } })
    expect(long.statusCode).toBe(400)
    expect(long.json().error).toBe('caption_too_long')
    expect(prismaMock.mediaItem.updateMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('refuses a life event from another tree or another person', async () => {
    prismaMock.lifeEvent.findFirst.mockResolvedValueOnce(null)
    const app = createApp()
    const token = await createUserToken(app)
    const otherTree = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'Photo', lifeEventId: 'event-other-tree' } })
    expect(otherTree.statusCode).toBe(400)
    expect(otherTree.json().error).toBe('invalid_life_event_reference')

    prismaMock.lifeEvent.findFirst.mockResolvedValueOnce({ personId: 'person-2', unionId: null, status: 'approved' })
    const otherPerson = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'Photo', lifeEventId: 'event-2' } })
    expect(otherPerson.statusCode).toBe(400)
    expect(prismaMock.mediaItem.updateMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('accepts a life event of a union the person belongs to', async () => {
    prismaMock.lifeEvent.findFirst.mockResolvedValueOnce({ personId: null, unionId: 'union-1', status: 'approved' })
    prismaMock.union.findFirst.mockResolvedValueOnce({ partner1PersonId: 'person-1', partner2PersonId: 'person-9' })
    const app = createApp()
    const token = await createUserToken(app)
    const response = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'Photo', lifeEventId: 'event-union' } })
    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('returns 404 for a media that does not belong to the person', async () => {
    prismaMock.mediaItem.findFirst.mockResolvedValueOnce(null)
    const app = createApp()
    const token = await createUserToken(app)
    const response = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'Photo' } })
    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('rewrites the citation file with the same text as caption', async () => {
    prismaMock.mediaItem.findFirst.mockResolvedValueOnce({ id: 'media-1', type: 'citation', filePath: 'tree-1/person-1/media-1.txt' })
    const { writeFile } = await import('node:fs/promises')
    const app = createApp()
    const token = await createUserToken(app)
    const text = 'Il aimait la mer, « toujours »'
    const response = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: text } })
    expect(response.statusCode).toBe(200)
    const writes = (writeFile as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(writes.length).toBe(1)
    expect(String(writes[0][0])).toMatch(/media-1\.txt$/)
    expect(Buffer.from(writes[0][1] as Buffer).toString('utf8')).toBe(text)
    expect(prismaMock.mediaItem.updateMany.mock.calls.at(-1)?.[0].data).toEqual({
      caption: text,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
    })
    await app.close()
  })

  it('accepts a citation longer than 280 characters', async () => {
    prismaMock.mediaItem.findFirst.mockResolvedValueOnce({ id: 'media-1', type: 'citation', filePath: 'tree-1/person-1/media-1.txt' })
    const app = createApp()
    const token = await createUserToken(app)
    const response = await app.inject({ method: 'PATCH', url: URL_MEDIA, headers: { authorization: `Bearer ${token}` }, payload: { caption: 'b'.repeat(500) } })
    expect(response.statusCode).toBe(200)
    await app.close()
  })
})
