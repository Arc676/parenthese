import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Les sessions fermées se rechargent avant la première requête : sans elles, l'API refuse de démarrer plutôt que
// de rouvrir chaque session fermée sans que personne le voie.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    revokedSession: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}))

describe('sessions fermées au démarrage', () => {
  let createApp: typeof import('../src/app.js')['createApp']

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
    process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
    process.env.CORS_ORIGIN = 'http://localhost:5173'
    ;({ createApp } = await import('../src/app.js'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('recharge les sessions fermées, et un jeton fermé est refusé dès la première requête', async () => {
    prismaMock.revokedSession.findMany.mockResolvedValue([{ jti: 'ferme-1', expiresAt: new Date(Date.now() + 3600_000) }])
    const app = createApp()
    await app.ready()
    const { isUserTokenRevoked } = await import('../src/lib/token-revocation.js')
    expect(isUserTokenRevoked('ferme-1')).toBe(true)
    expect(prismaMock.revokedSession.deleteMany).toHaveBeenCalled()
    await app.close()
  })

  it('ne démarre pas si la base ne répond pas', async () => {
    prismaMock.revokedSession.findMany.mockRejectedValue(new Error('base injoignable'))
    const app = createApp()
    await expect(app.ready()).rejects.toThrow('base injoignable')
  })
})
