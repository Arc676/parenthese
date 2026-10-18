import { describe, it, expect } from 'vitest'
import { computeLayout, normalizeFiliationsForLayout, separatedPairUnions, coupleBarMeta } from './elkLayout'
import { PERSON_W } from './constants'

describe('normalizeFiliationsForLayout', () => {
  it('collapses two direct biological parents into one union filiation when a union exists', () => {
    const unions = [
      { id: 'u-parent', partner1Id: 'ma', partner2Id: 'ha', displayOrder: 1 },
    ]
    const filiations = [
      { id: 'f-ma', childId: 'ia', parentId: 'ma', unionId: null, parentageType: 'biologique', displayOrder: 1 },
      { id: 'f-ha', childId: 'ia', parentId: 'ha', unionId: null, parentageType: 'biologique', displayOrder: 2 },
    ]

    const normalized = normalizeFiliationsForLayout(filiations, unions)

    expect(normalized).toHaveLength(1)
    expect(normalized[0].childId).toBe('ia')
    expect(normalized[0].unionId).toBe('u-parent')
    expect(normalized[0].parentId).toBeNull()
  })

  it('drops direct links when a union-based link for the same child already exists', () => {
    const unions = [
      { id: 'u-parent', partner1Id: 'ma', partner2Id: 'ha', displayOrder: 1 },
    ]
    const filiations = [
      { id: 'f-u', childId: 'ia', parentId: 'ma', unionId: 'u-parent', parentageType: 'biologique', displayOrder: 1 },
      { id: 'f-ma', childId: 'ia', parentId: 'ma', unionId: null, parentageType: 'biologique', displayOrder: 2 },
      { id: 'f-ha', childId: 'ia', parentId: 'ha', unionId: null, parentageType: 'biologique', displayOrder: 3 },
    ]

    const normalized = normalizeFiliationsForLayout(filiations, unions)

    expect(normalized).toHaveLength(1)
    expect(normalized[0].id).toBe('f-u')
    expect(normalized[0].unionId).toBe('u-parent')
  })

  it('keeps single-parent links untouched when there is no matching union', () => {
    const unions = []
    const filiations = [
      { id: 'f-ma', childId: 'ia', parentId: 'ma', unionId: null, parentageType: 'biologique', displayOrder: 1 },
    ]

    const normalized = normalizeFiliationsForLayout(filiations, unions)

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).toMatchObject({
      id: 'f-ma',
      childId: 'ia',
      parentId: 'ma',
      unionId: null,
    })
  })
})

