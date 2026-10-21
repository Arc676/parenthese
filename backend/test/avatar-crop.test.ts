import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Prisma } from '@prisma/client'

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      count: vi.fn(),
    },
    person: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    treeMembership: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}))

let createApp: () => FastifyInstance
let storageRoot: string

const TREE = 'tree-1'
const PERSON = 'person-1'
const url = `/trees/${TREE}/persons/${PERSON}/avatar/crop`

async function createUserToken(app: FastifyInstance, userId = 'user-1'): Promise<string> {
  await app.ready()
  return (app as any).jwt.sign(
    { kind: 'user', sub: userId, jti: randomUUID(), userId, email: 'user@example.com' },
    { expiresIn: '1h' },
  )
}

function asAdmin(role: 'owner' | 'admin' | 'member' = 'owner') {
  prismaMock.treeMembership.findUnique.mockResolvedValue({ role, tree: { deletedAt: null } })
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.PORT = '4000'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.JWT_EXPIRES_IN = '7d'
  process.env.JWT_TREE_ACCESS_EXPIRES_IN = '24h'
  process.env.CORS_ORIGIN = 'http://localhost:5173'

  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'parenthese-crop-'))
  process.env.MEDIA_STORAGE_PATH = storageRoot

  const module = await import('../src/app.js')
  createApp = module.createApp
})

afterAll(async () => {
  await rm(storageRoot, { recursive: true, force: true })
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.count.mockResolvedValue(1)
  prismaMock.person.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.person.findFirst.mockResolvedValue({ avatarPath: `${TREE}/${PERSON}/avatar-a.jpg` })
  asAdmin('owner')
})

describe('PUT /trees/:id/persons/:personId/avatar/crop', () => {
  it('refuse sans session', async () => {
    const app = createApp()
    const response = await app.inject({ method: 'PUT', url, payload: { crop: null } })
    expect(response.statusCode).toBe(401)
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled()
  })

  it('réserve le cadrage aux administrateurs de l arbre, comme le changement de photo', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    asAdmin('member')

    const response = await app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: { crop: { x: 0.4, y: 0.4, zoom: 2 } },
    })

    expect(response.statusCode).toBe(403)
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled()
  })

  it('refuse un cadrage hors plage ou mal formé', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const headers = { authorization: `Bearer ${token}` }

    const tooZoomed = await app.inject({ method: 'PUT', url, headers, payload: { crop: { x: 0.5, y: 0.5, zoom: 5 } } })
    const outside = await app.inject({ method: 'PUT', url, headers, payload: { crop: { x: 1.2, y: 0.5, zoom: 1 } } })
    const missing = await app.inject({ method: 'PUT', url, headers, payload: { crop: { x: 0.5 } } })
    const noBody = await app.inject({ method: 'PUT', url, headers, payload: {} })

    expect(tooZoomed.statusCode).toBe(400)
    expect(outside.statusCode).toBe(400)
    expect(missing.statusCode).toBe(400)
    expect(noBody.statusCode).toBe(400)
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled()
  })

  it('enregistre le cadrage arrondi et audite le changement', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: { crop: { x: 0.123456, y: 0.7, zoom: 1.8 } },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, avatarCrop: { x: 0.1235, y: 0.7, zoom: 1.8 } })

    const call = prismaMock.person.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: PERSON, treeId: TREE, deletedAt: null })
    expect(call.data.avatarCrop).toEqual({ x: 0.1235, y: 0.7, zoom: 1.8 })
    // La photo elle-même n'est jamais touchée
    expect(call.data).not.toHaveProperty('avatarPath')
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'person_avatar_cropped', entityId: PERSON, treeId: TREE }),
    })
  })

  it('remet le cadrage par défaut à zéro (null) plutôt que de le stocker', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const reset = await app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: { crop: null },
    })
    expect(reset.statusCode).toBe(200)
    expect(prismaMock.person.updateMany.mock.calls[0][0].data.avatarCrop).toBe(Prisma.DbNull)

    prismaMock.person.updateMany.mockClear()
    await app.inject({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: { crop: { x: 0.5, y: 0.5, zoom: 1 } },
    })
    expect(prismaMock.person.updateMany.mock.calls[0][0].data.avatarCrop).toBe(Prisma.DbNull)
  })

  it('garde la forme choisie, même avec un cadrage centré, et refuse une forme inconnue', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const put = (crop: unknown) => app.inject({ method: 'PUT', url, headers: { authorization: `Bearer ${token}` }, payload: { crop } })

    const saved = await put({ x: 0.5, y: 0.5, zoom: 1, shape: 'round' })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toEqual({ ok: true, avatarCrop: { x: 0.5, y: 0.5, zoom: 1, shape: 'round' } })
    expect(prismaMock.person.updateMany.mock.calls[0][0].data.avatarCrop).toEqual({ x: 0.5, y: 0.5, zoom: 1, shape: 'round' })

    expect((await put({ x: 0.5, y: 0.5, zoom: 1, shape: 'hexagone' })).statusCode).toBe(400)
  })

  it('répond 404 sans portrait, et 409 pour un portrait venu d Immich', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const headers = { authorization: `Bearer ${token}` }

    prismaMock.person.findFirst.mockResolvedValueOnce({ avatarPath: null })
    const noAvatar = await app.inject({ method: 'PUT', url, headers, payload: { crop: { x: 0.4, y: 0.4, zoom: 2 } } })
    expect(noAvatar.statusCode).toBe(404)

    prismaMock.person.findFirst.mockResolvedValueOnce({ avatarPath: `${TREE}/${PERSON}/immich-abc.jpg` })
    const fromImmich = await app.inject({ method: 'PUT', url, headers, payload: { crop: { x: 0.4, y: 0.4, zoom: 2 } } })
    expect(fromImmich.statusCode).toBe(409)
    expect(fromImmich.json()).toEqual({ error: 'avatar_from_immich' })
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE avatar : le cadrage disparaît avec la photo', () => {
  it('remet avatarCrop à null en même temps que le portrait', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: `/trees/${TREE}/persons/${PERSON}/avatar`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const data = prismaMock.person.updateMany.mock.calls[0][0].data
    expect(data.avatarPath).toBeNull()
    expect(data.avatarCrop).toBe(Prisma.DbNull)
  })
})

describe('lecture du cadrage stocké', () => {
  it('ignore toute valeur mal formée au lieu de déformer le portrait', async () => {
    const { readAvatarCrop, toStoredAvatarCrop } = await import('../src/lib/avatar-crop.js')

    expect(readAvatarCrop(null)).toBeNull()
    expect(readAvatarCrop('oui')).toBeNull()
    expect(readAvatarCrop({ x: 0.2, y: 0.3 })).toBeNull()
    expect(readAvatarCrop({ x: 0.2, y: 0.3, zoom: 9 })).toBeNull()
    expect(readAvatarCrop({ x: 0.2, y: 0.3, zoom: 2 })).toEqual({ x: 0.2, y: 0.3, zoom: 2 })

    expect(toStoredAvatarCrop({ x: 0.5, y: 0.5, zoom: 1 })).toBeNull()
    expect(toStoredAvatarCrop(null)).toBeNull()
  })
})
