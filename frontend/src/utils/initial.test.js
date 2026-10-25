import { describe, expect, it } from 'vitest'
import { initialOf } from './initial.js'

describe('initialOf', () => {
  it('donne la première lettre en majuscule', () => {
    expect(initialOf('famille Dupont')).toBe('F')
    expect(initialOf('  élise')).toBe('É')
  })

  it('garde un emoji entier, composé ou non', () => {
    expect(initialOf('🌳 Famille')).toBe('🌳')
    expect(initialOf('👨‍👩‍👧 Les nôtres')).toBe('👨‍👩‍👧')
    expect(initialOf('🇫🇷 Côté France')).toBe('🇫🇷')
  })

  it('rend le repli pour un nom vide', () => {
    expect(initialOf('', 'P')).toBe('P')
    expect(initialOf(null)).toBe('?')
  })
})
