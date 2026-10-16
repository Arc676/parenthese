import { describe, expect, it } from 'vitest'
import { formatPlace } from './place.js'

describe('formatPlace', () => {
  it('lieu brut de Heredis', () => {
    expect(formatPlace('La Roche-sur-Yon,85191,Vendée,Pays de la Loire,France,')).toBe('La Roche-sur-Yon, Vendée, Pays de la Loire, France')
    expect(formatPlace('Ménéac,56129,,,,')).toBe('Ménéac')
  })
  it('lieu déjà propre inchangé', () => {
    expect(formatPlace('Limoges')).toBe('Limoges')
    expect(formatPlace('Lille, Nord, France')).toBe('Lille, Nord, France')
  })
  it('vide reste vide', () => {
    expect(formatPlace(null)).toBe(null)
    expect(formatPlace('')).toBe('')
  })
})
