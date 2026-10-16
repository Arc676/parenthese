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

// Vraie image d'un pixel : le serveur reconnaît les fichiers à leurs octets, plus au type déclaré
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')

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
    {
      kind: 'user',
      sub: userId,
      jti: randomUUID(),
      userId,
      email: 'user@example.com',
    },
    {
      expiresIn: '1h',
    },
  )
}

beforeAll(async () => {
  applyTestEnv()
  const module = await import('../src/app.js')
  createApp = module.createApp
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.userTreeAccess.deleteMany?.mockResolvedValue({ count: 0 })
  prismaMock.contributionSession.updateMany?.mockResolvedValue({ count: 1 })
  prismaMock.mediaItem.aggregate?.mockResolvedValue({ _sum: { sizeBytes: 0 } })

  prismaMock.user.findUnique.mockResolvedValue(null)
  prismaMock.user.create.mockResolvedValue({ id: 'user-1', email: 'user@example.com' })
  prismaMock.user.update.mockResolvedValue({ id: 'user-1' })

  prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null })
  prismaMock.tree.findUnique.mockResolvedValue({ id: 'tree-1', slug: 'tree-1', name: 'Tree' })
  prismaMock.tree.create.mockResolvedValue({ id: 'tree-1', slug: 'tree-1', name: 'Tree' })
  prismaMock.tree.updateMany.mockResolvedValue({ count: 1 })

  prismaMock.treeMembership.findMany.mockResolvedValue([])
  prismaMock.treeMembership.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    userId: 'user-1',
    role: 'owner',
    tree: { deletedAt: null, rootPersonId: null },
  })

  prismaMock.treeAccessPasswords.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    visitorHash: 'hash',
    contributorHash: 'hash',
    updatedAt: new Date('2026-02-11T10:00:00.000Z'),
    tree: { deletedAt: null },
  })
  prismaMock.userTreeAccess.findMany.mockResolvedValue([])
  prismaMock.userTreeAccess.findUnique.mockResolvedValue(null)
  prismaMock.userTreeAccess.upsert.mockResolvedValue({
    id: 'share-1',
    treeId: 'tree-1',
    userId: 'user-1',
    role: 'visitor',
  })
  prismaMock.userTreeAccess.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.treeAccessPasswords.update.mockResolvedValue({ treeId: 'tree-1' })
  prismaMock.treeSharePassword.findUnique.mockResolvedValue(null)
  prismaMock.treeSharePassword.upsert.mockResolvedValue({ treeId: 'tree-1' })
  prismaMock.treeSharePassword.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.treeSettings.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    memberContributionPolicy: 'pending',
    visitorPolicy: 'read_only',
    contributorPolicy: 'pending',
  })
  prismaMock.treeSettings.upsert.mockResolvedValue({
    treeId: 'tree-1',
    memberContributionPolicy: 'direct',
    visitorPolicy: 'read_only',
    contributorPolicy: 'pending',
  })

  prismaMock.person.findMany.mockResolvedValue([])
  prismaMock.person.findFirst.mockImplementation(async (args: any) => ({
    id: args?.where?.id || 'person-1',
    treeId: 'tree-1',
    deletedAt: null,
  }))
  prismaMock.person.create.mockResolvedValue({ id: 'person-1' })
  prismaMock.person.count.mockResolvedValue(2)
  prismaMock.person.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.union.findMany.mockResolvedValue([
    {
      id: 'union-1',
      partner1PersonId: 'person-1',
      partner2PersonId: null,
      treeId: 'tree-1',
      deletedAt: null,
    },
  ])
  prismaMock.union.findFirst.mockResolvedValue({
    id: 'union-1',
    partner1PersonId: 'person-1',
    partner2PersonId: null,
    treeId: 'tree-1',
    deletedAt: null,
  })
  prismaMock.union.create.mockResolvedValue({ id: 'union-1' })
  prismaMock.union.count.mockResolvedValue(1)
  prismaMock.union.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.parentChildLink.findMany.mockResolvedValue([])
  prismaMock.parentChildLink.findFirst.mockResolvedValue({
    id: 'link-1',
    treeId: 'tree-1',
    parentPersonId: 'person-1',
    childPersonId: 'person-2',
    viaUnionId: 'union-1',
    deletedAt: null,
  })
  prismaMock.parentChildLink.create.mockResolvedValue({ id: 'link-1' })
  prismaMock.parentChildLink.count.mockResolvedValue(1)
  prismaMock.parentChildLink.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.mediaItem.count.mockResolvedValue(0)
  prismaMock.mediaItem.create.mockResolvedValue({ id: 'media-1' })
  prismaMock.mediaItem.findMany.mockResolvedValue([])
  prismaMock.mediaItem.findFirst.mockResolvedValue({ id: 'media-1', filePath: 'tree-1/person-1/media-1.jpg', mimeType: 'image/jpeg' })
  prismaMock.mediaItem.update.mockResolvedValue({ id: 'media-1' })
  prismaMock.mediaItem.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.annotation.findMany.mockResolvedValue([])
  prismaMock.contributionSession.create.mockResolvedValue({
    id: 'session-1',
    treeId: 'tree-1',
    status: 'pending',
  })
  prismaMock.contributionSession.findMany.mockResolvedValue([])
  prismaMock.contributionSession.findFirst.mockResolvedValue({
    id: 'session-1',
    treeId: 'tree-1',
    status: 'pending',
    changes: [],
  })
  prismaMock.contributionSession.update.mockResolvedValue({
    id: 'session-1',
    treeId: 'tree-1',
    status: 'approved',
  })
  prismaMock.contributionSession.count.mockResolvedValue(0)
  prismaMock.contributionChange.create.mockResolvedValue({ id: 'change-1' })
  prismaMock.contributionChange.update.mockResolvedValue({ id: 'change-1' })
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  prismaMock.auditLog.findMany.mockResolvedValue([])
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock))
  prismaMock.$disconnect.mockResolvedValue(undefined)
})

