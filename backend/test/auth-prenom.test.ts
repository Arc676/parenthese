import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Prénom du compte : renvoyé à l'inscription, à la connexion et sur /me.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}))

let app: FastifyInstance

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.PORT = '4000'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.JWT_EXPIRES_IN = '7d'
  process.env.JWT_TREE_ACCESS_EXPIRES_IN = '24h'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
  const { createApp } = await import('../src/app.js')
  app = createApp()
})

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue(null)
  prismaMock.user.count.mockResolvedValue(1)
})

describe('prénom du compte', () => {
  it("l'inscription enregistre le prénom (sans espaces autour) et le renvoie", async () => {
    prismaMock.user.create.mockResolvedValue({ id: 'user-1', email: 'anais@example.com', firstName: 'Anaïs' })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { firstName: '  Anaïs ', email: 'anais@example.com', password: 'securepass123' },
    })

    expect(res.statusCode).toBe(201)
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ firstName: 'Anaïs' }),
    }))
    expect(res.json().user).toEqual({ id: 'user-1', email: 'anais@example.com', firstName: 'Anaïs', hasPassword: true })
  })

  it("l'inscription sans prénom le garde vide, sans erreur", async () => {
    prismaMock.user.create.mockResolvedValue({ id: 'user-2', email: 'sans@example.com', firstName: null })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'sans@example.com', password: 'securepass123' },
    })

    expect(res.statusCode).toBe(201)
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ firstName: null }),
    }))
    expect(res.json().user.firstName).toBeNull()
  })

  it('la connexion renvoie le prénom du compte', async () => {
    const { hashPassword } = await import('../src/lib/auth.js')
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'anais@example.com',
      firstName: 'Anaïs',
      passwordHash: await hashPassword('securepass123'),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'anais@example.com', password: 'securepass123' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().user).toEqual({ id: 'user-1', email: 'anais@example.com', firstName: 'Anaïs', hasPassword: true })
  })

  it('/me renvoie le profil du compte connecté, et refuse sans session', async () => {
    const { hashPassword } = await import('../src/lib/auth.js')
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'anais@example.com',
      firstName: 'Anaïs',
      passwordHash: await hashPassword('securepass123'),
    })
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'anais@example.com', password: 'securepass123' },
    })
    const token = login.json().token

    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'anais@example.com', firstName: 'Anaïs', passwordHash: 'hash' })
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(me.statusCode).toBe(200)
    expect(me.json().user).toEqual({ id: 'user-1', email: 'anais@example.com', firstName: 'Anaïs', hasPassword: true })

    const anonymous = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(anonymous.statusCode).toBe(401)
  })
})
