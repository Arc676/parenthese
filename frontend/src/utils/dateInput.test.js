import { describe, expect, it } from 'vitest'
import { dateToInputText, isYearOnly, parseDateInput } from './dateInput.js'

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