describe('API security and authz', () => {
  it('rate-limits login endpoint', async () => {
    const app = createApp()

    for (let i = 0; i < 10; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@example.com', password: 'password123' },
      })
    }

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@example.com', password: 'password123' },
    })

    expect(response.statusCode).toBe(429)
    await app.close()
  })

  it('rate-limits register endpoint', async () => {
    const app = createApp()
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing-user' })

    for (let i = 0; i < 20; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: `user${i}@example.com`, password: 'password123' },
      })
    }

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'overflow@example.com', password: 'password123' },
    })

    expect(response.statusCode).toBe(429)
    await app.close()
  }, 15000)

  it('revokes user token on logout', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(logoutResponse.statusCode).toBe(200)

    const treesResponse = await app.inject({
      method: 'GET',
      url: '/trees',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(treesResponse.statusCode).toBe(401)
    await app.close()
  })

  it('rejects stale tree access tokens after access secret changes', async () => {
    const app = createApp()
    await app.ready()

    prismaMock.treeAccessPasswords.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      visitorHash: 'hash',
      contributorHash: 'hash',
      updatedAt: new Date('2026-02-12T10:00:00.000Z'),
      tree: { deletedAt: null },
    })

    const staleTreeAccessToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:visitor',
      treeId: 'tree-1',
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
      headers: { authorization: `Bearer ${staleTreeAccessToken}` },
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('does not update soft-deleted tree metadata', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.tree.updateMany.mockResolvedValue({ count: 0 })

    const response = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Updated Name' },
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it('validates rootPersonId belongs to tree before patching tree metadata', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.person.findFirst.mockResolvedValue(null)

    const response = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1',
      headers: { authorization: `Bearer ${token}` },
      payload: { rootPersonId: 'missing-person' },
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('allows owner to create persons, unions and links', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const personResponse = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons',
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Alice', lastName: 'Martin' },
    })

    const unionResponse = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/unions',
      headers: { authorization: `Bearer ${token}` },
      payload: { partner1PersonId: 'person-1', partner2PersonId: 'person-2' },
    })

    const linkResponse = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/links',
      headers: { authorization: `Bearer ${token}` },
      payload: { parentPersonId: 'person-1', childPersonId: 'person-2', viaUnionId: 'union-1' },
    })

    expect(personResponse.statusCode).toBe(201)
    expect(unionResponse.statusCode).toBe(201)
    expect(linkResponse.statusCode).toBe(201)
    await app.close()
  })

  it('forbids member from creating persons', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      userId: 'user-1',
      role: 'member',
      tree: { deletedAt: null, rootPersonId: null },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons',
      headers: { authorization: `Bearer ${token}` },
      payload: { firstName: 'Alice', lastName: 'Martin' },
    })

    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('allows owner to patch and soft-delete a person', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/persons/person-1',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        firstName: 'Alice',
        notes: 'Mise a jour',
      },
    })

    expect(patchResponse.statusCode).toBe(200)
    expect(prismaMock.person.updateMany).toHaveBeenCalled()

    prismaMock.union.updateMany.mockResolvedValueOnce({ count: 2 })
    prismaMock.parentChildLink.updateMany.mockResolvedValueOnce({ count: 3 })
    prismaMock.mediaItem.updateMany.mockResolvedValueOnce({ count: 1 })

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/trees/tree-1/persons/person-1',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(deleteResponse.statusCode).toBe(200)
    expect(deleteResponse.json()).toEqual({
      ok: true,
      cascaded: {
        unions: 2,
        links: 3,
        medias: 1,
      },
    })
    await app.close()
  })

  it('allows owner to patch union and link entities', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const patchUnionResponse = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/unions/union-1',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        unionType: 'mariage',
      },
    })

    expect(patchUnionResponse.statusCode).toBe(200)
    expect(prismaMock.union.updateMany).toHaveBeenCalled()

    const patchLinkResponse = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/links/link-1',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        parentageType: 'adoption',
      },
    })

    expect(patchLinkResponse.statusCode).toBe(200)
    expect(prismaMock.parentChildLink.updateMany).toHaveBeenCalled()
    await app.close()
  })

  it('forbids member from patching person records', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      userId: 'user-1',
      role: 'member',
      tree: { deletedAt: null, rootPersonId: null },
    })

    const response = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/persons/person-1',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        firstName: 'Alice',
      },
    })

    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('allows contributor access token to submit a pending contribution session', async () => {
    const app = createApp()
    await app.ready()

    const contributorToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:contributor',
      treeId: 'tree-1',
      role: 'contributor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    prismaMock.tree.findFirst.mockResolvedValue({
      id: 'tree-1',
      rootPersonId: null,
      settings: {
        contributorPolicy: 'pending',
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${contributorToken}` },
      payload: {
        title: 'Ajout photo branche maternelle',
        changes: [
          {
            entityType: 'person',
            action: 'create',
            after: { firstName: 'Alice', lastName: 'Martin' },
          },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.contributionSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
          mode: 'tree_access',
        }),
      }),
    )
    await app.close()
  })

  // Mot de passe de partage unique (25/09/2026)
  it('opens as contributor with the old visitor password', async () => {
    const { hashPassword } = await import('../src/lib/auth')
    const app = createApp()
    await app.ready()

    prismaMock.treeAccessPasswords.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      visitorHash: await hashPassword('regarder-seulement'),
      contributorHash: await hashPassword('ajouter-aussi'),
      updatedAt: new Date('2026-02-11T10:00:00.000Z'),
      tree: { deletedAt: null },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/access/unlock',
      payload: { password: 'regarder-seulement' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().role).toBe('contributor')
    const payload = (app as any).jwt.decode(response.json().token)
    expect(payload.role).toBe('contributor')
    await app.close()
  })

  it('accepts the share password typed with a phone apostrophe and a trailing space', async () => {
    const { hashPassword } = await import('../src/lib/auth')
    const app = createApp()
    await app.ready()

    const hash = await hashPassword("Lavenuedel'Avenir")
    prismaMock.treeAccessPasswords.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      visitorHash: hash,
      contributorHash: hash,
      updatedAt: new Date('2026-02-11T10:00:00.000Z'),
      tree: { deletedAt: null },
    })

    for (const typed of ['Lavenuedel’Avenir', "Lavenuedel'Avenir ", 'Lavenuedel’Avenir ']) {
      const response = await app.inject({
        method: 'POST',
        url: '/trees/tree-1/access/unlock',
        payload: { password: typed },
      })
      expect(response.statusCode, JSON.stringify(typed)).toBe(200)
    }

    const wrong = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/access/unlock',
      payload: { password: 'lavenuedel’avenir' },
    })
    expect(wrong.statusCode).toBe(401)
    await app.close()
  }, 30000) // une dizaine de vérifications bcrypt, lentes sur la machine de CI

  it('still rejects a wrong share password', async () => {
    const { hashPassword } = await import('../src/lib/auth')
    const app = createApp()
    await app.ready()

    prismaMock.treeAccessPasswords.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      visitorHash: await hashPassword('regarder-seulement'),
      contributorHash: await hashPassword('ajouter-aussi'),
      updatedAt: new Date('2026-02-11T10:00:00.000Z'),
      tree: { deletedAt: null },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/access/unlock',
      payload: { password: 'pas-le-bon' },
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('lets an older visitor access token submit a contribution', async () => {
    const app = createApp()
    await app.ready()

    const visitorToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:visitor',
      treeId: 'tree-1',
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    prismaMock.tree.findFirst.mockResolvedValue({
      id: 'tree-1',
      rootPersonId: null,
      settings: { contributorPolicy: 'pending' },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${visitorToken}` },
      payload: {
        title: 'Ajout depuis un ancien accès visiteur',
        changes: [
          { entityType: 'person', action: 'create', after: { firstName: 'Alice', lastName: 'Martin' } },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    await app.close()
  })

  it('writes the single share password into both hashes', async () => {
    const { verifyPassword } = await import('../src/lib/auth')
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/access/passwords',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'un-seul-mot-de-passe' },
    })

    expect(response.statusCode).toBe(200)
    const data = prismaMock.treeAccessPasswords.update.mock.calls.at(-1)?.[0]?.data
    expect(data.visitorHash).toBe(data.contributorHash)
    expect(await verifyPassword('un-seul-mot-de-passe', data.contributorHash)).toBe(true)
    await app.close()
  })

  // Mot de passe toujours à jour chez le propriétaire (25/09/2026) : gardé chiffré par le serveur
  it('keeps the new share password readable for the owner', async () => {
    const { decryptSharePassword } = await import('../src/lib/share-password')
    const app = createApp()
    const token = await createUserToken(app)

    await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/access/passwords',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'lilas-en-avril' },
    })

    const stored = prismaMock.treeSharePassword.upsert.mock.calls.at(-1)?.[0]?.create?.passwordEnc
    expect(stored).not.toContain('lilas-en-avril')
    expect(decryptSharePassword(stored)).toBe('lilas-en-avril')

    prismaMock.treeSharePassword.findUnique.mockResolvedValue({ treeId: 'tree-1', passwordEnc: stored })
    const read = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/access/passwords',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(read.statusCode).toBe(200)
    expect(read.json().share).toBe('lilas-en-avril')
    await app.close()
  })

  it('forgets the readable password when two different passwords are set', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/access/passwords',
      headers: { authorization: `Bearer ${token}` },
      payload: { visitorPassword: 'regarder-seul' },
    })

    expect(prismaMock.treeSharePassword.deleteMany).toHaveBeenCalledWith({ where: { treeId: 'tree-1' } })
    expect(prismaMock.treeSharePassword.upsert).not.toHaveBeenCalled()
    await app.close()
  })

  it('remembers the current password without changing access', async () => {
    const { hashPassword } = await import('../src/lib/auth')
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeAccessPasswords.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      visitorHash: await hashPassword('ancien-visiteur'),
      contributorHash: await hashPassword('celui-de-la-famille'),
      updatedAt: new Date('2026-02-11T10:00:00.000Z'),
      tree: { deletedAt: null },
    })

    const wrong = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/access/passwords/remember',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'pas-le-bon' },
    })
    expect(wrong.statusCode).toBe(422)
    expect(prismaMock.treeSharePassword.upsert).not.toHaveBeenCalled()

    const right = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/access/passwords/remember',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'celui-de-la-famille' },
    })
    expect(right.statusCode).toBe(200)
    expect(right.json().share).toBe('celui-de-la-famille')
    expect(prismaMock.treeSharePassword.upsert).toHaveBeenCalledTimes(1)
    expect(prismaMock.treeAccessPasswords.update).not.toHaveBeenCalled()
    await app.close()
  })

  it('refuses the readable password to anyone but an admin', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue(null)

    const read = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/access/passwords',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(read.statusCode).toBe(403)

    const anonymous = await app.inject({ method: 'GET', url: '/trees/tree-1/access/passwords' })
    expect(anonymous.statusCode).toBe(401)
    await app.close()
  })

  // Contributions fiables (25/09/2026) : mot d'accompagnement, liens d'une personne ajoutée
  const signShareToken = (app: any) => app.jwt.sign({
    kind: 'tree_access',
    sub: 'tree:tree-1:contributor',
    treeId: 'tree-1',
    role: 'contributor',
    accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
  })

  it('stores the contributor first name and comment', async () => {
    const app = createApp()
    await app.ready()
    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null, settings: { contributorPolicy: 'pending' } })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${signShareToken(app)}` },
      payload: {
        title: 'Contribution de Camille',
        submittedByLabel: 'Camille',
        comment: "J'ai ajouté mon cousin",
        changes: [{ entityType: 'person', action: 'create', after: { firstName: 'Léon', lastName: 'Martin' } }],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.contributionSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submittedByLabel: 'Camille', comment: "J'ai ajouté mon cousin" }) }),
    )
    await app.close()
  })

  it('links a person added in the same contribution, even when the link comes first', async () => {
    const app = createApp()
    await app.ready()
    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null, settings: { contributorPolicy: 'direct' } })
    prismaMock.person.create.mockResolvedValue({ id: 'person-new' })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${signShareToken(app)}` },
      payload: {
        title: 'Un enfant pour Alice',
        changes: [
          { entityType: 'parent_child_link', action: 'create', after: { parentPersonId: 'person-1', childPersonId: 'tmp:léon', parentageType: 'biologique' } },
          { entityType: 'person', action: 'create', after: { ref: 'tmp:léon', firstName: 'Léon', lastName: 'Martin' } },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.parentChildLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parentPersonId: 'person-1', childPersonId: 'person-new' }) }),
    )
    expect(prismaMock.$transaction).toHaveBeenCalled()
    await app.close()
  })

  it('drops the link of a rejected new person instead of failing the review', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.contributionSession.findFirst.mockResolvedValue({
      id: 'session-1',
      treeId: 'tree-1',
      status: 'pending',
      changes: [
        { id: 'change-link', entityType: 'parent_child_link', action: 'create', entityId: null, beforeJson: null, afterJson: { parentPersonId: 'person-1', childPersonId: 'tmp:léon' }, conflictState: 'none' },
        { id: 'change-person', entityType: 'person', action: 'create', entityId: null, beforeJson: null, afterJson: { ref: 'tmp:léon', firstName: 'Léon', lastName: 'Martin' }, conflictState: 'none' },
      ],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions/session-1/review',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        decision: 'approved',
        changeDecisions: [{ changeId: 'change-person', decision: 'rejected' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(prismaMock.parentChildLink.create).not.toHaveBeenCalled()
    expect(prismaMock.contributionChange.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'change-link' }, data: { decision: 'rejected' } }),
    )
    await app.close()
  })

  it('refuses a link to an unknown provisional person at submission', async () => {
    const app = createApp()
    await app.ready()
    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null, settings: { contributorPolicy: 'direct' } })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${signShareToken(app)}` },
      payload: {
        title: 'Lien orphelin',
        changes: [{ entityType: 'parent_child_link', action: 'create', after: { parentPersonId: 'person-1', childPersonId: 'tmp:personne' } }],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('unresolved_reference')
    await app.close()
  })

  it('allows admin to list pending contribution sessions', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.contributionSession.findMany.mockResolvedValue([
      {
        id: 'session-1',
        treeId: 'tree-1',
        status: 'pending',
        title: 'Session pending',
        changes: [],
      },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/contributions/sessions?status=pending',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      sessions: [
        {
          id: 'session-1',
          treeId: 'tree-1',
          status: 'pending',
          title: 'Session pending',
          changes: [],
        },
      ],
    })
    await app.close()
  })

  it('forbids non-admin user from listing contribution sessions', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      userId: 'user-1',
      role: 'member',
      tree: { deletedAt: null, rootPersonId: null },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('allows admin to review a contribution session', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    prismaMock.contributionSession.findFirst.mockResolvedValue({
      id: 'session-1',
      treeId: 'tree-1',
      status: 'pending',
      changes: [
        {
          id: 'change-1',
          entityType: 'person',
          action: 'create',
          entityId: null,
          beforeJson: null,
          afterJson: { firstName: 'Alice', lastName: 'Martin' },
          conflictState: 'none',
        },
      ],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions/session-1/review',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        decision: 'approved',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(prismaMock.contributionSession.update).toHaveBeenCalled()
    expect(prismaMock.contributionChange.update).toHaveBeenCalled()
    await app.close()
  })

  it('allows owner to upload media below image limit', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'photo',
        fileName: 'portrait.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: PNG_1PX.length,
        dataBase64: PNG_1PX.toString('base64'),
        caption: 'Portrait famille',
      },
    })

    expect(response.statusCode).toBe(201)
    await app.close()
  })

  it('rejects image upload above 5MB', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const tooBig = Buffer.alloc((5 * 1024 * 1024) + 1, 1)

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'photo',
        fileName: 'big.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: tooBig.length,
        dataBase64: tooBig.toString('base64'),
      },
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  // Souvenirs de la famille (25/09/2026) : un non-administrateur propose, le propriétaire valide
  const photoPayload = {
    type: 'photo',
    fileName: 'portrait.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: PNG_1PX.length,
    dataBase64: PNG_1PX.toString('base64'),
  }

  it('turns a member media upload into a pending contribution', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      userId: 'user-1',
      role: 'member',
      contributionModeOverride: null,
      tree: { deletedAt: null, rootPersonId: null, settings: { memberContributionPolicy: 'pending' } },
    })
    prismaMock.person.findFirst.mockResolvedValue({ id: 'person-1', firstName: 'Jeanne' })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${token}` },
      payload: photoPayload,
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.mediaItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending', displayOrder: 0, isFeatured: false }) }),
    )
    await app.close()
  })

  it('lets a share link visitor propose a photo, pending review', async () => {
    const app = createApp()
    await app.ready()
    const shareToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:visitor',
      treeId: 'tree-1',
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })
    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null, settings: { contributorPolicy: 'pending' } })
    prismaMock.person.findFirst.mockResolvedValue({ id: 'person-1', firstName: 'Jeanne' })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${shareToken}` },
      payload: { ...photoPayload, submittedByLabel: 'Camille' },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.contributionSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
          mode: 'tree_access',
          submittedByLabel: 'Camille',
          title: 'Souvenir pour Jeanne',
        }),
      }),
    )
    expect(prismaMock.mediaItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', contributionSessionId: 'session-1', uploadedBy: null }),
      }),
    )
    expect(prismaMock.contributionChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entityType: 'media', action: 'create', sessionId: 'session-1' }),
      }),
    )
    await app.close()
  })

  it('shows a family photo at once when the tree applies contributions directly', async () => {
    const app = createApp()
    await app.ready()
    const shareToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:contributor',
      treeId: 'tree-1',
      role: 'contributor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })
    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null, settings: { contributorPolicy: 'direct' } })
    prismaMock.person.findFirst.mockResolvedValue({ id: 'person-1', firstName: 'Jeanne' })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${shareToken}` },
      payload: photoPayload,
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.mediaItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }),
    )
    expect(prismaMock.contributionChange.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityType: 'media', decision: 'approved' }) }),
    )
    await app.close()
  })

  it('refuses a media upload from a share token of another tree', async () => {
    const app = createApp()
    await app.ready()
    const otherTreeToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-2:contributor',
      treeId: 'tree-2',
      role: 'contributor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${otherTreeToken}` },
      payload: photoPayload,
    })

    expect(response.statusCode).toBeGreaterThanOrEqual(401)
    expect(response.statusCode).toBeLessThanOrEqual(403)
    expect(prismaMock.mediaItem.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects media changes submitted through the contribution session route', async () => {
    const app = createApp()
    await app.ready()
    const shareToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:contributor',
      treeId: 'tree-1',
      role: 'contributor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${shareToken}` },
      payload: { title: 'Tentative', changes: [{ entityType: 'media', action: 'create', entityId: 'media-9' }] },
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('makes an approved family photo visible at review', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.contributionSession.findFirst.mockResolvedValue({
      id: 'session-1',
      treeId: 'tree-1',
      status: 'pending',
      changes: [
        { id: 'change-1', entityType: 'media', action: 'create', entityId: 'media-1', beforeJson: null, afterJson: { personId: 'person-1' }, conflictState: 'none' },
      ],
    })
    prismaMock.mediaItem.findFirst.mockResolvedValue({ id: 'media-1', personId: 'person-1' })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions/session-1/review',
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: 'approved' },
    })

    expect(response.statusCode).toBe(200)
    expect(prismaMock.mediaItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'media-1' }, data: expect.objectContaining({ status: 'approved' }) }),
    )
    await app.close()
  })

  it('hides a rejected family photo at review', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.contributionSession.findFirst.mockResolvedValue({
      id: 'session-1',
      treeId: 'tree-1',
      status: 'pending',
      changes: [
        { id: 'change-1', entityType: 'media', action: 'create', entityId: 'media-1', beforeJson: null, afterJson: { personId: 'person-1' }, conflictState: 'none' },
      ],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions/session-1/review',
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: 'rejected' },
    })

    expect(response.statusCode).toBe(200)
    expect(prismaMock.mediaItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'media-1', treeId: 'tree-1' }, data: expect.objectContaining({ status: 'rejected' }) }),
    )
    await app.close()
  })

  it('reviews a session containing a drawing without failing', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.contributionSession.findFirst.mockResolvedValue({
      id: 'session-1',
      treeId: 'tree-1',
      status: 'pending',
      changes: [
        { id: 'change-1', entityType: 'annotation', action: 'create', entityId: 'annot-1', beforeJson: null, afterJson: { type: 'drawing', x: 0, y: 0 }, conflictState: 'none' },
      ],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions/session-1/review',
      headers: { authorization: `Bearer ${token}` },
      payload: { decision: 'approved' },
    })

    expect(response.statusCode).toBe(200)
    await app.close()
  })

  it('allows owner to upload citation without file payload', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'citation',
        caption: 'Le passe guide l avenir',
        source: 'Journal familial',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.mediaItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'citation',
          mimeType: 'text/plain',
          caption: 'Le passe guide l avenir',
          source: 'Journal familial',
        }),
      }),
    )
    await app.close()
  })

  it('allows owner to upload geojson media', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const geojsonText = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [2.35, 48.85] },
          properties: { label: 'Paris' },
        },
      ],
    })

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'geojson',
        fileName: 'migration.geojson',
        mimeType: 'application/geo+json',
        sizeBytes: Buffer.byteLength(geojsonText),
        dataBase64: Buffer.from(geojsonText).toString('base64'),
        caption: 'Migration',
      },
    })

    expect(response.statusCode).toBe(201)
    await app.close()
  })

  it('rejects a gpx upload whose content is not a gpx track', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons/person-1/media',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: 'gpx',
        fileName: 'trace.gpx',
        mimeType: 'application/gpx+xml',
        sizeBytes: PNG_1PX.length,
        dataBase64: PNG_1PX.toString('base64'),
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_media_mime_type')
    await app.close()
  })

  it('allows owner to read tree stats', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    prismaMock.mediaItem.count.mockResolvedValue(3)
    prismaMock.contributionSession.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(9)

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/stats',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      stats: {
        persons: 2,
        unions: 1,
        filiations: 1,
        medias: 3,
        pendingContributions: 4,
        totalContributions: 9,
      },
    })
    await app.close()
  })

  it('forbids non-admin from reading tree stats', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue({
      treeId: 'tree-1',
      userId: 'user-1',
      role: 'member',
      tree: { deletedAt: null, rootPersonId: null },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/stats',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('allows owner to update tree settings policy', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        memberContributionPolicy: 'direct',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(prismaMock.treeSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { treeId: 'tree-1' },
        update: expect.objectContaining({
          memberContributionPolicy: 'direct',
        }),
      }),
    )
    expect(prismaMock.auditLog.create).toHaveBeenCalled()
    await app.close()
  })

  it('lists audit logs for admin with pagination cursor', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-2',
        treeId: 'tree-1',
        actorType: 'user',
        actorId: 'user-1',
        action: 'tree_settings_updated',
        entityType: 'tree_settings',
        entityId: 'tree-1',
        payloadJson: { memberContributionPolicy: 'direct' },
        createdAt: new Date('2026-02-11T12:00:00.000Z'),
      },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/audit?limit=20&offset=0',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      logs: [
        {
          id: 'audit-2',
          treeId: 'tree-1',
          actorType: 'user',
          actorId: 'user-1',
          action: 'tree_settings_updated',
          entityType: 'tree_settings',
          entityId: 'tree-1',
          payloadJson: { memberContributionPolicy: 'direct' },
          createdAt: '2026-02-11T12:00:00.000Z',
        },
      ],
      nextOffset: null,
    })
    await app.close()
  })

  // Audit 1.0 (30/09/2026)
  it('refuses the annotations of a tree the account has no access to', async () => {
    const app = createApp()
    const token = await createUserToken(app, 'stranger')
    prismaMock.treeMembership.findUnique.mockResolvedValue(null)
    prismaMock.userTreeAccess.findUnique.mockResolvedValue(null)

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/annotations',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
    expect(prismaMock.annotation.findMany).not.toHaveBeenCalled()
    await app.close()
  })

  it('no longer accepts an account session in a media address', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'GET',
      url: `/trees/tree-1/media/media-1?token=${encodeURIComponent(token)}`,
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('cuts accounts linked by the share password when the owner changes it', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PATCH',
      url: '/trees/tree-1/access/passwords',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'nouveau-mot-de-passe' },
    })

    expect(response.statusCode).toBe(200)
    expect(prismaMock.userTreeAccess.deleteMany).toHaveBeenCalledWith({ where: { treeId: 'tree-1' } })
    await app.close()
  })

  it('masks tokens in logged addresses', async () => {
    const { redactUrl } = await import('../src/app.js')
    expect(redactUrl('/trees/t/media/m?token=abc.def&v=2')).toBe('/trees/t/media/m?token=[masqué]&v=2')
  })
})