describe('computeLayout', () => {
  function buildFamilyGraph(childCount) {
    const childIds = Array.from({ length: childCount }, (_, index) => `c${index + 1}`)
    const persons = [
      { id: 'p1', displayOrder: 1 },
      { id: 'p2', displayOrder: 2 },
      ...childIds.map((id, index) => ({ id, displayOrder: index + 3 })),
    ]
    const unions = [
      { id: 'u1', partner1Id: 'p1', partner2Id: 'p2', displayOrder: 1 },
    ]
    const filiations = childIds.map((childId, index) => ({
      id: `f-${childId}`,
      childId,
      parentId: null,
      unionId: 'u1',
      parentageType: 'biologique',
      displayOrder: index + 1,
    }))

    const result = computeLayout({ persons, unions, filiations })
    return new Map(result.children.map((node) => [node.id, node]))
  }

  it('keeps the default sibling gap for families with fewer than three children', () => {
    const nodes = buildFamilyGraph(2)

    expect(nodes.get('p-c2').x - nodes.get('p-c1').x).toBe(PERSON_W + 60)
  })

  it('widens the sibling gap when a parent union has three children or more', () => {
    const nodes = buildFamilyGraph(3)

    expect(nodes.get('p-c2').x - nodes.get('p-c1').x).toBe(PERSON_W + 80)
  })

  it('places children below their parents (higher Y)', () => {
    const nodes = buildFamilyGraph(2)

    const parentY = nodes.get('p-p1').y
    const childY = nodes.get('p-c1').y
    expect(childY).toBeGreaterThan(parentY)
  })

  it('places partners on the same Y level', () => {
    const nodes = buildFamilyGraph(2)

    expect(nodes.get('p-p1').y).toBe(nodes.get('p-p2').y)
  })

  it('places partners side by side with no gap', () => {
    const nodes = buildFamilyGraph(2)

    const p1 = nodes.get('p-p1')
    const p2 = nodes.get('p-p2')
    const union = nodes.get('u-u1')
    // Union node should be between the two partners
    expect(union.x).toBeGreaterThan(p1.x)
    expect(union.x).toBeLessThan(p2.x)
  })

  it('keeps siblings contiguous when one marries into another family', () => {
    // Family A: dadA + momA → childA1, childA2, childA3
    // Family B: dadB + momB → childB1
    // childA1 marries childB1
    const persons = [
      { id: 'dadA', displayOrder: 1 },
      { id: 'momA', displayOrder: 2 },
      { id: 'dadB', displayOrder: 3 },
      { id: 'momB', displayOrder: 4 },
      { id: 'childA1', displayOrder: 5 },
      { id: 'childA2', displayOrder: 6 },
      { id: 'childA3', displayOrder: 7 },
      { id: 'childB1', displayOrder: 8 },
    ]
    const unions = [
      { id: 'uA', partner1Id: 'dadA', partner2Id: 'momA', displayOrder: 1 },
      { id: 'uB', partner1Id: 'dadB', partner2Id: 'momB', displayOrder: 2 },
      { id: 'uAB', partner1Id: 'childA1', partner2Id: 'childB1', displayOrder: 3 },
    ]
    const filiations = [
      { id: 'f-a1', childId: 'childA1', unionId: 'uA', parentId: null, parentageType: 'biologique', displayOrder: 1 },
      { id: 'f-a2', childId: 'childA2', unionId: 'uA', parentId: null, parentageType: 'biologique', displayOrder: 2 },
      { id: 'f-a3', childId: 'childA3', unionId: 'uA', parentId: null, parentageType: 'biologique', displayOrder: 3 },
      { id: 'f-b1', childId: 'childB1', unionId: 'uB', parentId: null, parentageType: 'biologique', displayOrder: 4 },
    ]

    const result = computeLayout({ persons, unions, filiations })
    const nodes = new Map(result.children.map(n => [n.id, n]))

    // All A siblings X positions
    const siblingXs = ['childA1', 'childA2', 'childA3']
      .map(id => nodes.get(`p-${id}`).x)
      .sort((a, b) => a - b)
    const aCenter = (siblingXs[0] + siblingXs[2]) / 2
    const maxSiblingSpan = siblingXs[2] - siblingXs[0]

    // Parents should be roughly centered above their children
    const dadAx = nodes.get('p-dadA').x
    const momAx = nodes.get('p-momA').x
    const parentCenter = (dadAx + momAx) / 2
    expect(Math.abs(parentCenter - aCenter)).toBeLessThan(maxSiblingSpan + PERSON_W)
  })

  it('places children under their parent union, not under another family', () => {
    // Two separate families, children should be under their own parents
    const persons = [
      { id: 'dadA', displayOrder: 1 },
      { id: 'momA', displayOrder: 2 },
      { id: 'dadB', displayOrder: 3 },
      { id: 'momB', displayOrder: 4 },
      { id: 'childA', displayOrder: 5 },
      { id: 'childB', displayOrder: 6 },
    ]
    const unions = [
      { id: 'uA', partner1Id: 'dadA', partner2Id: 'momA', displayOrder: 1 },
      { id: 'uB', partner1Id: 'dadB', partner2Id: 'momB', displayOrder: 2 },
    ]
    const filiations = [
      { id: 'f-a', childId: 'childA', unionId: 'uA', parentId: null, parentageType: 'biologique', displayOrder: 1 },
      { id: 'f-b', childId: 'childB', unionId: 'uB', parentId: null, parentageType: 'biologique', displayOrder: 2 },
    ]

    const result = computeLayout({ persons, unions, filiations })
    const nodes = new Map(result.children.map(n => [n.id, n]))

    const unionAx = nodes.get('u-uA').x + nodes.get('u-uA').width / 2
    const unionBx = nodes.get('u-uB').x + nodes.get('u-uB').width / 2
    const childAx = nodes.get('p-childA').x + PERSON_W / 2
    const childBx = nodes.get('p-childB').x + PERSON_W / 2

    // childA should be closer to union A than to union B
    expect(Math.abs(childAx - unionAx)).toBeLessThan(Math.abs(childAx - unionBx))
    // childB should be closer to union B than to union A
    expect(Math.abs(childBx - unionBx)).toBeLessThan(Math.abs(childBx - unionAx))
  })

  it('keeps all siblings side by side even with three separate families', () => {
    // Family A: 3 children, Family B: 2 children, Family C: 1 child
    // No cross-marriages
    const persons = [
      { id: 'dA', displayOrder: 1 }, { id: 'mA', displayOrder: 2 },
      { id: 'dB', displayOrder: 3 }, { id: 'mB', displayOrder: 4 },
      { id: 'dC', displayOrder: 5 }, { id: 'mC', displayOrder: 6 },
      { id: 'a1', displayOrder: 7 }, { id: 'a2', displayOrder: 8 }, { id: 'a3', displayOrder: 9 },
      { id: 'b1', displayOrder: 10 }, { id: 'b2', displayOrder: 11 },
      { id: 'c1', displayOrder: 12 },
    ]
    const unions = [
      { id: 'uA', partner1Id: 'dA', partner2Id: 'mA', displayOrder: 1 },
      { id: 'uB', partner1Id: 'dB', partner2Id: 'mB', displayOrder: 2 },
      { id: 'uC', partner1Id: 'dC', partner2Id: 'mC', displayOrder: 3 },
    ]
    const filiations = [
      { id: 'fa1', childId: 'a1', unionId: 'uA', parentId: null, parentageType: 'biologique', displayOrder: 1 },
      { id: 'fa2', childId: 'a2', unionId: 'uA', parentId: null, parentageType: 'biologique', displayOrder: 2 },
      { id: 'fa3', childId: 'a3', unionId: 'uA', parentId: null, parentageType: 'biologique', displayOrder: 3 },
      { id: 'fb1', childId: 'b1', unionId: 'uB', parentId: null, parentageType: 'biologique', displayOrder: 4 },
      { id: 'fb2', childId: 'b2', unionId: 'uB', parentId: null, parentageType: 'biologique', displayOrder: 5 },
      { id: 'fc1', childId: 'c1', unionId: 'uC', parentId: null, parentageType: 'biologique', displayOrder: 6 },
    ]

    const result = computeLayout({ persons, unions, filiations })
    const nodes = new Map(result.children.map(n => [n.id, n]))

    // Family A siblings should be contiguous
    const aXs = ['a1', 'a2', 'a3'].map(id => nodes.get(`p-${id}`).x).sort((a, b) => a - b)
    // Family B siblings
    const bXs = ['b1', 'b2'].map(id => nodes.get(`p-${id}`).x).sort((a, b) => a - b)
    // Family C child
    const cX = nodes.get('p-c1').x

    // No B or C child should be between A siblings
    for (const bx of bXs) {
      expect(bx < aXs[0] || bx > aXs[2]).toBe(true)
    }
    expect(cX < aXs[0] || cX > aXs[2]).toBe(true)
    // No A or C child should be between B siblings
    for (const ax of aXs) {
      expect(ax < bXs[0] || ax > bXs[1]).toBe(true)
    }
    expect(cX < bXs[0] || cX > bXs[1]).toBe(true)
  })
})

