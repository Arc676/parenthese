import { describe, expect, it } from 'vitest'

import { parseSex, sexOrNull, sexSchema } from '../src/lib/person-sex'

// Sexe d'une personne (issue #114) : male, female, other ou null, anciennes valeurs M/F relues
describe('sexe d’une personne', () => {
  it('ramène les écritures connues à male / female / null', () => {
    expect(parseSex('male')).toBe('male')
    expect(parseSex('M')).toBe('male')
    expect(parseSex(' homme ')).toBe('male')
    expect(parseSex('female')).toBe('female')
    expect(parseSex('F')).toBe('female')
    expect(parseSex('Femme')).toBe('female')
    expect(parseSex(null)).toBeNull()
    expect(parseSex('')).toBeNull()
    expect(parseSex('U')).toBeNull()
    expect(parseSex('other')).toBe('other')
    expect(parseSex('X')).toBe('other')
    expect(parseSex('Autre')).toBe('other')
    expect(parseSex('robot')).toBeUndefined()
  })

  it('une valeur illisible déjà en base se lit « non précisé »', () => {
    expect(sexOrNull('M')).toBe('male')
    expect(sexOrNull('robot')).toBeNull()
    expect(sexOrNull(undefined)).toBeNull()
  })

  it('le schéma d’écriture normalise, garde l’absence et refuse l’inconnu', () => {
    expect(sexSchema.parse('F')).toBe('female')
    expect(sexSchema.parse(null)).toBeNull()
    expect(sexSchema.parse(undefined)).toBeUndefined()
    expect(sexSchema.safeParse('robot').success).toBe(false)
  })
})
