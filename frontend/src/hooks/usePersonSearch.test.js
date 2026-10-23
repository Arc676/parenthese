import { describe, expect, it } from 'vitest'
import { calculateScore, getMatchReason, MIN_SCORE_THRESHOLD } from './usePersonSearch.js'

const robert = { firstName: 'Robert', lastName: 'Dupont', nickname: 'Loulou' }
const andre = { firstName: 'André', lastName: 'Dupont', nickname: null }

describe('recherche par surnom', () => {
  it('trouve une personne par son surnom, même sans nom', () => {
    expect(calculateScore('loulou', robert)).toBeGreaterThanOrEqual(MIN_SCORE_THRESHOLD)
    expect(getMatchReason('lou', robert)).toBe('Surnom')
  })

  it("ne trouve pas une personne sans surnom par un mot qui n'est pas dans son nom", () => {
    expect(calculateScore('loulou', andre)).toBeLessThan(MIN_SCORE_THRESHOLD)
  })

  it('garde le classement par nom quand le surnom ne matche pas', () => {
    expect(getMatchReason('dupont', robert)).toBe('Nom')
  })
})

describe('recherche « à vérifier »', () => {
  const doute = { firstName: 'Jeanne', lastName: 'Martin', toVerify: true }
  const sure = { firstName: 'Paul', lastName: 'Martin', toVerify: false }

  it('trouve les personnes marquées, avec ou sans accents, même en partie', () => {
    for (const q of ['à vérifier', 'a verifier', 'À VÉRIF', 'a ver']) {
      expect(calculateScore(q.toLowerCase(), doute)).toBeGreaterThanOrEqual(MIN_SCORE_THRESHOLD)
    }
    expect(getMatchReason('a verifier', doute)).toBe('À vérifier')
  })

  it('ne remonte pas les personnes non marquées', () => {
    expect(calculateScore('a verifier', sure)).toBeLessThan(MIN_SCORE_THRESHOLD)
  })
})