describe('separated parents', () => {
  // Philippe et Marie, parents d'Anaïs, sans couple enregistré (séparés)
  const persons = [{ id: 'phil' }, { id: 'marie' }, { id: 'anais' }]
  const filiations = [
    { id: 'f1', childId: 'anais', parentId: 'phil', unionId: null, parentageType: 'biologique', displayOrder: 1 },
    { id: 'f2', childId: 'anais', parentId: 'marie', unionId: null, parentageType: 'biologique', displayOrder: 2 },
  ]

  it('links the two parents with a dashed couple instead of two unknowns', () => {
    const result = computeLayout({ persons, unions: [], filiations })
    const ids = result.children.map((node) => node.id)
    expect(ids.some((id) => id.startsWith('unknown-'))).toBe(false)
    const pair = coupleBarMeta.find((entry) => entry.elkId.startsWith('u-pair:'))
    expect(pair).toMatchObject({ virtual: true })
    expect([pair.p1Key, pair.p2Key].sort()).toEqual(['p-marie', 'p-phil'])
    expect(result.edges.some((edge) => edge.sources[0] === pair.elkId && edge.targets[0] === 'p-anais')).toBe(true)
  })

  it('does not add a pair when the parents already have a union', () => {
    const unions = [{ id: 'u1', partner1Id: 'phil', partner2Id: 'marie', displayOrder: 1 }]
    expect(separatedPairUnions(filiations, unions)).toEqual([])
  })

  it('keeps a lone parent with an unknown partner', () => {
    expect(separatedPairUnions([filiations[0]], [])).toEqual([])
  })
})
