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

const FR = { order: 'dmy', sep: '/' }
const US = { order: 'mdy', sep: '/' }
const CA = { order: 'ymd', sep: '-' }

describe('région du navigateur (issue #152)', () => {
  it('en-US : le mois avant le jour', () => {
    expect(dateToInputText('1950-03-12', US)).toBe('03/12/1950')
    expect(parseDateInput('03/12/1950', US)).toBe('1950-03-12')
    expect(parseDateInput('12/25/1950', US)).toBe('1950-12-25')
    expect(parseDateInput('25/12/1950', US)).toBeUndefined()
    expect(formatDigitsAsDate('03121950', US)).toBe('03/12/1950')
  })
  it('fr-CA : l année d abord, avec des tirets', () => {
    expect(dateToInputText('1950-03-12', CA)).toBe('1950-03-12')
    expect(parseDateInput('1950-3-12', CA)).toBe('1950-03-12')
    expect(formatDigitsAsDate('19500312', CA)).toBe('1950-03-12')
    expect(formatDigitsAsDate('19503', CA)).toBe('1950-3')
  })
  it('une année seule ne change nulle part', () => {
    for (const f of [FR, US, CA]) {
      expect(dateToInputText('1950-01-01', f)).toBe('1950')
      expect(dateToInputText('1950', f)).toBe('1950')
      expect(parseDateInput('1950', f)).toBe('1950-01-01')
    }
  })
  it('l année en premier se lit partout', () => {
    expect(parseDateInput('1950-03-12', FR)).toBe('1950-03-12')
    expect(parseDateInput('1950/03/12', US)).toBe('1950-03-12')
  })
})

describe('mois en lettres, français ou anglais', () => {
  it('jour, mois, année', () => {
    expect(parseDateInput('12 juin 1924', FR)).toBe('1924-06-12')
    expect(parseDateInput('1er août 1950', FR)).toBe('1950-08-01')
    expect(parseDateInput('12 June 1924', US)).toBe('1924-06-12')
    expect(parseDateInput('3 sept. 1901', FR)).toBe('1901-09-03')
    expect(parseDateInput('3 févr 1901', FR)).toBe('1901-02-03')
    expect(parseDateInput('3 FEVRIER 1901', FR)).toBe('1901-02-03')
  })
  it('mois, jour, année', () => {
    expect(parseDateInput('June 12, 1924', US)).toBe('1924-06-12')
    expect(parseDateInput('Aug 1st 1950', FR)).toBe('1950-08-01')
  })
  it('refuse un mois ambigu ou une date impossible', () => {
    expect(parseDateInput('12 ju 1924', FR)).toBeUndefined()
    expect(parseDateInput('12 jui 1924', FR)).toBeUndefined()
    expect(parseDateInput('31 juin 1924', FR)).toBeUndefined()
    expect(parseDateInput('juin 1924', FR)).toBeUndefined()
  })
})
