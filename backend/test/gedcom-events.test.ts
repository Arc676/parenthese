import { describe, expect, it } from 'vitest'

import { adoptedFamilies, familyExtras, personExtras } from '../src/lib/gedcom-events'
import { indexGedcomRecords } from '../src/lib/gedcom-photos'
import { parseGedcom } from '../src/routes/gedcom'

const text = [
  '0 @I1@ INDI',
  '1 NAME Louis /RAGOT/',
  '2 NICK Loulou',
  '1 BIRT',
  '2 DATE ABT 1879',
  '2 PLAC La Roche-sur-Yon,85191,Vendée,Pays de la Loire,France,',
  '2 SOUR @S1@',
  '3 PAGE Acte n° 12',
  '1 BAPM',
  '2 DATE 9 MAR 1879',
  '2 PLAC La Roche-sur-Yon,85191,Vendée,,France,',
  '1 OCCU Instituteur',
  '2 DATE FROM 1900 TO 1935',
  '2 PLAC Limoges',
  '1 OCCU Maire',
  '2 DATE 1936',
  '1 RESI',
  '2 ADDR 12 rue des Écoles',
  '3 CITY Limoges',
  '1 EVEN',
  '2 TYPE Militaire',
  '2 DATE BET 1914 AND 1918',
  '2 NOTE Blessé à Verdun.',
  '1 DEAT',
  '2 DATE @#DFRENCH R@ 18 BRUM 8',
  '2 PLAC Nantes,44109,Loire-Atlantique,Pays de la Loire,France,',
  '1 BURI',
  '2 PLAC Cimetière de Miséricorde, Nantes',
  '1 FAMC @F0@',
  '2 PEDI adopted',
  '1 FAMC @F9@',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 MARR',
  '2 DATE EST 1905',
  '2 PLAC Limoges,87085,Haute-Vienne,Nouvelle-Aquitaine,France,',
  '2 SOUR Registre des mariages de Limoges',
  '1 DIV Y',
  '0 @S1@ SOUR',
  '1 TITL Registre des naissances',
].join('\n')

const roots = parseGedcom(text)
const records = indexGedcomRecords(roots)
const indi = roots.find((n) => n.tag === 'INDI')!
const fam = roots.find((n) => n.tag === 'FAM')!

describe('événements de vie d’une personne', () => {
  const extras = personExtras(indi as never, records)
  const byType = (type: string) => extras.events.filter((e) => e.type === type)

  it('précision des dates, lieu de décès, surnom', () => {
    expect(extras.birthDatePrecision).toBe('about')
    expect(extras.deathDatePrecision).toBeNull()
    expect(extras.deathPlace).toBe('Nantes, Loire-Atlantique, Pays de la Loire, France')
    expect(extras.nickname).toBe('Loulou')
  })

  it('naissance : seulement ses sources, sans recopier la date ni le lieu', () => {
    expect(byType('birth')).toEqual([expect.objectContaining({ sources: 'Registre des naissances, Acte n° 12', date: null, place: null })])
  })

  it('baptême, métiers successifs, résidence, inhumation', () => {
    expect(byType('baptism')[0]).toMatchObject({ place: 'La Roche-sur-Yon, Vendée, France', datePrecision: null })
    expect(byType('baptism')[0].date?.toISOString().slice(0, 10)).toBe('1879-03-09')
    expect(byType('occupation').map((e) => e.description)).toEqual(['Instituteur', 'Maire'])
    expect(byType('occupation')[0]).toMatchObject({ datePrecision: 'from', dateText: 'FROM 1900 TO 1935', place: 'Limoges' })
    expect(byType('occupation')[0].dateEnd?.getUTCFullYear()).toBe(1935)
    expect(byType('residence')[0].place).toBe('12 rue des Écoles, Limoges')
    expect(byType('burial')[0].place).toBe('Cimetière de Miséricorde, Nantes')
  })

  it('événement libre (Heredis « Militaire ») avec sa note', () => {
    expect(byType('custom')[0]).toMatchObject({ label: 'Militaire', datePrecision: 'between', notes: 'Blessé à Verdun.' })
  })

  it('adoption déclarée par PEDI', () => {
    expect([...adoptedFamilies(indi as never)]).toEqual(['F0'])
  })
})

describe('événements d’un couple', () => {
  const extras = familyExtras(fam as never, records)

  it('lieu et précision du mariage, sources du mariage, divorce', () => {
    expect(extras.startPlace).toBe('Limoges, Haute-Vienne, Nouvelle-Aquitaine, France')
    expect(extras.startDatePrecision).toBe('estimated')
    expect(extras.events.map((e) => e.type)).toEqual(['marriage', 'divorce'])
    expect(extras.events[0]).toMatchObject({ sources: 'Registre des mariages de Limoges', place: null })
  })
})
