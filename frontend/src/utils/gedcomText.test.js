import { describe, expect, it } from 'vitest'
import { decodeAnsel, decodeGedcomBytes } from './gedcomText.js'

const latin1 = (text) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)))
const utf8 = (text) => new TextEncoder().encode(text)

describe('encodage d’un fichier GEDCOM', () => {
  it('Heredis PC en ANSI (Windows-1252) : accents corrects', () => {
    const bytes = latin1('0 HEAD\n1 CHAR ANSI\n0 @I1@ INDI\n1 NAME Hélène /Lefèvre/\n')
    const { text, encoding } = decodeGedcomBytes(bytes)
    expect(encoding).toBe('windows-1252')
    expect(text).toContain('Hélène /Lefèvre/')
  })

  it('UTF-8 déclaré ANSI : on garde l’UTF-8 qui est valide', () => {
    const { text, encoding } = decodeGedcomBytes(utf8('0 HEAD\n1 CHAR ANSI\n1 NAME Émile /Ménard/\n'))
    expect(encoding).toBe('utf-8')
    expect(text).toContain('Émile /Ménard/')
  })

  it('UTF-8 avec marque d’octets', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('0 HEAD\n1 NAME Zoé /Bœuf/\n')])
    expect(decodeGedcomBytes(bytes)).toEqual({ text: '0 HEAD\n1 NAME Zoé /Bœuf/\n', encoding: 'utf-8' })
  })

  it('UTF-16 (MyHeritage, certains exports Windows)', () => {
    const text = '0 HEAD\n1 NAME François /Côté/\n'
    const le = new Uint8Array(text.length * 2 + 2)
    le[0] = 0xff; le[1] = 0xfe
    for (let i = 0; i < text.length; i++) { le[2 + i * 2] = text.charCodeAt(i) & 0xff; le[3 + i * 2] = text.charCodeAt(i) >> 8 }
    expect(decodeGedcomBytes(le).text).toBe(text)
  })

  it('Heredis Mac en MACINTOSH', () => {
    // « é » vaut 0x8E en Mac Roman
    const bytes = Uint8Array.from([...latin1('0 HEAD\n1 CHAR MACINTOSH\n1 NAME Ren'), 0x8e, ...latin1(' /Dupr'), 0x8e, ...latin1('/\n')])
    expect(decodeGedcomBytes(bytes).text).toContain('René /Dupré/')
  })

  it('ANSEL : diacritique avant la lettre', () => {
    // 0xE2 = accent aigu, 0xF0 = cédille, 0xE8 = tréma
    expect(decodeAnsel(Uint8Array.from([0x52, 0x65, 0x6e, 0xe2, 0x65]))).toBe('René')
    expect(decodeAnsel(Uint8Array.from([0x46, 0x72, 0x61, 0x6e, 0xf0, 0x63, 0x6f, 0x69, 0x73]))).toBe('François')
    expect(decodeAnsel(Uint8Array.from([0x4e, 0x6f, 0xe8, 0x65, 0x6c]))).toBe('Noël')
    const ged = Uint8Array.from([...latin1('0 HEAD\n1 CHAR ANSEL\n1 NAME '), 0x4c, 0xe2, 0x65, 0x6f, 0x6e, ...latin1(' /'), 0xa6, ...latin1('uf/\n')])
    expect(decodeGedcomBytes(ged)).toEqual({ text: '0 HEAD\n1 CHAR ANSEL\n1 NAME Léon /Œuf/\n', encoding: 'ansel' })
  })

  it('sans déclaration et pas de l’UTF-8 : Windows-1252', () => {
    expect(decodeGedcomBytes(latin1('0 HEAD\n1 NAME Jérôme /Hébert/\n')).text).toContain('Jérôme /Hébert/')
  })
})
