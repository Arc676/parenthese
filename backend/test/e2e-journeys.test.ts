import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * E2E Journey Tests — Tests the 4 core user journeys
 * using Fastify inject with a mocked Prisma layer.
 *
 * Journey 1: Owner creates account + tree + adds persons
 * Journey 2: Visitor accesses tree via slug + password
 * Journey 3: Contributor submits a session
 * Journey 4: Admin reviews the session
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn(),
      update: vi.fn(),
    },
    tree: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    treeMembership: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    treeSettings: {
      create: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    treeAccessPasswords: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userTreeAccess: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    person: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    union: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    parentChildLink: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    mediaItem: {
      count: vi.fn(),      aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    annotation: {
      findMany: vi.fn(),
    },
    contributionSession: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn(),
    },
    contributionChange: {
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}))

let createApp: () => FastifyInstance

function applyTestEnv(): void {
  process.env.NODE_ENV = 'test'
  process.env.PORT = '4000'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.JWT_EXPIRES_IN = '7d'
  process.env.JWT_TREE_ACCESS_EXPIRES_IN = '24h'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
}

beforeAll(async () => {
  applyTestEnv()
  const module = await import('../src/app.js')
  createApp = module.createApp
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.userTreeAccess.deleteMany?.mockResolvedValue({ count: 0 })
  prismaMock.contributionSession.updateMany?.mockResolvedValue({ count: 1 })
  prismaMock.mediaItem.aggregate?.mockResolvedValue({ _sum: { sizeBytes: 0 } })

  prismaMock.user.findUnique.mockResolvedValue(null)
  prismaMock.user.create.mockResolvedValue({ id: 'user-1', email: 'owner@example.com' })
  prismaMock.user.update.mockResolvedValue({ id: 'user-1' })

  prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null, deletedAt: null })
  prismaMock.tree.findUnique.mockResolvedValue({ id: 'tree-1', slug: 'famille-martin', name: 'Famille Martin' })
  prismaMock.tree.create.mockResolvedValue({ id: 'tree-1', slug: 'famille-martin', name: 'Famille Martin' })
  prismaMock.tree.updateMany.mockResolvedValue({ count: 1 })

  prismaMock.treeMembership.findMany.mockResolvedValue([])
  prismaMock.treeMembership.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    userId: 'user-1',
    role: 'owner',
    contributionModeOverride: null,
    tree: { deletedAt: null, rootPersonId: null, settings: { memberContributionPolicy: 'pending' } },
  })
  prismaMock.treeMembership.create.mockResolvedValue({ treeId: 'tree-1', userId: 'user-1', role: 'owner' })

  prismaMock.treeAccessPasswords.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    visitorHash: '$2a$12$examplehashvisitor000000000000000000000000000000',
    contributorHash: '$2a$12$examplehashcontrib0000000000000000000000000000000',
    updatedAt: new Date('2026-02-11T10:00:00.000Z'),
    tree: { deletedAt: null },
  })
  prismaMock.userTreeAccess.findMany.mockResolvedValue([])
  prismaMock.userTreeAccess.findUnique.mockResolvedValue(null)
  prismaMock.userTreeAccess.upsert.mockResolvedValue({
    id: 'share-1',
    treeId: 'tree-1',
    userId: 'user-1',
    role: 'visitor',
  })
  prismaMock.userTreeAccess.updateMany.mockResolvedValue({ count: 0 })

  prismaMock.treeSettings.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    memberContributionPolicy: 'pending',
    visitorPolicy: 'read_only',
    contributorPolicy: 'pending',
  })
  prismaMock.treeSettings.create.mockResolvedValue({ treeId: 'tree-1' })

  prismaMock.person.findMany.mockResolvedValue([])
  prismaMock.person.findFirst.mockResolvedValue({ id: 'person-1', treeId: 'tree-1', deletedAt: null })
  prismaMock.person.create.mockResolvedValue({
    id: 'person-1',
    treeId: 'tree-1',
    firstName: 'Pierre',
    lastName: 'Martin',
  })
  prismaMock.person.count.mockResolvedValue(0)
  prismaMock.person.updateMany.mockResolvedValue({ count: 1 })

  prismaMock.union.findMany.mockResolvedValue([])
  prismaMock.union.findFirst.mockResolvedValue({
    id: 'union-1',
    treeId: 'tree-1',
    deletedAt: null,
    partner1PersonId: 'person-2',
    partner2PersonId: null,
  })
  prismaMock.union.create.mockResolvedValue({ id: 'union-1' })
  prismaMock.union.count.mockResolvedValue(0)

  prismaMock.parentChildLink.findMany.mockResolvedValue([])
  prismaMock.parentChildLink.findFirst.mockResolvedValue({ id: 'link-1', treeId: 'tree-1', deletedAt: null })
  prismaMock.parentChildLink.create.mockResolvedValue({ id: 'link-1' })
  prismaMock.parentChildLink.count.mockResolvedValue(0)

  prismaMock.mediaItem.findMany.mockResolvedValue([])
  prismaMock.mediaItem.count.mockResolvedValue(0)
  prismaMock.annotation.findMany.mockResolvedValue([])

  prismaMock.contributionSession.create.mockImplementation(async (args: any) => ({
    id: 'session-1',
    treeId: args.data.treeId,
    status: args.data.status,
    title: args.data.title,
    ...args.data,
  }))
  prismaMock.contributionSession.findFirst.mockResolvedValue(null)
  prismaMock.contributionSession.findMany.mockResolvedValue([])
  prismaMock.contributionSession.count.mockResolvedValue(0)
  prismaMock.contributionSession.update.mockImplementation(async (args: any) => ({
    id: args.where.id,
    ...args.data,
  }))

  prismaMock.contributionChange.create.mockImplementation(async (args: any) => ({
    id: `change-${randomUUID().slice(0, 8)}`,
    ...args.data,
  }))
  prismaMock.contributionChange.update.mockResolvedValue({ id: 'change-1' })

  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  prismaMock.auditLog.findMany.mockResolvedValue([])

  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock))
  prismaMock.$disconnect.mockResolvedValue(undefined)
})

