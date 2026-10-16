import { describe, expect, it } from 'vitest'

import { parseGedcomDate } from '../src/lib/gedcom-dates'

const iso = (value: string) => parseGedcomDate(value)?.iso ?? null

describe('dates GEDCOM', () => {
  it('dates simples', () => {
    expect(iso('15 JAN 1900')).toBe('1900-01-15')
    expect(iso('JAN 1900')).toBe('1900-01')
    expect(iso('1900')).toBe('1900')
    expect(iso('856')).toBe('0856')
    expect(iso('3 mar 1879')).toBe('1879-03-03')
  })

  it('précision gardée', () => {
    expect(parseGedcomDate('ABT 1900')).toMatchObject({ iso: '1900', precision: 'about' })
    expect(parseGedcomDate('BEF 12 MAY 1920')).toMatchObject({ iso: '1920-05-12', precision: 'before' })
    expect(parseGedcomDate('AFT 1850')).toMatchObject({ iso: '1850', precision: 'after' })
    expect(parseGedcomDate('EST 1700')).toMatchObject({ precision: 'estimated' })
    expect(parseGedcomDate('CAL 1801')).toMatchObject({ precision: 'calculated' })
  })

  it('intervalles', () => {
    expect(parseGedcomDate('BET 1794 AND 1796')).toEqual({ iso: '1794', endIso: '1796', precision: 'between', text: 'BET 1794 AND 1796' })
    expect(parseGedcomDate('FROM 1914 TO 1918')).toMatchObject({ iso: '1914', endIso: '1918', precision: 'from' })
  })

  it('date interprétée et texte entre parenthèses', () => {
    expect(parseGedcomDate('INT 1900 (vers la fin du siècle)')).toMatchObject({ iso: '1900', precision: 'interpreted' })
    expect(iso('(pendant la guerre)')).toBeNull()
  })

  it('double année', () => {
    expect(iso('12 FEB 1700/01')).toBe('1701-02-12')
    expect(iso('1699/00')).toBe('1700')
  })

  it('calendrier julien : la date reste celle écrite', () => {
    expect(iso('@#DJULIAN@ 1563')).toBe('1563')
    expect(iso('@#DJULIAN@ 3 SEP 1599')).toBe('1599-09-03')
  })

  it('calendrier républicain converti', () => {
    expect(iso('@#DFRENCH R@ 18 BRUM 8')).toBe('1799-11-09')
    expect(iso('@#DFRENCH R@ 1 VEND 1')).toBe('1792-09-22')
    expect(iso('@#DFRENCH R@ 9 THER 2')).toBe('1794-07-27')
    expect(iso('@#DFRENCH R@ GERM 3')).toBe('1795-03')
    expect(iso('@#DFRENCH R@ 5')).toBe('1796')
  })

  it('illisible : rien', () => {
    expect(iso('')).toBeNull()
    expect(iso('vers 1900')).toBeNull()
    expect(iso('@#DHEBREW@ 5660')).toBeNull()
    expect(iso('32 JAN 1900')).toBeNull()
  })
})
