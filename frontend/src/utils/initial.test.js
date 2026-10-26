import { describe, expect, it } from 'vitest'
import { initialOf, initialsOf } from './initial.js'

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

describe('initialsOf', () => {
  it('prénom puis nom', () => {
    expect(initialsOf({ firstName: 'jeanne', lastName: 'Duval' })).toBe('JD')
    expect(initialsOf({ firstName: 'Наталья', lastName: 'Иванова' })).toBe('НИ')
    expect(initialsOf({ firstName: 'Élodie', lastName: '' })).toBe('É')
    expect(initialsOf({ firstName: '', lastName: '' })).toBe('?')
  })

  it('un seul caractère pour une écriture sans majuscules', () => {
    expect(initialsOf({ firstName: '小明', lastName: '王' })).toBe('王')
    expect(initialsOf({ firstName: '小明', lastName: '' })).toBe('小')
    expect(initialsOf({ firstName: 'فاطمة', lastName: 'الزهراء' })).toBe('ف')
    expect(initialsOf({ firstName: 'Sarah', lastName: 'לוי' })).toBe('S')
  })
})
