import { describe, it, expect } from 'vitest'
import { computeBlockLayout } from './blockLayout'
import {
  buildSiblingGroups, moveInOrder, pickSlot, rubberBand, springStep, isSettled,
  buildOrderPayload, filiationsWithOrder,
} from './siblingReorder'

const person = (id) => ({ id, firstName: id, lastName: '' })
const union = (id, partner1Id, partner2Id) => ({ id, partner1Id, partner2Id, displayOrder: 1 })
const viaUnion = (id, childId, unionId) => ({ id, childId, parentId: null, unionId, parentageType: 'biologique', displayOrder: 1 })
const direct = (id, childId, parentId) => ({ id, childId, parentId, unionId: null, parentageType: 'biologique', displayOrder: 1 })

const graph = {
  persons: ['pa', 'ma', 'a', 'b', 'c', 'solo', 'k1', 'k2'].map(person),
  unions: [union('u1', 'pa', 'ma')],
  filiations: [
    viaUnion('fa', 'a', 'u1'), viaUnion('fb', 'b', 'u1'), viaUnion('fc', 'c', 'u1'),
    direct('fk1', 'k1', 'solo'), direct('fk2', 'k2', 'solo'),
  ],
}

describe('buildSiblingGroups', () => {
  it('regroupe les enfants d’une union, de gauche à droite', () => {
    const groups = buildSiblingGroups(computeBlockLayout(graph))
    expect(groups.get('p-b')).toEqual({ source: 'u-u1', ids: ['p-a', 'p-b', 'p-c'] })
    expect(groups.get('p-a')).toBe(groups.get('p-c'))
  })

  it('regroupe les enfants d’un parent seul', () => {
    const groups = buildSiblingGroups(computeBlockLayout(graph))
    expect(groups.get('p-k1')?.source).toBe('vu-solo')
  })

  it('écarte une fratrie dont un enfant appartient à deux familles', () => {
    const layout = computeBlockLayout(graph)
    layout.edges.push({ id: 'extra', sources: ['vu-solo'], targets: ['p-a'] })
    expect(buildSiblingGroups(layout).has('p-a')).toBe(false)
  })

  it('ignore les enfants uniques', () => {
    const groups = buildSiblingGroups(computeBlockLayout({ ...graph, filiations: [viaUnion('fa', 'a', 'u1')] }))
    expect(groups.has('p-a')).toBe(false)
  })
})

describe('moveInOrder', () => {
  it('déplace un élément à une place donnée', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(moveInOrder(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
  })
})

describe('pickSlot', () => {
  const slots = [0, 100, 200]
  it('change de place au milieu entre deux places', () => {
    expect(pickSlot(slots, 49, 0, 0)).toBe(0)
    expect(pickSlot(slots, 51, 0, 0)).toBe(1)
    expect(pickSlot(slots, 160, 0, 0)).toBe(2)
  })
  it('ne bascule pas tant qu’on hésite dans la marge', () => {
    expect(pickSlot(slots, 55, 0, 10)).toBe(0)
    expect(pickSlot(slots, 61, 0, 10)).toBe(1)
    expect(pickSlot(slots, 45, 1, 10)).toBe(1)
    expect(pickSlot(slots, 39, 1, 10)).toBe(0)
  })
})

describe('rubberBand', () => {
  it('laisse passer entre les bords et freine au-delà', () => {
    expect(rubberBand(50, 0, 100)).toBe(50)
    const beyond = rubberBand(300, 0, 100)
    expect(beyond).toBeGreaterThan(100)
    expect(beyond).toBeLessThan(190)
    expect(rubberBand(1000, 0, 100)).toBeGreaterThan(beyond)
  })
})

describe('springStep', () => {
  it('revient à 0 sans osciller longtemps', () => {
    let state = { x: 120, v: 0 }
    let steps = 0
    while (!isSettled(state) && steps < 600) { state = springStep(state, 1 / 60); steps += 1 }
    expect(isSettled(state)).toBe(true)
    expect(steps).toBeLessThan(40)
  })
})

describe('ordre de la fratrie dans les données', () => {
  it('donne les liens de chaque enfant vers la source, dans l’ordre', () => {
    expect(buildOrderPayload(graph.filiations, graph.unions, 'u-u1', ['p-c', 'p-a', 'p-b'])).toEqual([
      { childId: 'c', linkIds: ['fc'] },
      { childId: 'a', linkIds: ['fa'] },
      { childId: 'b', linkIds: ['fb'] },
    ])
    expect(buildOrderPayload(graph.filiations, graph.unions, 'vu-solo', ['p-k2', 'p-k1'])).toEqual([
      { childId: 'k2', linkIds: ['fk2'] },
      { childId: 'k1', linkIds: ['fk1'] },
    ])
  })

  it('reprend les liens directs vers les deux partenaires quand l’union est reconstituée', () => {
    const filiations = [direct('d1', 'a', 'pa'), direct('d2', 'a', 'ma'), direct('d3', 'b', 'pa'), direct('d4', 'b', 'ma')]
    expect(buildOrderPayload(filiations, graph.unions, 'u-u1', ['p-b', 'p-a'])).toEqual([
      { childId: 'b', linkIds: ['d3', 'd4'] },
      { childId: 'a', linkIds: ['d1', 'd2'] },
    ])
  })

  it('le placement suit l’ordre appliqué aux filiations, sans toucher aux originales', () => {
    const reordered = filiationsWithOrder(graph.filiations, graph.unions, 'u-u1', ['p-c', 'p-a', 'p-b'])
    const { children } = computeBlockLayout({ ...graph, filiations: reordered })
    const row = children.filter((n) => ['a', 'b', 'c'].includes(n._data?.id)).sort((l, r) => l.x - r.x).map((n) => n._data.id)
    expect(row).toEqual(['c', 'a', 'b'])
    expect(graph.filiations.every((f) => f.displayOrder === 1)).toBe(true)
  })
})

describe('fratrie de parents séparés', () => {
  it('retrouve les liens directs vers les deux parents du couple « séparé »', () => {
    const filiations = [
      { id: 'x1', childId: 'k1', parentId: 'phil', unionId: null },
      { id: 'x2', childId: 'k1', parentId: 'marie', unionId: null },
      { id: 'x3', childId: 'k2', parentId: 'phil', unionId: null },
      { id: 'x4', childId: 'k2', parentId: 'marie', unionId: null },
    ]
    expect(buildOrderPayload(filiations, [], 'u-pair:marie:phil', ['p-k2', 'p-k1'])).toEqual([
      { childId: 'k2', linkIds: ['x3', 'x4'] },
      { childId: 'k1', linkIds: ['x1', 'x2'] },
    ])
  })
})
