import { describe, expect, it } from 'vitest'

import { gedcomNameValue, parseGedcomName } from '../src/routes/gedcom'

// Prénom inconnu : enregistré vide. L'export écrit « /Nom/ », l'import relit un prénom vide (et non « ? »).
describe('prénom inconnu, GEDCOM', () => {
  it('export : sans prénom, la valeur NAME commence par le nom', () => {
    expect(gedcomNameValue('', 'Dupont')).toBe('/Dupont/')
    expect(gedcomNameValue('Marie', 'Dupont')).toBe('Marie /Dupont/')
    expect(gedcomNameValue('Marie', 'Du/pont')).toBe('Marie /Dupont/')
  })

  it('import : un NAME sans prénom donne un prénom vide', () => {
    expect(parseGedcomName('/Dupont/')).toEqual({ firstName: '', lastName: 'Dupont' })
    expect(parseGedcomName('Marie /Dupont/')).toEqual({ firstName: 'Marie', lastName: 'Dupont' })
  })

  it('aller-retour export puis import garde le prénom vide', () => {
    expect(parseGedcomName(gedcomNameValue('', 'Martin'))).toEqual({ firstName: '', lastName: 'Martin' })
  })
})
