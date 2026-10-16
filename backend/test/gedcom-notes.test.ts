import { describe, expect, it } from 'vitest'

import { indexGedcomRecords } from '../src/lib/gedcom-photos'
import { parseGedcom, personNotes } from '../src/routes/gedcom'

function notesOf(text: string) {
  const roots = parseGedcom(text)
  const records = indexGedcomRecords(roots)
  const indi = roots.find((n) => n.tag === 'INDI')!
  return personNotes(indi as never, records)
}

describe('notes d’une personne', () => {
  it('note écrite sous la personne, sur plusieurs lignes (CONT) et coupée (CONC)', () => {
    expect(notesOf([
      '0 @I1@ INDI',
      '1 NOTE Instituteur à Limoges pendant',
      '2 CONC  trente-cinq ans.',
      '2 CONT Il aimait la pêche.',
    ].join('\n'))).toBe('Instituteur à Limoges pendant trente-cinq ans.\nIl aimait la pêche.')
  })

  it('note partagée par renvoi (Gramps, Geneatique, Ancestry)', () => {
    expect(notesOf([
      '0 @I1@ INDI',
      '1 NOTE @N7@',
      '0 @N7@ NOTE Revenu du front en 1919.',
      '1 CONT Blessé à Verdun.',
    ].join('\n'))).toBe('Revenu du front en 1919.\nBlessé à Verdun.')
  })

  it('plusieurs notes, séparées par une ligne vide', () => {
    expect(notesOf([
      '0 @I1@ INDI',
      '1 NOTE Première note.',
      '1 NOTE @N1@',
      '0 @N1@ NOTE Deuxième note.',
    ].join('\n'))).toBe('Première note.\n\nDeuxième note.')
  })

  it('aucune note, ou renvoi cassé', () => {
    expect(notesOf('0 @I1@ INDI\n1 NAME Jean /Dupont/')).toBeNull()
    expect(notesOf('0 @I1@ INDI\n1 NOTE @N404@')).toBeNull()
  })
})
