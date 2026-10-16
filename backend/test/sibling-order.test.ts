import { describe, expect, it, vi } from 'vitest'

import { nextSiblingOrder } from '../src/lib/sibling-order.js'

function dbReturning(last: { displayOrder: number } | null) {
  const findFirst = vi.fn().mockResolvedValue(last)
  return { db: { parentChildLink: { findFirst } } as any, findFirst }
}

describe('nextSiblingOrder', () => {
  it('places a new child after the last sibling of the parent', async () => {
    const { db, findFirst } = dbReturning({ displayOrder: 3 })
    await expect(nextSiblingOrder(db, 'tree-1', 'parent-1')).resolves.toBe(4)
    expect(findFirst).toHaveBeenCalledWith({
      where: { treeId: 'tree-1', parentPersonId: 'parent-1', deletedAt: null },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    })
  })

  it('starts at 1 for a first child', async () => {
    const { db } = dbReturning(null)
    await expect(nextSiblingOrder(db, 'tree-1', 'parent-1')).resolves.toBe(1)
  })
})