describe('Journey 1 — Owner creates account, tree, and adds family', () => {
  it('full owner onboarding flow', async () => {
    const app = createApp()

    // Step 1: Register
    const registerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'owner@example.com', password: 'securepass123' },
    })
    expect(registerRes.statusCode).toBe(201)
    const { token } = registerRes.json()
    expect(token).toBeDefined()

    // Step 2: Create tree
    const createTreeRes = await app.inject({
      method: 'POST',
      url: '/trees',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Famille Martin',
        slug: 'famille-martin',
        visitorPassword: 'visitor-pass-123',
        contributorPassword: 'contributor-pass-123',
      },
    })
    expect(createTreeRes.statusCode).toBe(201)
    expect(prismaMock.tree.create).toHaveBeenCalled()

    // Step 3: Add self (person)
    const addSelfRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        firstName: 'Pierre',
        lastName: 'Martin',
        birthDate: '1990-03-15',
        sex: 'male',
      },
    })
    expect(addSelfRes.statusCode).toBe(201)

    // Step 4: Add parent
    prismaMock.person.create.mockResolvedValue({ id: 'person-2', firstName: 'Jean', lastName: 'Martin' })
    const addParentRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        firstName: 'Jean',
        lastName: 'Martin',
        birthDate: '1960-07-20',
        sex: 'male',
      },
    })
    expect(addParentRes.statusCode).toBe(201)

    // Step 5: Create union (parents)
    const addUnionRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/unions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        partner1PersonId: 'person-2',
        partner2PersonId: null,
        unionType: 'marriage',
      },
    })
    expect(addUnionRes.statusCode).toBe(201)

    // Step 6: Create filiation link
    const addLinkRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/links',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        parentPersonId: 'person-2',
        childPersonId: 'person-1',
        viaUnionId: 'union-1',
      },
    })
    expect(addLinkRes.statusCode).toBe(201)

    // Step 7: Verify graph returns data
    prismaMock.person.findMany.mockResolvedValue([
      { id: 'person-1', treeId: 'tree-1', firstName: 'Pierre', lastName: 'Martin', birthDate: new Date('1990-03-15'), deathDate: null, sex: 'male', notes: null, createdBy: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
      { id: 'person-2', treeId: 'tree-1', firstName: 'Jean', lastName: 'Martin', birthDate: new Date('1960-07-20'), deathDate: null, sex: 'male', notes: null, createdBy: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
    ])
    prismaMock.parentChildLink.findMany.mockResolvedValue([
      { id: 'link-1', treeId: 'tree-1', parentPersonId: 'person-2', childPersonId: 'person-1', viaUnionId: 'union-1' },
    ])

    const graphRes = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(graphRes.statusCode).toBe(200)
    const graph = graphRes.json()
    expect(graph.graph.persons).toHaveLength(2)
    expect(graph.graph.filiations).toHaveLength(1)

    await app.close()
  })
})

