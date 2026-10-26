import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    // Sessions fermées (lib/token-revocation.ts), rechargées au démarrage
    revokedSession: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    tree: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    treeMembership: {
      findUnique: vi.fn(),
    },
    treeAccessPasswords: {
      findUnique: vi.fn(),
    },
    contributionSession: {
      updateMany: vi.fn(),
    },
    treeVisit: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}))

const PASSWORD = 'correct-password'

// user-1 possède deux arbres (dont un déjà marqué supprimé) et n'est que membre du troisième.
const TREES = [
  { id: 'tree-owned', ownerUserId: 'user-1' },
  { id: 'tree-owned-archived', ownerUserId: 'user-1' },
  { id: 'tree-member', ownerUserId: 'user-2' },
]

let storageRoot = ''
let passwordHash = ''
let createApp: () => FastifyInstance
let resolveTreeMediaDirectory: (treeId: string, root?: string) => string | null
let env: { PASSWORD_LOGIN: boolean }

function applyTestEnv(): void {
  process.env.NODE_ENV = 'test'
  process.env.PORT = '4000'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.JWT_EXPIRES_IN = '7d'
  process.env.JWT_TREE_ACCESS_EXPIRES_IN = '24h'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
  process.env.MEDIA_STORAGE_PATH = storageRoot
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

async function writeMediaFile(treeId: string, relativePath: string): Promise<string> {
  const filePath = path.join(storageRoot, treeId, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, 'media')
  return filePath
}

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), 'parenthese-purge-'))
  applyTestEnv()

  const authModule = await import('../src/lib/auth.js')
  passwordHash = await authModule.hashPassword(PASSWORD)

  createApp = (await import('../src/app.js')).createApp
  resolveTreeMediaDirectory = (await import('../src/lib/tree-purge.js')).resolveTreeMediaDirectory
  ;({ env } = await import('../src/config/env.js'))
})

afterAll(async () => {
  await rm(storageRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  vi.clearAllMocks()
  await rm(storageRoot, { recursive: true, force: true })
  await mkdir(storageRoot, { recursive: true })

  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', passwordHash })
  prismaMock.user.count.mockResolvedValue(1)
  prismaMock.user.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.user.delete.mockResolvedValue({ id: 'user-1' })
  prismaMock.tree.findMany.mockImplementation(async (args: any) => (
    TREES.filter((tree) => tree.ownerUserId === args?.where?.ownerUserId).map(({ id }) => ({ id }))
  ))
  prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-owned' })
  prismaMock.tree.deleteMany.mockImplementation(async (args: any) => ({ count: args?.where?.id?.in?.length ?? 0 }))
  prismaMock.treeMembership.findUnique.mockResolvedValue({ treeId: 'tree-owned', userId: 'user-1', role: 'owner' })
  prismaMock.treeAccessPasswords.findUnique.mockResolvedValue(null)
  prismaMock.contributionSession.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock))
  prismaMock.$disconnect.mockResolvedValue(undefined)
})

