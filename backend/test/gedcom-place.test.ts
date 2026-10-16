import { describe, expect, it } from 'vitest'

import { cleanGedcomPlace } from '../src/routes/gedcom'

describe('lieu importé d’un GEDCOM', () => {
  it('Heredis : colonnes vides et code INSEE retirés', () => {
    expect(cleanGedcomPlace('La Roche-sur-Yon,85191,Vendée,Pays de la Loire,France,')).toBe('La Roche-sur-Yon, Vendée, Pays de la Loire, France')
    expect(cleanGedcomPlace('Ménéac,56129,,,,')).toBe('Ménéac')
    expect(cleanGedcomPlace('Ajaccio,2A004,Corse-du-Sud,Corse,France,')).toBe('Ajaccio, Corse-du-Sud, Corse, France')
  })

  it('Gramps, Geneanet : un lieu déjà propre ne change pas', () => {
    expect(cleanGedcomPlace('Lille, Nord, Hauts-de-France, France')).toBe('Lille, Nord, Hauts-de-France, France')
    expect(cleanGedcomPlace('Paris')).toBe('Paris')
  })

  it('code postal et répétitions écartés', () => {
    expect(cleanGedcomPlace('Caen, 14000, Calvados, Calvados, France')).toBe('Caen, Calvados, France')
  })

  it('rien de lisible : pas de lieu', () => {
    expect(cleanGedcomPlace(',,,,')).toBeNull()
    expect(cleanGedcomPlace('')).toBeNull()
    expect(cleanGedcomPlace(undefined)).toBeNull()
  })
})
