import { describe, expect, it } from 'vitest'

import { buildGraphPayload } from '../src/utils/graph-payload.js'

describe('buildGraphPayload', () => {
  it('maps graph entities while preserving input order', () => {
    const graph = buildGraphPayload(
      't-1',
      [
        {
          id: 'p-2',
          treeId: 't-1',
          firstName: 'Zoe',
          lastName: 'Martin',
          birthName: 'Durand',
          nickname: 'Zozo',
          birthDate: new Date('1994-06-02T00:00:00.000Z'),
          deathDate: null,
          sex: null,
          notes: null,
          avatarPath: 't-1/p-2/avatar.jpg',
          immichPersonId: '123e4567-e89b-42d3-a456-426614174000',
          createdBy: null,
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'p-1',
          treeId: 't-1',
          firstName: 'Alice',
          lastName: 'Bernard',
          birthName: null,
          birthDate: null,
          deathDate: null,
          sex: 'female',
          notes: 'note',
          avatarPath: null,
          createdBy: null,
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'p-3',
          treeId: 't-1',
          firstName: 'Paul',
          lastName: 'Durand',
          birthName: null,
          birthDate: null,
          deathDate: null,
          sex: 'male',
          notes: null,
          avatarPath: 't-1/p-3/immich-abc.jpg',
          immichPersonId: '123e4567-e89b-42d3-a456-426614174999',
          createdBy: null,
          updatedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ] as any,
      [
        {
          id: 'u-1',
          treeId: 't-1',
          partner1PersonId: 'p-1',
          partner2PersonId: 'p-2',
          unionType: 'mariage',
          startDate: new Date('2012-01-01T00:00:00.000Z'),
          endDate: null,
          displayOrder: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ] as any,
      [
        {
          id: 'l-1',
          treeId: 't-1',
          parentPersonId: 'p-1',
          childPersonId: 'p-2',
          viaUnionId: 'u-1',
          parentageType: 'biologique',
          displayOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ] as any,
      [
        {
          id: 'm-1',
          treeId: 't-1',
          personId: 'p-1',
          type: 'document',
          mimeType: 'application/pdf',
          filePath: 't-1/p-1/m-1.pdf',
          thumbPath: null,
          caption: 'Acte notarié',
          source: 'Archives départementales',
          sizeBytes: 1234,
          displayOrder: 1,
          isFeatured: true,
          uploadedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ] as any,
    )

    expect(graph.persons[0].id).toBe('p-2')
    expect(graph.persons[0].birthDate).toBe('1994-06-02')
    expect(graph.persons[0].birthName).toBe('Durand')
    expect(graph.persons[0].nickname).toBe('Zozo')
    expect(graph.persons[0].avatarUrlPath).toBe('/trees/t-1/persons/p-2/avatar')
    // L'identifiant Immich ne part jamais dans le graphe : il ne sert qu'aux administrateurs.
    // Seule l'origine du portrait (fichier préfixé « immich- ») est publiée.
    expect(graph.persons[0]).not.toHaveProperty('immichPersonId')
    expect(graph.persons[1]).not.toHaveProperty('immichPersonId')
    expect(graph.persons[2]).not.toHaveProperty('immichPersonId')
    expect(graph.persons[0].avatarFromImmich).toBe(false)
    expect(graph.persons[1].avatarFromImmich).toBe(false)
    expect(graph.persons[2].avatarFromImmich).toBe(true)
    expect(graph.persons[1].avatarUrlPath).toBeNull()
    expect(graph.unions[0].id).toBe('u-1')
    expect(graph.filiations[0].viaUnionId).toBe('u-1')
    expect(graph.medias[0].source).toBe('Archives départementales')
  })

  it('preserves sibling display order as provided by the query layer', () => {
    const graph = buildGraphPayload(
      't-1',
      [] as any,
      [] as any,
      [
        {
          id: 'l-2',
          treeId: 't-1',
          parentPersonId: 'p-parent',
          childPersonId: 'p-child-2',
          viaUnionId: null,
          parentageType: 'biologique',
          displayOrder: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'l-1',
          treeId: 't-1',
          parentPersonId: 'p-parent',
          childPersonId: 'p-child-1',
          viaUnionId: null,
          parentageType: 'biologique',
          displayOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ] as any,
    )

    expect(graph.filiations[0].id).toBe('l-2')
    expect(graph.filiations[1].id).toBe('l-1')
  })
})

describe('buildGraphPayload, personnes identifiées sur un souvenir', () => {
  const person = (id: string) => ({ id, treeId: 't-1', firstName: id, lastName: 'X', birthDate: null, deathDate: null, avatarPath: null, deletedAt: null })
  const media = { id: 'm-1', treeId: 't-1', personId: 'p-1', type: 'photo', mimeType: 'image/jpeg', filePath: 'f', caption: null, source: null, displayOrder: 1, isFeatured: false }

  it('attaches people in order with their point, and drops a person missing from the tree', () => {
    const graph = buildGraphPayload(
      't-1',
      [person('p-1'), person('p-2')] as any,
      [],
      [],
      [media] as any,
      [],
      [
        { mediaId: 'm-1', personId: 'p-2', x: 0.3, y: 0.6 },
        { mediaId: 'm-1', personId: 'p-1', x: null, y: null },
        { mediaId: 'm-1', personId: 'p-gone', x: 0.5, y: 0.5 },
      ],
    )
    expect(graph.medias[0].people).toEqual([
      { personId: 'p-2', x: 0.3, y: 0.6 },
      { personId: 'p-1', x: null, y: null },
    ])
  })

  it('gives an empty list when nobody is identified', () => {
    const graph = buildGraphPayload('t-1', [person('p-1')] as any, [], [], [media] as any)
    expect(graph.medias[0].people).toEqual([])
  })
})