describe('DELETE /auth/me', () => {
  it('requires an authenticated user', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/me',
      payload: { password: PASSWORD },
    })

    expect(response.statusCode).toBe(401)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects a missing password', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })

    expect(response.statusCode).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    await app.close()
  })

  describe("compte sans mot de passe (né d'une connexion OIDC)", () => {
    const signedAt = async (app: FastifyInstance, minutesAgo: number) => {
      await app.ready()
      return (app as any).jwt.sign({
        kind: 'user', sub: 'user-1', jti: randomUUID(), userId: 'user-1', email: 'user@example.com',
        iat: Math.floor(Date.now() / 1000) - minutesAgo * 60,
      }, { expiresIn: '1h' })
    }

    beforeEach(() => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com', passwordHash: null })
    })

    it('se supprime avec son email retapé, juste après une connexion', async () => {
      const app = createApp()
      const response = await app.inject({
        method: 'DELETE', url: '/auth/me',
        headers: { authorization: `Bearer ${await signedAt(app, 2)}` },
        payload: { confirmEmail: ' User@Example.com ' },
      })
      expect(response.statusCode).toBe(200)
      expect(prismaMock.user.delete).toHaveBeenCalled()
      await app.close()
    })

    it('refuse un autre email', async () => {
      const app = createApp()
      const response = await app.inject({
        method: 'DELETE', url: '/auth/me',
        headers: { authorization: `Bearer ${await signedAt(app, 2)}` },
        payload: { confirmEmail: 'autre@example.com' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ error: 'invalid_password' })
      expect(prismaMock.user.delete).not.toHaveBeenCalled()
      await app.close()
    })

    it('refuse une session de plus de 15 minutes, même avec le bon email', async () => {
      const app = createApp()
      const response = await app.inject({
        method: 'DELETE', url: '/auth/me',
        headers: { authorization: `Bearer ${await signedAt(app, 20)}` },
        payload: { confirmEmail: 'user@example.com' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ error: 'recent_sign_in_required' })
      expect(prismaMock.user.delete).not.toHaveBeenCalled()
      await app.close()
    })

    it("n'accepte pas un email à la place du mot de passe pour un compte qui en a un", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com', passwordHash })
      const app = createApp()
      const response = await app.inject({
        method: 'DELETE', url: '/auth/me',
        headers: { authorization: `Bearer ${await signedAt(app, 2)}` },
        payload: { confirmEmail: 'user@example.com' },
      })
      expect(response.statusCode).toBe(403)
      expect(prismaMock.user.delete).not.toHaveBeenCalled()
      await app.close()
    }, 15000)
  })

  describe('compte à mot de passe relié à OIDC, connexion par mot de passe fermée (PASSWORD_LOGIN=false)', () => {
    const signedAt = async (app: FastifyInstance, minutesAgo: number) => {
      await app.ready()
      return (app as any).jwt.sign({
        kind: 'user', sub: 'user-1', jti: randomUUID(), userId: 'user-1', email: 'user@example.com',
        iat: Math.floor(Date.now() / 1000) - minutesAgo * 60,
      }, { expiresIn: '1h' })
    }

    beforeEach(() => {
      env.PASSWORD_LOGIN = false
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com', passwordHash })
    })

    afterEach(() => {
      env.PASSWORD_LOGIN = true
    })

    it('se supprime avec son email retapé, juste après une connexion (le mot de passe ne peut plus servir)', async () => {
      const app = createApp()
      const response = await app.inject({
        method: 'DELETE', url: '/auth/me',
        headers: { authorization: `Bearer ${await signedAt(app, 2)}` },
        payload: { confirmEmail: 'user@example.com' },
      })
      expect(response.statusCode).toBe(200)
      expect(prismaMock.user.delete).toHaveBeenCalled()
      await app.close()
    })

    it('refuse une session de plus de 15 minutes, même avec le bon email', async () => {
      const app = createApp()
      const response = await app.inject({
        method: 'DELETE', url: '/auth/me',
        headers: { authorization: `Bearer ${await signedAt(app, 20)}` },
        payload: { confirmEmail: 'user@example.com' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ error: 'recent_sign_in_required' })
      expect(prismaMock.user.delete).not.toHaveBeenCalled()
      await app.close()
    })

    it('refuse un autre email', async () => {
      const app = createApp()
      const response = await app.inject({
        method: 'DELETE', url: '/auth/me',
        headers: { authorization: `Bearer ${await signedAt(app, 2)}` },
        payload: { confirmEmail: 'autre@example.com' },
      })
      expect(response.statusCode).toBe(403)
      expect(prismaMock.user.delete).not.toHaveBeenCalled()
      await app.close()
    })

    it('dit à l’écran de demander l’email, pas un mot de passe (hasPassword=false)', async () => {
      const app = createApp()
      const response = await app.inject({
        method: 'GET', url: '/auth/me',
        headers: { authorization: `Bearer ${await signedAt(app, 2)}` },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().user.hasPassword).toBe(false)
      await app.close()
    })
  })

  it('rejects a wrong password without deleting anything', async () => {
    const ownedFile = await writeMediaFile('tree-owned', 'person-1/photo.jpg')
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'wrong-password' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'invalid_password' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.tree.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
    expect(existsSync(ownedFile)).toBe(true)

    // Le jeton reste valide après un mot de passe erroné.
    const lastTreeResponse = await app.inject({
      method: 'GET',
      url: '/auth/me/last-tree',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(lastTreeResponse.statusCode).toBe(200)
    await app.close()
  })

  it('deletes the user, owned trees and their media, keeps other trees, revokes the token', async () => {
    const ownedFile = await writeMediaFile('tree-owned', 'person-1/photo.jpg')
    const archivedFile = await writeMediaFile('tree-owned-archived', 'annotation-photos/note.png')
    const memberFile = await writeMediaFile('tree-member', 'person-9/photo.jpg')

    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: PASSWORD },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })

    expect(prismaMock.tree.findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'user-1' },
      select: { id: true },
    })
    expect(prismaMock.tree.deleteMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.tree.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['tree-owned', 'tree-owned-archived'] } },
    })
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { lastOpenedTreeId: { in: ['tree-owned', 'tree-owned-archived'] } },
    }))
    expect(prismaMock.contributionSession.updateMany).toHaveBeenCalledWith({
      where: { submittedByUserId: 'user-1' },
      data: { submittedByLabel: 'Contributeur' },
    })
    // Ses visites d'autres arbres restent comptées, sans son identifiant
    const visitUpdate = prismaMock.treeVisit.updateMany.mock.calls[0][0]
    expect(visitUpdate.where).toEqual({ visitorKey: 'user:user-1' })
    expect(visitUpdate.data.visitorKey).toMatch(/^[0-9a-f]{32}$/)
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } })

    // Les arbres doivent partir avant l'utilisateur (relation propriétaire en Restrict).
    expect(prismaMock.tree.deleteMany.mock.invocationCallOrder[0])
      .toBeLessThan(prismaMock.user.delete.mock.invocationCallOrder[0])

    expect(existsSync(ownedFile)).toBe(false)
    expect(existsSync(path.join(storageRoot, 'tree-owned'))).toBe(false)
    expect(existsSync(archivedFile)).toBe(false)
    expect(existsSync(memberFile)).toBe(true)

    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.user.count.mockResolvedValue(0)
    const afterResponse = await app.inject({
      method: 'GET',
      url: '/auth/me/last-tree',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(afterResponse.statusCode).toBe(401)

    const treesResponse = await app.inject({
      method: 'GET',
      url: '/trees',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(treesResponse.statusCode).toBe(401)
    await app.close()
  })

  it('keeps the response successful when media removal fails', async () => {
    prismaMock.tree.findMany.mockResolvedValue([{ id: '..' }])
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: PASSWORD },
    })

    expect(response.statusCode).toBe(200)
    expect(existsSync(storageRoot)).toBe(true)
    await app.close()
  })

  it('rejects a session opened on another device once the account is gone', async () => {
    const app = createApp()
    const otherDeviceToken = await createUserToken(app)
    prismaMock.user.count.mockResolvedValue(0)

    const response = await app.inject({
      method: 'GET',
      url: '/trees',
      headers: { authorization: `Bearer ${otherDeviceToken}` },
    })

    expect(response.statusCode).toBe(401)
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where: { id: 'user-1' } })
    await app.close()
  })
})

