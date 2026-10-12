import { describe, expect, it } from 'vitest'

import { indexObjeRecords, photoPathForPerson } from '../src/lib/gedcom-photos'
import { parseGedcom } from '../src/routes/gedcom'

function photosOf(text: string): Record<string, string | null> {
  const roots = parseGedcom(text)
  const objes = indexObjeRecords(roots)
  const out: Record<string, string | null> = {}
  for (const indi of roots.filter((n) => n.tag === 'INDI' && n.xref)) {
    out[indi.xref!] = photoPathForPerson(indi, objes)
  }
  return out
}

describe('photos citées par un GEDCOM', () => {
  it('lit un OBJE écrit sous la personne (GEDCOM 5.5)', () => {
    const text = [
      '0 @I1@ INDI',
      '1 NAME Jean /Dupont/',
      '1 OBJE',
      '2 FORM jpg',
      '2 FILE C:\\Genealogie\\Photos\\jean.jpg',
    ].join('\n')
    expect(photosOf(text)).toEqual({ I1: 'C:\\Genealogie\\Photos\\jean.jpg' })
  })

  it('suit un renvoi vers un enregistrement OBJE (Gramps, GEDCOM 5.5.1)', () => {
    const text = [
      '0 @I1@ INDI',
      '1 NAME Marie /Martin/',
      '1 OBJE @M7@',
      '0 @M7@ OBJE',
      '1 FILE photos/marie 1920.png',
      '2 FORM png',
    ].join('\n')
    expect(photosOf(text)).toEqual({ I1: 'photos/marie 1920.png' })
  })

  it('préfère la photo marquée principale, sinon la première image', () => {
    const text = [
      '0 @I1@ INDI',
      '1 OBJE',
      '2 FILE acte-naissance.pdf',
      '1 OBJE',
      '2 FILE groupe.jpg',
      '1 OBJE',
      '2 FILE portrait.jpg',
      '2 _PRIM Y',
      '0 @I2@ INDI',
      '1 OBJE',
      '2 FILE acte.pdf',
      '1 OBJE',
      '2 FILE premier.JPEG',
      '1 OBJE',
      '2 FILE second.jpg',
    ].join('\n')
    expect(photosOf(text)).toEqual({ I1: 'portrait.jpg', I2: 'premier.JPEG' })
  })

  it('ignore les adresses web, les documents et les renvois cassés', () => {
    const text = [
      '0 @I1@ INDI',
      '1 OBJE',
      '2 FILE https://exemple.org/photo.jpg',
      '1 OBJE @M404@',
      '1 OBJE',
      '2 FILE registre.pdf',
      '0 @I2@ INDI',
      '1 NAME Sans /Photo/',
    ].join('\n')
    expect(photosOf(text)).toEqual({ I1: null, I2: null })
  })
})
