import { describe, expect, it, vi } from 'vitest'

import { recordTreeVisit, VISIT_RETENTION_DAYS } from '../src/lib/tree-visits'

function fakeApp() {
  return {
    prisma: {
      treeVisit: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'v' }),
        update: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    },
  }
}

const request = { headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' }, ip: '203.0.113.10', log: { warn: vi.fn() } }

describe('journal des visites', () => {
  it('efface les visites de plus d’un an à l’enregistrement, au plus une fois par heure', async () => {
    const app = fakeApp()
    const before = Date.now()
    await recordTreeVisit(app as never, request as never, 'tree-1', 'share', null)
    await recordTreeVisit(app as never, request as never, 'tree-2', 'share', null)

    expect(app.prisma.treeVisit.create).toHaveBeenCalledTimes(2)
    expect(app.prisma.treeVisit.deleteMany).toHaveBeenCalledTimes(1)
    const cutoff = app.prisma.treeVisit.deleteMany.mock.calls[0][0].where.createdAt.lt.getTime()
    // Tous les arbres, pas seulement celui qu'on ouvre : un arbre qu'on ne rouvre plus est purgé aussi
    expect(app.prisma.treeVisit.deleteMany.mock.calls[0][0].where).not.toHaveProperty('treeId')
    expect(before - cutoff).toBeGreaterThanOrEqual(VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000 - 1000)
  })
})
