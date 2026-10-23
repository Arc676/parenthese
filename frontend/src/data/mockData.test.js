import { describe, expect, it } from 'vitest'

import { getPersonById, getPersonMedias, getPersonTaggedMedias, loadGraphData } from './mockData'

describe('loadGraphData avatar mapping', () => {
  it('uses dedicated avatarUrlPath and does not derive person photo from medias', () => {
    loadGraphData(
      {
        persons: [
          {
            id: 'p-1',
            firstName: 'Alice',
            lastName: 'Martin',
            birthDate: null,
            deathDate: null,
            notes: null,
            avatarUrlPath: '/trees/t-1/persons/p-1/avatar',
            avatarFromImmich: true,
          },
          {
            id: 'p-2',
            firstName: 'Bob',
            lastName: 'Martin',
            birthDate: null,
            deathDate: null,
            notes: null,
            avatarUrlPath: null,
            avatarFromImmich: false,
          },
        ],
        unions: [],
        filiations: [],
        medias: [
          {
            id: 'm-1',
            personId: 'p-2',
            type: 'photo',
            urlPath: '/trees/t-1/media/m-1',
            caption: null,
            source: 'Album familial',
            displayOrder: 1,
            isFeatured: true,
          },
        ],
        annotations: [],
      },
      { apiBaseUrl: '/api', mediaToken: 'abc' },
    )

    expect(getPersonById('p-1')?.photo).toBe('/api/trees/t-1/persons/p-1/avatar?token=abc')
    expect(getPersonById('p-2')?.photo).toBeNull()
    expect(getPersonMedias('p-2')[0]?.source).toBe('Album familial')
    // Origine du portrait portée par la personne (faux quand il ne vient pas d'Immich)
    expect(getPersonById('p-1')?.avatarFromImmich).toBe(true)
    expect(getPersonById('p-2')?.avatarFromImmich).toBe(false)
  })
})

describe('loadGraphData, union à un seul parent', () => {
  it('relie les enfants directement au parent connu au lieu de les perdre', async () => {
    const { getParents, getChildren } = await import('./mockData')
    const person = (id, firstName) => ({ id, firstName, lastName: 'Lemaire', birthDate: null, deathDate: null, notes: null, avatarUrlPath: null })
    loadGraphData({
      persons: [person('julien', 'Julien'), person('hugo', 'Hugo'), person('lea', 'Léa')],
      unions: [{ id: 'u-seul', partner1PersonId: 'julien', partner2PersonId: null }],
      filiations: [
        { id: 'f-1', parentPersonId: 'julien', childPersonId: 'hugo', viaUnionId: 'u-seul' },
        { id: 'f-2', parentPersonId: 'julien', childPersonId: 'lea', viaUnionId: 'u-seul' },
        { id: 'f-3', parentPersonId: 'julien', childPersonId: 'lea', viaUnionId: 'u-seul' },
      ],
      medias: [],
      annotations: [],
    })

    expect(getParents('hugo').map((p) => p.id)).toEqual(['julien'])
    expect(getChildren('julien').map((p) => p.id).sort()).toEqual(['hugo', 'lea'])
  })
})

describe('loadGraphData, surnom', () => {
  it("garde le surnom renvoyé par l'API", () => {
    loadGraphData({
      persons: [
        { id: 'p-1', firstName: 'Louise', lastName: 'Martin', birthDate: null, deathDate: null, notes: null, nickname: 'Loulou' },
        { id: 'p-2', firstName: 'Paul', lastName: 'Martin', birthDate: null, deathDate: null, notes: null, nickname: null },
      ],
      unions: [], filiations: [], medias: [], annotations: [],
    })
    expect(getPersonById('p-1').nickname).toBe('Loulou')
    expect(getPersonById('p-2').nickname).toBeNull()
  })
})

describe('personnes identifiées sur un souvenir', () => {
  it('montre le souvenir aux personnes identifiées, pas à son propriétaire, et écarte les inconnues', () => {
    const person = (id, firstName) => ({ id, firstName, lastName: 'Martin', birthDate: null, deathDate: null, notes: null, avatarUrlPath: null })
    loadGraphData(
      {
        persons: [person('p-1', 'Alice'), person('p-2', 'Bob'), person('p-3', 'Chloé')],
        unions: [],
        filiations: [],
        medias: [
          {
            id: 'm-1',
            personId: 'p-1',
            type: 'photo',
            urlPath: '/trees/t-1/media/m-1',
            caption: 'Mariage',
            displayOrder: 1,
            isFeatured: false,
            people: [
              { personId: 'p-1', x: 0.2, y: 0.3 },
              { personId: 'p-2', x: null, y: null },
              { personId: 'disparue', x: 0.5, y: 0.5 },
            ],
          },
        ],
        annotations: [],
      },
      { mediaToken: 'tok', apiBaseUrl: '' },
    )

    expect(getPersonMedias('p-1').map((m) => m.id)).toEqual(['m-1'])
    expect(getPersonTaggedMedias('p-1')).toEqual([])
    expect(getPersonTaggedMedias('p-2').map((m) => m.id)).toEqual(['m-1'])
    expect(getPersonTaggedMedias('p-3')).toEqual([])
    expect(getPersonMedias('p-1')[0].people).toEqual([
      { personId: 'p-1', x: 0.2, y: 0.3 },
      { personId: 'p-2', x: null, y: null },
    ])
  })
})
describe('« À vérifier » au chargement du graphe', () => {
  it('garde le drapeau, absent = faux', () => {
    loadGraphData({ persons: [
      { id: 'a', firstName: 'Jeanne', lastName: 'Martin', toVerify: true },
      { id: 'b', firstName: 'Paul', lastName: 'Martin' },
    ] })
    expect(getPersonById('a').toVerify).toBe(true)
    expect(getPersonById('b').toVerify).toBe(false)
  })
})
