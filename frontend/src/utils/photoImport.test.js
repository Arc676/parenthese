import { describe, expect, it } from 'vitest'
import { baseNameOf, matchPhotoFiles, pickFirstFaces, sizeBucket } from './photoImport.js'

const file = (name, webkitRelativePath = name) => ({ name, webkitRelativePath })

describe('baseNameOf', () => {
  it('lit le nom de fichier d\'un chemin Windows, macOS ou relatif', () => {
    expect(baseNameOf('C:\\Genealogie\\Photos\\jean.jpg')).toBe('jean.jpg')
    expect(baseNameOf('/Users/anne/Heredis/marie.png')).toBe('marie.png')
    expect(baseNameOf('photos/robert 1920.jpg')).toBe('robert 1920.jpg')
  })
})

describe('matchPhotoFiles', () => {
  it('relie chaque chemin du GEDCOM au fichier du même nom, sans tenir compte de la casse', () => {
    const refs = [
      { personId: 'a', file: 'C:\\Photos\\Jean.JPG' },
      { personId: 'b', file: 'C:\\Photos\\marie.jpg' },
      { personId: 'c', file: 'C:\\Photos\\absente.jpg' },
    ]
    const { matches, missing } = matchPhotoFiles(refs, [file('jean.jpg', 'Photos/jean.jpg'), file('marie.jpg', 'Photos/marie.jpg')])
    expect(matches.map((m) => [m.personId, m.file.name])).toEqual([['a', 'jean.jpg'], ['b', 'marie.jpg']])
    expect(missing.map((m) => m.personId)).toEqual(['c'])
  })

  it('départage deux fichiers du même nom par les dossiers du chemin', () => {
    const refs = [{ personId: 'a', file: 'D:\\Arbre\\Dupont\\portrait.jpg' }]
    const files = [file('portrait.jpg', 'Arbre/Martin/portrait.jpg'), file('portrait.jpg', 'Arbre/Dupont/portrait.jpg')]
    expect(matchPhotoFiles(refs, files).matches[0].file.webkitRelativePath).toBe('Arbre/Dupont/portrait.jpg')
  })

  it('rapproche un nom accentué écrit sous deux formes Unicode', () => {
    const refs = [{ personId: 'a', file: 'Hélène.jpg' }]
    const decomposed = 'He\u0301le\u0300ne.jpg'
    expect(matchPhotoFiles(refs, [file(decomposed)]).matches).toHaveLength(1)
  })
})

describe('pickFirstFaces', () => {
  const people = [
    { id: 'moi', firstName: 'Lou', birthYear: 1990, isAlive: true },
    { id: 'mere', firstName: 'Anne', birthYear: 1962, isAlive: true },
    { id: 'pere', firstName: 'Marc', birthYear: 1960, isAlive: true, photo: '/p.jpg' },
    { id: 'fils', firstName: 'Tom', birthYear: 2020, isAlive: true },
    { id: 'aieul', firstName: 'Jules', birthYear: 1880, isAlive: false },
    { id: 'cousin', firstName: 'Paul', birthYear: 1995, isAlive: true },
  ]
  const byId = new Map(people.map((p) => [p.id, p]))
  const parents = { moi: ['mere', 'pere'], mere: ['aieul'] }
  const children = { moi: ['fils'], mere: ['moi'], pere: ['moi'], aieul: ['mere'] }
  const helpers = {
    getParents: (id) => (parents[id] || []).map((x) => byId.get(x)),
    getChildren: (id) => (children[id] || []).map((x) => byId.get(x)),
    getPartners: () => [],
  }

  it('part de « Moi » puis de ses proches, sans les personnes qui ont déjà un portrait', () => {
    const picked = pickFirstFaces({ persons: people, selfId: 'moi', ...helpers, limit: 3 })
    expect(picked.map((p) => p.id)).toEqual(['moi', 'fils', 'mere'])
  })

  it('sans « Moi », prend les naissances les plus récentes', () => {
    const picked = pickFirstFaces({ persons: people, ...helpers, limit: 3 })
    expect(picked.map((p) => p.id)).toEqual(['fils', 'cousin', 'moi'])
  })

  it('complète avec les plus récents quand la famille proche ne suffit pas', () => {
    const picked = pickFirstFaces({ persons: people, selfId: 'aieul', ...helpers, limit: 3 })
    expect(picked.map((p) => p.id)).toEqual(['aieul', 'mere', 'moi'])
  })
})

describe('sizeBucket', () => {
  it('arrondit les effectifs envoyés à PostHog', () => {
    expect([0, 3, 12, 80, 450, 2697].map(sizeBucket)).toEqual(['0', '1-9', '10-49', '50-199', '200-999', '1000+'])
  })
})

describe('souvenirs cités par le logiciel', () => {
  it('garde la légende et la source avec le fichier retrouvé', () => {
    const refs = [{ personId: 'a', file: 'C:\\Heredis\\Médias\\Naissance Ragot.jpg', caption: 'Naissance Ragot', source: 'Registre des naissances, Acte n° 12' }]
    const { matches } = matchPhotoFiles(refs, [file('Naissance Ragot.jpg', 'Médias/Naissance Ragot.jpg')])
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ personId: 'a', caption: 'Naissance Ragot', source: 'Registre des naissances, Acte n° 12' })
    expect(matches[0].file.name).toBe('Naissance Ragot.jpg')
  })
})

describe('chemin d’origine', () => {
  it('chaque correspondance garde le chemin cité, même pour trois fichiers de la même personne', () => {
    const refs = ['a.jpg', 'b.pdf', 'c.jpg'].map((name) => ({ personId: 'p', file: `Medias/${name}` }))
    const { matches } = matchPhotoFiles(refs, ['a.jpg', 'b.pdf', 'c.jpg'].map((name) => file(name, `Medias/${name}`)))
    expect(matches.map((m) => m.sourcePath)).toEqual(['Medias/a.jpg', 'Medias/b.pdf', 'Medias/c.jpg'])
  })
})
