import { describe, expect, it } from 'vitest'

import { hasAnyName } from '../src/lib/person-names'
import { gedcomNameValue } from '../src/routes/gedcom'

// Nom de famille facultatif : une personne garde au moins un prénom ou un nom
describe('au moins un nom', () => {
  it('un prénom ou un nom suffit', () => {
    expect(hasAnyName('Léa', '')).toBe(true)
    expect(hasAnyName('', 'Lambert')).toBe(true)
    expect(hasAnyName('  ', ' Lambert ')).toBe(true)
  })

  it('ni prénom ni nom : refusé', () => {
    expect(hasAnyName('', '')).toBe(false)
    expect(hasAnyName('   ', '  ')).toBe(false)
  })

  it('export GEDCOM sans nom de famille : « Léa // », valide', () => {
    expect(gedcomNameValue('Léa', '')).toBe('Léa //')
  })
})
