import { describe, expect, it } from 'vitest'
import { ageInYears } from './age.js'

describe('ageInYears', () => {
  it("ne compte l'anniversaire qu'une fois passé (#198)", () => {
    expect(ageInYears('1980-12-15', '2026-10-29')).toBe(45)
    expect(ageInYears('1980-12-15', '2026-12-15')).toBe(46)
    expect(ageInYears('1980-03-02T00:00:00.000Z', '2026-10-29')).toBe(46)
  })

  it('garde la différence des années pour une année seule', () => {
    expect(ageInYears('1980-01-01', '2026-10-29')).toBe(46)
    expect(ageInYears(1980, '2026-10-29')).toBe(46)
    expect(ageInYears('1920-05-10', 1995)).toBe(75)
  })

  it('calcule un âge au décès au jour près', () => {
    expect(ageInYears('1920-05-10', '1995-05-09T00:00:00.000Z')).toBe(74)
  })

  it('rend null sans naissance', () => {
    expect(ageInYears(null)).toBe(null)
    expect(ageInYears('', '2026-10-29')).toBe(null)
  })
})