describe('Journey 2 — Visitor accesses tree via slug + password', () => {
  it('full visitor access flow', async () => {
    const app = createApp()

    // Step 1: Resolve slug
    prismaMock.tree.findFirst.mockResolvedValue({
      id: 'tree-1',
      slug: 'famille-martin',
      name: 'Famille Martin',
      description: null,
    })

    const slugRes = await app.inject({
      method: 'GET',
      url: '/arbre/famille-martin',
    })
    expect(slugRes.statusCode).toBe(200)
    expect(slugRes.json().tree.slug).toBe('famille-martin')

    // Step 2: Unlock with visitor password — we need bcrypt to work
    // Since we mock the hash, we simulate the unlock by directly creating a tree-access token
    await app.ready()
    const treeAccessToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:visitor',
      treeId: 'tree-1',
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    // Step 3: Fetch graph with tree-access token
    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: 'person-1' })
    prismaMock.person.findMany.mockResolvedValue([
      { id: 'person-1', treeId: 'tree-1', firstName: 'Pierre', lastName: 'Martin', birthDate: new Date('1990-03-15'), deathDate: null, sex: 'male', notes: null, createdBy: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null },
    ])
    prismaMock.union.findMany.mockResolvedValue([])
    prismaMock.parentChildLink.findMany.mockResolvedValue([])
    prismaMock.mediaItem.findMany.mockResolvedValue([])

    const graphRes = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
      headers: { authorization: `Bearer ${treeAccessToken}` },
    })
    expect(graphRes.statusCode).toBe(200)
    expect(graphRes.json().graph.persons).toHaveLength(1)
    expect(graphRes.json().rootPersonId).toBe('person-1')

    // Step 4: Visitor cannot create persons directly
    const createRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/persons',
      headers: { authorization: `Bearer ${treeAccessToken}` },
      payload: { firstName: 'Hack', lastName: 'Attempt' },
    })
    expect(createRes.statusCode).toBe(401)

    await app.close()
  })
})

