import { describe, expect, it } from 'vitest'
import { firstNameLabel, fullNameLabel, isFirstNameUnknown } from './personName.js'

describe('prénom inconnu', () => {
  it('un prénom vide ou blanc est inconnu', () => {
    expect(isFirstNameUnknown({ firstName: '' })).toBe(true)
    expect(isFirstNameUnknown({ firstName: '   ' })).toBe(true)
    expect(isFirstNameUnknown({ firstName: 'Marie' })).toBe(false)
  })

  it('le libellé affiché remplace le prénom vide', () => {
    expect(firstNameLabel({ firstName: '' })).toBe('Prénom inconnu')
    expect(firstNameLabel({ firstName: ' Marie ' })).toBe('Marie')
  })

  it('le nom complet garde le nom de famille à côté du libellé', () => {
    expect(fullNameLabel({ firstName: '', lastName: 'Dupont' })).toBe('Prénom inconnu Dupont')
    expect(fullNameLabel({ firstName: 'Marie', lastName: '' })).toBe('Marie')
  })
})
