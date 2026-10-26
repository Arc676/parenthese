import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Inscription fermée (ALLOW_REGISTRATION=false, issue #113) : plus aucun compte ne naît, les comptes existants
// se connectent, et une instance neuve accepte quand même son premier compte.
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
      create: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}))

let app: FastifyInstance
let env: { ALLOW_REGISTRATION: boolean }

const newAccount = { firstName: 'Camille', email: 'camille@example.com', password: 'securepass123' }

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
  process.env.ALLOW_REGISTRATION = ' False '
  ;({ env } = await import('../src/config/env.js'))
  const { createApp } = await import('../src/app.js')
  app = createApp()
})

afterAll(async () => {
  delete process.env.ALLOW_REGISTRATION
  await app?.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  env.ALLOW_REGISTRATION = false
  prismaMock.user.findUnique.mockResolvedValue(null)
  prismaMock.user.count.mockResolvedValue(3)
  prismaMock.user.create.mockResolvedValue({ id: 'user-1', email: newAccount.email, firstName: 'Camille' })
  prismaMock.$transaction.mockImplementation(async (run: (tx: typeof prismaMock) => unknown) => run(prismaMock))
  prismaMock.$executeRaw.mockResolvedValue(1)
})

describe('inscription fermée', () => {
  it('lit la variable : « false » ferme, sans tenir compte de la casse', () => {
    expect(env.ALLOW_REGISTRATION).toBe(false)
  })

  it("refuse l'inscription quand des comptes existent, sans rien créer", async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: newAccount })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'registration_closed' })
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it("répond pareil pour une adresse qui a déjà un compte (pas d'énumération)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-9', email: newAccount.email })

    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: newAccount })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'registration_closed' })
  })

  it('garde la connexion des comptes existants', async () => {
    const { hashPassword } = await import('../src/lib/auth.js')
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-9',
      email: newAccount.email,
      firstName: 'Camille',
      passwordHash: await hashPassword(newAccount.password),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: newAccount.email, password: newAccount.password },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().token).toEqual(expect.any(String))
  }, 15000)

  it("annonce l'inscription fermée à l'écran d'accueil", async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/options' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ registration: false, passwordLogin: true, oidc: null })
  })

  it('instance neuve : le premier compte se crée, sous verrou', async () => {
    prismaMock.user.count.mockResolvedValue(0)

    const options = await app.inject({ method: 'GET', url: '/auth/options' })
    expect(options.json()).toMatchObject({ registration: true })

    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: newAccount })

    expect(res.statusCode).toBe(201)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1)
  })

  it("instance neuve : une seconde inscription simultanée est refusée une fois le verrou pris", async () => {
    // Base vide au premier contrôle, puis le compte concurrent est là une fois le verrou obtenu
    prismaMock.user.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)

    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: newAccount })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'registration_closed' })
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })
})

describe('inscription ouverte (par défaut)', () => {
  it('crée le compte sans transaction ni verrou, comme avant', async () => {
    env.ALLOW_REGISTRATION = true

    const options = await app.inject({ method: 'GET', url: '/auth/options' })
    expect(options.json()).toMatchObject({ registration: true })

    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: newAccount })

    expect(res.statusCode).toBe(201)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.user.count).not.toHaveBeenCalled()
  })
})