describe('DELETE /trees/:id', () => {
  it('permanently deletes the tree and its media directory', async () => {
    const ownedFile = await writeMediaFile('tree-owned', 'person-1/photo.jpg')
    const otherFile = await writeMediaFile('tree-member', 'person-9/photo.jpg')
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/trees/tree-owned',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(prismaMock.tree.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['tree-owned'] } },
    })
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { lastOpenedTreeId: { in: ['tree-owned'] } },
      data: {
        lastOpenedTreeId: null,
        lastOpenedAccessMode: null,
        lastOpenedRole: null,
        lastOpenedAt: null,
      },
    })
    expect(existsSync(ownedFile)).toBe(false)
    expect(existsSync(otherFile)).toBe(true)
    await app.close()
  })

  it('forbids a non-owner member', async () => {
    const ownedFile = await writeMediaFile('tree-owned', 'person-1/photo.jpg')
    prismaMock.treeMembership.findUnique.mockResolvedValue({ treeId: 'tree-owned', userId: 'user-1', role: 'admin' })
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/trees/tree-owned',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
    expect(prismaMock.tree.deleteMany).not.toHaveBeenCalled()
    expect(existsSync(ownedFile)).toBe(true)
    await app.close()
  })

  it('returns 404 for a tree already marked as deleted', async () => {
    prismaMock.tree.findFirst.mockResolvedValue(null)
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/trees/tree-owned',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(404)
    expect(prismaMock.tree.deleteMany).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('resolveTreeMediaDirectory', () => {
  it('accepts a plain tree id directly under the storage root', () => {
    expect(resolveTreeMediaDirectory('tree-1', storageRoot)).toBe(path.join(storageRoot, 'tree-1'))
  })

  it('rejects ids that would escape or target the storage root', () => {
    for (const treeId of ['', '.', '..', '../other', 'a/b', 'a\\b', '..\\other']) {
      expect(resolveTreeMediaDirectory(treeId, storageRoot)).toBeNull()
    }
  })
})
