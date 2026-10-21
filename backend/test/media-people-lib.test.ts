import { describe, expect, it, vi } from 'vitest'

import { replaceMediaPeople } from '../src/lib/media-people.js'

describe('replaceMediaPeople', () => {
  it('keeps only people still in the tree, in the order sent', async () => {
    const db = {
      person: { findMany: vi.fn(async () => [{ id: 'p-3' }, { id: 'p-1' }]) },
      mediaPersonTag: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 2 })) },
    }
    const kept = await replaceMediaPeople(db as any, 't-1', 'm-1', [
      { personId: 'p-1', x: 0.1, y: 0.2 },
      { personId: 'p-deleted', x: null, y: null },
      { personId: 'p-3', x: null, y: null },
    ], 'u-1')
    expect(kept.map((p) => p.personId)).toEqual(['p-1', 'p-3'])
    expect(db.mediaPersonTag.deleteMany).toHaveBeenCalledWith({ where: { treeId: 't-1', mediaId: 'm-1' } })
    const rows = (db.mediaPersonTag.createMany.mock.calls[0] as any)[0].data
    expect(rows.map((row: any) => row.personId)).toEqual(['p-1', 'p-3'])
    expect(rows[0].createdAt.getTime()).toBeLessThan(rows[1].createdAt.getTime())
  })

  it('only clears when the list is empty', async () => {
    const db = {
      person: { findMany: vi.fn() },
      mediaPersonTag: { deleteMany: vi.fn(async () => ({ count: 3 })), createMany: vi.fn() },
    }
    expect(await replaceMediaPeople(db as any, 't-1', 'm-1', [], null)).toEqual([])
    expect(db.person.findMany).not.toHaveBeenCalled()
    expect(db.mediaPersonTag.createMany).not.toHaveBeenCalled()
  })
})
