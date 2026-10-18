import { describe, expect, it } from 'vitest'
import { dateToInputText, formatDigitsAsDate, isYearOnly, parseDateInput } from './dateInput.js'

describe('saisie d’une date (issue #77)', () => {
  it('une année seule ou une date complète', () => {
    expect(parseDateInput('1950')).toBe('1950-01-01')
    expect(parseDateInput('12/03/1950')).toBe('1950-03-12')
    expect(parseDateInput('2.3.1950')).toBe('1950-03-02')
    expect(parseDateInput('1950-03-12')).toBe('1950-03-12')
    expect(parseDateInput('  ')).toBe('')
  })

  it('refuse ce qui n’est pas une date', () => {
    expect(parseDateInput('31/02/1950')).toBeUndefined()
    expect(parseDateInput('195')).toBeUndefined()
    expect(parseDateInput('vers 1950')).toBeUndefined()
  })

  it('réaffiche la valeur comme on l’a tapée', () => {
    expect(dateToInputText('1950-01-01')).toBe('1950')
    expect(dateToInputText('1950-03-12')).toBe('12/03/1950')
    expect(dateToInputText(null)).toBe('')
    expect(isYearOnly('1950-01-01')).toBe(true)
    expect(isYearOnly('1950-03-12')).toBe(false)
  })
})

describe('formatDigitsAsDate', () => {
  it('pose les barres au-delà de quatre chiffres, pour le clavier numérique du téléphone', () => {
    expect(formatDigitsAsDate('1950')).toBe('1950')
    expect(formatDigitsAsDate('12031')).toBe('12/03/1')
    expect(formatDigitsAsDate('12031950')).toBe('12/03/1950')
    expect(parseDateInput(formatDigitsAsDate('12031950'))).toBe('1950-03-12')
  })

  it('laisse tel quel ce qui contient déjà un séparateur', () => {
    expect(formatDigitsAsDate('12/03/19')).toBe('12/03/19')
    expect(formatDigitsAsDate('1/3/1950')).toBe('1/3/1950')
  })
})
