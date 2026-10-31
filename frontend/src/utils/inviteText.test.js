import { describe, expect, it } from 'vitest'
import { buildInviteText, isChristmasSeason } from '../utils/inviteText.js'

// Message d'invitation de Noël (SIGNUP_PROMPTS) : du 1er décembre au 6 janvier, et seulement si l'instance l'autorise
describe("message d'invitation de Noël", () => {
  const at = (iso) => new Date(`${iso}T12:00:00`)

  it('couvre du 1er décembre au 6 janvier inclus', () => {
    expect(isChristmasSeason(at('2026-11-30'))).toBe(false)
    expect(isChristmasSeason(at('2026-12-01'))).toBe(true)
    expect(isChristmasSeason(at('2027-01-06'))).toBe(true)
    expect(isChristmasSeason(at('2027-01-07'))).toBe(false)
  })

  it('parle de Noël en décembre quand l\'instance l\'autorise', () => {
    const text = buildInviteText('https://exemple.test/arbre/x', 'lilas-1928', { seasonal: true, now: at('2026-12-15') })
    expect(text).toContain('Pour Noël')
    expect(text).toContain('https://exemple.test/arbre/x')
    expect(text).toContain('lilas-1928')
  })

  it('garde le message habituel hors saison ou sur une instance qui ne l\'autorise pas', () => {
    expect(buildInviteText('u', 'p', { seasonal: true, now: at('2026-11-15') })).toContain('Je rassemble')
    expect(buildInviteText('u', 'p', { seasonal: false, now: at('2026-12-15') })).toContain('Je rassemble')
  })
})
