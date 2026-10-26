import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/auth.js'

// bcrypt natif à la place de bcryptjs : les empreintes déjà en base restent valables
describe('mots de passe, bcrypt natif', () => {
  it('lit une empreinte faite par bcryptjs', async () => {
    const fromBcryptjs = '$2b$10$4uBVFoNEA8gO3uIGq/RqMueaq4w2Vl9VzPFiSj9v9dc0oI1DcR.YS'
    expect(await verifyPassword('123soleil 🌞', fromBcryptjs)).toBe(true)
    expect(await verifyPassword('123soleil', fromBcryptjs)).toBe(false)
  })

  it('fait une empreinte au coût 12 qui se relit', async () => {
    const stored = await hashPassword('mot-de-passe-solide')
    expect(stored).toMatch(/^\$2[aby]\$12\$/)
    expect(await verifyPassword('mot-de-passe-solide', stored)).toBe(true)
    expect(await verifyPassword('mot-de-passe-faux', stored)).toBe(false)
  })
})
