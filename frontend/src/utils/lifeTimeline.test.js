import { describe, expect, it } from 'vitest'
import { buildLifeTimeline, describeDate } from './lifeTimeline.js'

const robert = { id: 3, firstName: 'Robert', birthYear: 1920, deathYear: 1995, birthDate: '1920-03-12', deathDate: '1995-05-01', birthPlace: 'Limoges,87085,Haute-Vienne,,France,' }
const simone = { id: 5, firstName: 'Simone', lastName: 'Petit', birthYear: 1925, deathYear: 2010 }
const family = {
  parents: [{ id: 1, firstName: 'Jean', sex: 'male', deathYear: 1965 }, { id: 2, firstName: 'Marie', sex: 'female', deathYear: 2001 }],
  children: [{ id: 6, firstName: 'Jacques', birthYear: 1945, deathYear: 2015 }],
  siblings: [{ id: 4, firstName: 'André', sex: 'male', birthYear: 1923 }, { id: 9, firstName: 'Paul', sex: 'male', birthYear: 1915 }],
  unions: [{ id: 'u2', partner: simone, startYear: 1943, endYear: 1958, unionType: 'mariage' }],
}
const life = {
  person: { deathPlace: 'Brive-la-Gaillarde', birthDatePrecision: null },
  unions: [{ id: 'u2', startDate: '1943-06-12', startPlace: 'Limoges' }],
  events: [
    { id: 'e1', type: 'birth', sources: 'Registre A\nRegistre B' },
    { id: 'e2', type: 'occupation', date: '1946-01-01', dateEnd: '1981-01-01', datePrecision: 'from', description: 'Instituteur' },
    { id: 'e3', type: 'custom', label: 'Militaire', date: '1940-01-01', dateEnd: '1942-01-01', datePrecision: 'between', notes: 'Verdun' },
    { id: 'e4', type: 'residence', place: 'Rue des Écoles' },
  ],
}

describe('frise de vie', () => {
  const entries = buildLifeTimeline(robert, family, life)
  const titles = entries.map((e) => e.title)

  it('range tout par date, les entrées sans date en bas', () => {
    expect(titles).toEqual([
      'Naissance à Limoges', 'Naissance de son frère André', 'Militaire', 'Épouse Simone Petit', 'Naissance de Jacques',
      'Instituteur', 'Fin de l’union avec Simone', 'Décès de son père Jean', 'Décès à Brive-la-Gaillarde', 'Résidence',
    ])
  })

  it('grands repères, précisions, âge et sources', () => {
    const birth = entries[0]
    expect(birth).toMatchObject({ kind: 'mile', year: 1920, sources: 'Registre A\nRegistre B' })
    expect(entries.find((e) => e.title === 'Instituteur').meta).toBe('jusqu’en 1981 · 26 ans')
    expect(entries.find((e) => e.title === 'Militaire')).toMatchObject({ kind: 'minor', meta: 'entre 1940 et 1942 · 20 ans', note: 'Verdun' })
    expect(entries.find((e) => e.title === 'Épouse Simone Petit')).toMatchObject({ kind: 'mile', meta: 'Limoges · 23 ans' })
  })

  it('famille limitée à sa vie : frère aîné, mère morte après lui, enfant mort après lui écartés', () => {
    expect(titles.join()).not.toMatch(/Paul|Marie|Décès de Jacques/)
  })

  it('sans données de la route, la famille et les repères suffisent', () => {
    const bare = buildLifeTimeline({ id: 1, firstName: 'X', birthYear: 1900 }, { children: [{ id: 2, firstName: 'Y', birthYear: 1930 }] }, null)
    expect(bare.map((e) => e.title)).toEqual(['Naissance', 'Naissance de Y'])
    expect(buildLifeTimeline({ id: 1, firstName: 'X' }, {}, null)).toEqual([])
  })

  it('naissance, mariage et décès se complètent : leur ligne, ses souvenirs, et de quoi la créer', () => {
    const withMedia = buildLifeTimeline(robert, family, {
      ...life,
      events: [...life.events.map((e) => (e.id === 'e1' ? { ...e, mediaIds: ['acte'] } : e)), { id: 'e9', type: 'occupation', description: 'Maire', date: '1936-01-01', mediaIds: ['photo-1', 'photo-2'] }],
    })
    const birth = withMedia.find((e) => e.key === 'birth')
    expect(birth).toMatchObject({ milestone: { type: 'birth' }, mediaIds: ['acte'], event: expect.objectContaining({ id: 'e1' }) })
    expect(withMedia.find((e) => e.key === 'union-u2')).toMatchObject({ milestone: { type: 'marriage', unionId: 'u2' }, event: null, mediaIds: [] })
    expect(withMedia.find((e) => e.key === 'death')).toMatchObject({ milestone: { type: 'death' }, event: null })
    expect(withMedia.find((e) => e.title === 'Maire').mediaIds).toEqual(['photo-1', 'photo-2'])
  })

  it('décès sans date : le repère reste, en bas, « date inconnue » (issue #77)', () => {
    const entries = buildLifeTimeline({ id: 1, firstName: 'X', birthYear: 1900, isAlive: false }, {}, null)
    expect(entries.map((e) => [e.title, e.year, e.meta])).toEqual([['Naissance', 1900, ''], ['Décès', null, 'date inconnue']])
  })

  it('union sans date : avant le premier enfant du couple, sinon avant le décès du conjoint, sinon en bas', () => {
    const lucie = { id: 1, firstName: 'Lucie', birthYear: 1940 }
    const entries = buildLifeTimeline(lucie, {
      children: [{ id: 7, firstName: 'Hugo', birthYear: 1966 }, { id: 8, firstName: 'Léa', birthYear: 1981 }],
      unions: [
        { id: 'u1', partner: { id: 2, firstName: 'Marc', lastName: 'Roy', deathYear: 2013 }, unionType: 'mariage', childIds: [7] },
        { id: 'u2', partner: { id: 3, firstName: 'Paul', lastName: 'Vidal', deathYear: 2016 }, unionType: 'mariage', childIds: [] },
        { id: 'u3', partner: { id: 4, firstName: 'Yves', lastName: 'Mallet' }, unionType: 'mariage' },
      ],
    }, null)
    expect(entries.map((e) => e.title)).toEqual([
      'Naissance', 'Épouse Marc Roy', 'Naissance de Hugo', 'Naissance de Léa', 'Décès de Marc', 'Épouse Paul Vidal', 'Décès de Paul', 'Épouse Yves Mallet',
    ])
    // Aucune année inventée : colonne vide, « date inconnue » dit pourquoi
    for (const key of ['union-u1', 'union-u2', 'union-u3']) {
      expect(entries.find((e) => e.key === key)).toMatchObject({ year: undefined, meta: 'date inconnue' })
    }
    expect(entries.find((e) => e.key === 'union-u1')).not.toHaveProperty('sortYear')
  })

  it('un moment sans date dit « date inconnue »', () => {
    expect(entries.find((e) => e.title === 'Résidence').meta).toBe('Rue des Écoles · date inconnue')
  })

  it('dit les dates comme on les dit', () => {
    expect(describeDate('1879-01-01', null, 'about')).toBe('vers 1879')
    expect(describeDate('1879-01-01', null, 'before')).toBe('avant 1879')
    expect(describeDate('1920-03-12', null, null)).toBe('12 mars')
    expect(describeDate('1920-01-01', null, null)).toBe('')
  })
})
