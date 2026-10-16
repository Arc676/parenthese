import { describe, it, expect } from 'vitest'
import { computeBlockLayout } from './blockLayout'
import { COMPACT_W, PERSON_W } from './constants'

const person = (id) => ({ id, firstName: id, lastName: '' })
const union = (id, partner1Id, partner2Id) => ({ id, partner1Id, partner2Id, displayOrder: 1 })
const fil = (id, childId, unionId) => ({ id, childId, parentId: null, unionId, parentageType: 'biologique', displayOrder: 1 })

describe('computeBlockLayout, conjoints isolés', () => {
  // pa + ma → enfant e, marié à s (sans parent ni enfant dans l'arbre)
  const graph = {
    persons: ['pa', 'ma', 'e', 's'].map(person),
    unions: [union('u1', 'pa', 'ma'), union('u2', 'e', 's')],
    filiations: [fil('f1', 'e', 'u1')],
  }

  it('dessine en petit le conjoint sans parent ni enfant, pas son partenaire', () => {
    const { children } = computeBlockLayout(graph)
    const byId = new Map(children.map(n => [n.id, n]))
    expect(byId.get('p-s')).toMatchObject({ _compact: true, width: COMPACT_W, _compactPartner: 'p-e' })
    expect(byId.get('p-e')._compact).toBeUndefined()
    expect(byId.get('p-e').width).toBe(PERSON_W)
    expect(byId.get('u-u2')).toMatchObject({ _compact: true, width: 0 })
  })

  it('colle le petit portrait à son partenaire', () => {
    const { children } = computeBlockLayout(graph)
    const byId = new Map(children.map(n => [n.id, n]))
    const center = (id) => byId.get(id).x + byId.get(id).width / 2
    expect(Math.abs(center('p-s') - center('p-e'))).toBeLessThan(80)
  })

  it('garde en taille normale un conjoint qui a des enfants', () => {
    const { children } = computeBlockLayout({
      ...graph,
      persons: [...graph.persons, person('k')],
      filiations: [...graph.filiations, fil('f2', 'k', 'u2')],
    })
    expect(children.find(n => n.id === 'p-s')._compact).toBeUndefined()
  })
})

describe('computeBlockLayout, ordre de la fratrie', () => {
  const kids = ['a', 'b', 'c']
  const graphWith = (orders) => ({
    persons: ['pa', 'ma', ...kids].map(person),
    unions: [union('u1', 'pa', 'ma')],
    filiations: kids.map((k, i) => ({ ...fil(`f-${k}`, k, 'u1'), displayOrder: orders[i] })),
  })
  const order = (graph) => {
    const { children } = computeBlockLayout(graph)
    return children.filter(n => kids.includes(n._data?.id)).sort((l, r) => l.x - r.x).map(n => n._data.id)
  }

  it('place les enfants selon displayOrder', () => {
    expect(order(graphWith([3, 1, 2]))).toEqual(['b', 'c', 'a'])
  })

  it("garde l'ordre d'arrivée quand displayOrder est égal partout", () => {
    expect(order(graphWith([1, 1, 1]))).toEqual(['a', 'b', 'c'])
  })
})