describe('Journey 3 — Contributor submits a contribution session', () => {
  it('full contribution submission flow', async () => {
    const app = createApp()
    await app.ready()

    // Contributor has a tree-access token with contributor role
    const contributorToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:contributor',
      treeId: 'tree-1',
      role: 'contributor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    // Setup: tree exists with pending contributor policy
    prismaMock.tree.findFirst.mockResolvedValue({
      id: 'tree-1',
      deletedAt: null,
      settings: { contributorPolicy: 'pending' },
    })

    // Step 1: Submit a contribution session with a person creation
    const submitRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${contributorToken}` },
      payload: {
        title: 'Contribution de Tatie Jeanette',
        submittedByLabel: 'Jeanette Martin',
        changes: [
          {
            entityType: 'person',
            action: 'create',
            after: {
              firstName: 'Marie',
              lastName: 'Martin',
              birthDate: '1955-12-01',
              sex: 'female',
            },
          },
          {
            entityType: 'person',
            action: 'update',
            entityId: 'person-1',
            before: { firstName: 'Pierre' },
            after: { notes: 'Surnomme Pierrot' },
          },
        ],
      },
    })

    expect(submitRes.statusCode).toBe(201)
    const body = submitRes.json()
    expect(body.session.status).toBe('pending')
    expect(body.changesCount).toBe(2)

    // The changes should NOT be applied (pending status)
    expect(prismaMock.person.create).not.toHaveBeenCalled()
    expect(prismaMock.person.updateMany).not.toHaveBeenCalled()

    // Audit log should be created
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'contribution_session_submitted',
          entityType: 'contribution_session',
        }),
      }),
    )

    await app.close()
  })

  it('auto-applies when admin submits', async () => {
    const app = createApp()
    await app.ready()

    const ownerToken = (app as any).jwt.sign(
      { kind: 'user', sub: 'user-1', jti: randomUUID(), userId: 'user-1', email: 'owner@example.com' },
      { expiresIn: '1h' },
    )

    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', deletedAt: null })

    const submitRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        title: 'Ajout rapide par admin',
        changes: [
          {
            entityType: 'person',
            action: 'create',
            after: {
              firstName: 'Claude',
              lastName: 'Martin',
              sex: 'male',
            },
          },
        ],
      },
    })

    expect(submitRes.statusCode).toBe(201)
    expect(submitRes.json().session.status).toBe('approved')

    // Changes SHOULD be applied directly
    expect(prismaMock.person.create).toHaveBeenCalled()

    await app.close()
  })
})

describe('Journey 4 — Admin reviews a contribution session', () => {
  it('full admin moderation flow — approve all', async () => {
    const app = createApp()
    await app.ready()

    const adminToken = (app as any).jwt.sign(
      { kind: 'user', sub: 'user-1', jti: randomUUID(), userId: 'user-1', email: 'owner@example.com' },
      { expiresIn: '1h' },
    )

    // Setup: there is a pending session with 2 changes
    prismaMock.contributionSession.findFirst.mockResolvedValue({
      id: 'session-1',
      treeId: 'tree-1',
      status: 'pending',
      title: 'Contribution de Tatie',
      changes: [
        {
          id: 'change-1',
          entityType: 'person',
          action: 'create',
          entityId: null,
          beforeJson: null,
          afterJson: { firstName: 'Marie', lastName: 'Martin', birthDate: '1955-12-01', sex: 'female' },
          conflictState: 'none',
        },
        {
          id: 'change-2',
          entityType: 'person',
          action: 'update',
          entityId: 'person-1',
          beforeJson: { firstName: 'Pierre' },
          afterJson: { notes: 'Surnomme Pierrot' },
          conflictState: 'none',
        },
      ],
    })

    // Mock: person-1 still has same firstName as beforeJson (no conflict)
    prismaMock.person.findFirst.mockResolvedValue({
      id: 'person-1',
      treeId: 'tree-1',
      firstName: 'Pierre',
      lastName: 'Martin',
      birthDate: null,
      deathDate: null,
      sex: 'male',
      notes: null,
      deletedAt: null,
    })

    const reviewRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions/session-1/review',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        decision: 'approved',
      },
    })

    expect(reviewRes.statusCode).toBe(200)
    const body = reviewRes.json()
    expect(body.approvedCount).toBe(2)
    expect(body.rejectedCount).toBe(0)
    expect(body.conflictCount).toBe(0)

    // Both changes should be applied
    expect(prismaMock.person.create).toHaveBeenCalled()
    expect(prismaMock.person.updateMany).toHaveBeenCalled()

    // Audit log for review
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'contribution_session_reviewed',
        }),
      }),
    )

    await app.close()
  })

  it('partial review — approve one, reject one', async () => {
    const app = createApp()
    await app.ready()

    const adminToken = (app as any).jwt.sign(
      { kind: 'user', sub: 'user-1', jti: randomUUID(), userId: 'user-1', email: 'owner@example.com' },
      { expiresIn: '1h' },
    )

    prismaMock.contributionSession.findFirst.mockResolvedValue({
      id: 'session-2',
      treeId: 'tree-1',
      status: 'pending',
      title: 'Mixed review',
      changes: [
        {
          id: 'change-a',
          entityType: 'person',
          action: 'create',
          entityId: null,
          beforeJson: null,
          afterJson: { firstName: 'Bon', lastName: 'Ajout' },
          conflictState: 'none',
        },
        {
          id: 'change-b',
          entityType: 'person',
          action: 'update',
          entityId: 'person-1',
          beforeJson: { firstName: 'Pierre' },
          afterJson: { firstName: 'WRONG NAME' },
          conflictState: 'none',
        },
      ],
    })

    prismaMock.person.findFirst.mockResolvedValue({
      id: 'person-1',
      treeId: 'tree-1',
      firstName: 'Pierre',
      lastName: 'Martin',
      birthDate: null,
      deathDate: null,
      sex: null,
      notes: null,
      deletedAt: null,
    })

    const reviewRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions/session-2/review',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        decision: 'rejected',
        changeDecisions: [
          { changeId: 'change-a', decision: 'approved' },
        ],
      },
    })

    expect(reviewRes.statusCode).toBe(200)
    const body = reviewRes.json()
    expect(body.approvedCount).toBe(1)
    expect(body.rejectedCount).toBe(1)

    // Only person create should have been called, not updateMany
    expect(prismaMock.person.create).toHaveBeenCalledTimes(1)

    await app.close()
  })

  it('detects conflict when entity changed since submission', async () => {
    const app = createApp()
    await app.ready()

    const adminToken = (app as any).jwt.sign(
      { kind: 'user', sub: 'user-1', jti: randomUUID(), userId: 'user-1', email: 'owner@example.com' },
      { expiresIn: '1h' },
    )

    prismaMock.contributionSession.findFirst.mockResolvedValue({
      id: 'session-3',
      treeId: 'tree-1',
      status: 'pending',
      title: 'Conflict test',
      changes: [
        {
          id: 'change-c',
          entityType: 'person',
          action: 'update',
          entityId: 'person-1',
          beforeJson: { firstName: 'Pierre' },
          afterJson: { firstName: 'Pierrot' },
          conflictState: 'none',
        },
      ],
    })

    // The person's firstName has changed since submission (was 'Pierre', now 'Pierre-Louis')
    prismaMock.person.findFirst.mockResolvedValue({
      id: 'person-1',
      treeId: 'tree-1',
      firstName: 'Pierre-Louis',
      lastName: 'Martin',
      birthDate: null,
      deathDate: null,
      sex: 'male',
      notes: null,
      deletedAt: null,
    })

    const reviewRes = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/contributions/sessions/session-3/review',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        decision: 'approved',
      },
    })

    expect(reviewRes.statusCode).toBe(200)
    expect(reviewRes.json().conflictCount).toBe(1)

    // conflictState should have been updated
    expect(prismaMock.contributionChange.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'change-c' },
        data: { conflictState: 'needs_review' },
      }),
    )

    await app.close()
  })
})
