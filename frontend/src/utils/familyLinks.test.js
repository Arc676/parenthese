import { describe, expect, it } from 'vitest'
import { getCoupleParentLinks, getSiblingParentLinks } from './familyLinks'

describe('getSiblingParentLinks', () => {
  const unions = [{ id: 'u1', partner1Id: 'p1', partner2Id: 'p2' }]

  it('returns both partners of the union the person belongs to', () => {
    const filiations = [{ id: 'f1', childId: 'c1', parentId: null, unionId: 'u1' }]
    expect(getSiblingParentLinks('c1', filiations, unions)).toEqual([
      { parentId: 'p1', unionId: 'u1' },
      { parentId: 'p2', unionId: 'u1' },
    ])
  })

  it('returns direct parents without union', () => {
    const filiations = [{ id: 'f1', childId: 'c1', parentId: 'p3', unionId: null }]
    expect(getSiblingParentLinks('c1', filiations, unions)).toEqual([{ parentId: 'p3', unionId: null }])
  })

  it('does not return the same parent twice', () => {
    const filiations = [
      { id: 'f1', childId: 'c1', parentId: null, unionId: 'u1' },
      { id: 'f2', childId: 'c1', parentId: 'p1', unionId: null },
    ]
    expect(getSiblingParentLinks('c1', filiations, unions)).toHaveLength(2)
  })

  it('returns an empty list when the person has no known parent', () => {
    const filiations = [{ id: 'f1', childId: 'other', parentId: 'p1', unionId: null }]
    expect(getSiblingParentLinks('c1', filiations, unions)).toEqual([])
    expect(getSiblingParentLinks('c1', undefined, undefined)).toEqual([])
  })
})

describe('getCoupleParentLinks', () => {
  it('gives both partners when the parent has a single union', () => {
    const unions = [{ id: 'u1', partner1Id: 'p1', partner2Id: 'p2' }]
    expect(getCoupleParentLinks('p2', unions)).toEqual([
      { parentId: 'p1', unionId: 'u1' },
      { parentId: 'p2', unionId: 'u1' },
    ])
  })

  it('keeps the child with the parent alone when there is no union or several', () => {
    expect(getCoupleParentLinks('p1', [])).toEqual([])
    expect(getCoupleParentLinks('p1', undefined)).toEqual([])
    const unions = [
      { id: 'u1', partner1Id: 'p1', partner2Id: 'p2' },
      { id: 'u2', partner1Id: 'p3', partner2Id: 'p1' },
    ]
    expect(getCoupleParentLinks('p1', unions)).toEqual([])
  })
})
