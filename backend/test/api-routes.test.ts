import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { adoptedFamilies, familyExtras, personExtras } from '../src/lib/gedcom-events'
import { indexGedcomRecords } from '../src/lib/gedcom-photos'
import { parseGedcom } from '../src/routes/gedcom'

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
    lifeEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
    treeVisit: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
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

async function createUserToken(app: FastifyInstance, userId = 'user-1'): Promise<string> {
  await app.ready()
  return (app as any).jwt.sign(
    { kind: 'user', sub: userId, jti: randomUUID(), userId, email: 'user@example.com' },
    { expiresIn: '1h' },
  )
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
  prismaMock.user.create.mockResolvedValue({ id: 'user-1', email: 'user@example.com' })
  prismaMock.user.update.mockResolvedValue({ id: 'user-1' })

  prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null })
  prismaMock.tree.findUnique.mockResolvedValue({ id: 'tree-1', slug: 'tree-1', name: 'Tree' })
  prismaMock.tree.create.mockResolvedValue({ id: 'tree-1', slug: 'tree-1', name: 'Tree' })
  prismaMock.tree.updateMany.mockResolvedValue({ count: 1 })

  prismaMock.treeMembership.findMany.mockResolvedValue([])
  prismaMock.treeMembership.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    userId: 'user-1',
    role: 'owner',
    tree: { deletedAt: null, rootPersonId: null },
  })

  prismaMock.treeAccessPasswords.findUnique.mockResolvedValue({
    treeId: 'tree-1',
    visitorHash: 'hash',
    contributorHash: 'hash',
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
  prismaMock.person.findFirst.mockResolvedValue({ id: 'person-1' })
  prismaMock.person.create.mockResolvedValue({ id: 'person-1' })
  prismaMock.person.count.mockResolvedValue(0)
  prismaMock.person.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.union.findMany.mockResolvedValue([])
  prismaMock.union.create.mockResolvedValue({ id: 'union-1' })
  prismaMock.union.count.mockResolvedValue(0)
  prismaMock.parentChildLink.findMany.mockResolvedValue([])
  prismaMock.parentChildLink.create.mockResolvedValue({ id: 'link-1' })
  prismaMock.parentChildLink.count.mockResolvedValue(0)
  prismaMock.mediaItem.findMany.mockResolvedValue([])
  prismaMock.mediaItem.count.mockResolvedValue(0)
  prismaMock.annotation.findMany.mockResolvedValue([])
  prismaMock.contributionSession.count.mockResolvedValue(0)
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock))
  prismaMock.$disconnect.mockResolvedValue(undefined)
})

describe('Auth routes', () => {
  it('registers a new user and returns a token', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'new@example.com', password: 'password123' },
    })

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.token).toBeDefined()
    expect(body.user.email).toBe('user@example.com')
    await app.close()
  })

  it('rejects register with existing email', async () => {
    const app = createApp()
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing', email: 'taken@example.com' })

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'taken@example.com', password: 'password123' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toBe('email_already_exists')
    await app.close()
  })

  it('rejects register with invalid email', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'password123' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_payload')
    await app.close()
  })

  it('rejects register with short password', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'user@example.com', password: '123' },
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('rejects login with wrong credentials', async () => {
    const app = createApp()
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: '$2a$12$invalid_hash_that_wont_match_anything_00000000000000000',
    })

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@example.com', password: 'wrong-password' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe('invalid_credentials')
    await app.close()
  })

  it('rejects login for non-existent user', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.com', password: 'password123' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().error).toBe('invalid_credentials')
    await app.close()
  })

  it('rejects logout without token', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })
})

describe('Public routes', () => {
  it('resolves tree by slug', async () => {
    const app = createApp()
    prismaMock.tree.findFirst.mockResolvedValue({
      id: 'tree-1',
      slug: 'famille-martin',
      name: 'Famille Martin',
      description: null,
    })

    const response = await app.inject({
      method: 'GET',
      url: '/arbre/famille-martin',
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.tree.slug).toBe('famille-martin')
    expect(body.tree.name).toBe('Famille Martin')
    expect(body.tree).not.toHaveProperty('ownerEmail')
    expect(body.tree).not.toHaveProperty('ownerName')
    await app.close()
  })

  it('returns 404 for unknown slug', async () => {
    const app = createApp()
    prismaMock.tree.findFirst.mockResolvedValue(null)

    const response = await app.inject({
      method: 'GET',
      url: '/arbre/inexistant',
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().error).toBe('tree_not_found')
    await app.close()
  })

  it('returns 400 for invalid slug format', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'GET',
      url: '/arbre/ab',
    })

    expect(response.statusCode).toBe(400)
    await app.close()
  })
})

describe('Graph routes', () => {
  it('returns graph data for authenticated user', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    prismaMock.person.findMany.mockResolvedValue([
      {
        id: 'p-1',
        treeId: 'tree-1',
        firstName: 'Alice',
        lastName: 'Martin',
        birthDate: new Date('1990-01-15'),
        deathDate: null,
        sex: 'female',
        notes: null,
        createdBy: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])
    prismaMock.union.findMany.mockResolvedValue([])
    prismaMock.parentChildLink.findMany.mockResolvedValue([])
    prismaMock.mediaItem.findMany.mockResolvedValue([])

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.treeId).toBe('tree-1')
    expect(body.graph.persons).toHaveLength(1)
    expect(body.graph.persons[0].firstName).toBe('Alice')
    expect(body.graph.unions).toHaveLength(0)
    expect(body.graph.filiations).toHaveLength(0)
    await app.close()
  })

  it('rejects graph access without auth', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('rejects graph access for non-member user', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue(null)

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('frise de vie : lisible avec un accès à l’arbre, refusée pour un autre arbre, 404 pour une personne inconnue', async () => {
    const app = createApp()
    await app.ready()
    const sign = (treeId: string) => (app as any).jwt.sign({
      kind: 'tree_access',
      sub: `tree:${treeId}:visitor`,
      treeId,
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: null })
    prismaMock.person.findFirst.mockResolvedValue({
      id: 'p-1', birthDatePrecision: 'about', birthDateEnd: null, deathDatePrecision: null, deathDateEnd: null,
      deathPlace: 'Nantes, France', nickname: 'Loulou',
    })
    prismaMock.union.findMany.mockResolvedValue([
      { id: 'u-1', partner1PersonId: 'p-1', partner2PersonId: 'p-2', startDate: new Date('1905-01-01T00:00:00Z'), startPlace: 'Limoges', startDatePrecision: 'estimated', endDate: null },
    ])
    prismaMock.lifeEvent.findMany.mockResolvedValue([
      { id: 'e-1', personId: 'p-1', unionId: null, type: 'baptism', label: null, date: new Date('1879-03-09T00:00:00Z'), dateEnd: null, datePrecision: null, dateText: null, place: 'La Roche-sur-Yon', description: null, notes: null, sources: 'Registre', displayOrder: 1 },
    ])

    const ok = await app.inject({ method: 'GET', url: '/trees/tree-1/persons/p-1/life', headers: { authorization: `Bearer ${sign('tree-1')}` } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({
      person: { birthDatePrecision: 'about', deathPlace: 'Nantes, France', nickname: 'Loulou' },
      unions: [{ id: 'u-1', partnerId: 'p-2', startDate: '1905-01-01', startPlace: 'Limoges', startDatePrecision: 'estimated' }],
      events: [{ id: 'e-1', type: 'baptism', date: '1879-03-09', place: 'La Roche-sur-Yon', sources: 'Registre' }],
    })

    const other = await app.inject({ method: 'GET', url: '/trees/tree-1/persons/p-1/life', headers: { authorization: `Bearer ${sign('tree-2')}` } })
    expect(other.statusCode).toBe(403)

    prismaMock.person.findFirst.mockResolvedValue(null)
    const missing = await app.inject({ method: 'GET', url: '/trees/tree-1/persons/p-404/life', headers: { authorization: `Bearer ${sign('tree-1')}` } })
    expect(missing.statusCode).toBe(404)

    const anonymous = await app.inject({ method: 'GET', url: '/trees/tree-1/persons/p-1/life' })
    expect(anonymous.statusCode).toBe(401)
    await app.close()
  })

  it('export GEDCOM : précisions, événements, sources et adoption relus à l’identique', async () => {
    const app = createApp()
    await app.ready()
    const token = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:visitor',
      treeId: 'tree-1',
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })
    const base = { birthDateEnd: null, deathDateEnd: null, deathDatePrecision: null, deathPlace: null, nickname: null, notes: null, profession: null, deathDate: null }
    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', name: 'Ragot', rootPersonId: null })
    prismaMock.person.findMany.mockResolvedValue([
      { ...base, id: 'p-1', firstName: 'Louis', lastName: 'Ragot', sex: 'male', birthDate: new Date('1879-01-01T00:00:00Z'), birthDatePrecision: 'about', birthPlace: 'La Roche-sur-Yon', deathDate: new Date('1950-05-02T00:00:00Z'), deathPlace: 'Nantes', nickname: 'Loulou', profession: 'Instituteur' },
      { ...base, id: 'p-2', firstName: 'Marie', lastName: 'Bodin', sex: 'female', birthDate: null, birthDatePrecision: null, birthPlace: null, isDeceased: true },
      { ...base, id: 'p-3', firstName: 'Jean', lastName: 'Ragot', sex: 'male', birthDate: null, birthDatePrecision: null, birthPlace: null },
    ])
    prismaMock.union.findMany.mockResolvedValue([
      { id: 'u-1', partner1PersonId: 'p-1', partner2PersonId: 'p-2', startDate: new Date('1905-01-01T00:00:00Z'), startDatePrecision: 'estimated', startPlace: 'Limoges', endDate: null },
    ])
    prismaMock.parentChildLink.findMany.mockResolvedValue([
      { id: 'l-1', parentPersonId: 'p-1', childPersonId: 'p-3', viaUnionId: 'u-1', parentageType: 'adoption' },
      { id: 'l-2', parentPersonId: 'p-2', childPersonId: 'p-3', viaUnionId: 'u-1', parentageType: 'adoption' },
    ])
    const event = { label: null, dateEnd: null, datePrecision: null, dateText: null, place: null, description: null, notes: null, sources: null, displayOrder: 1 }
    prismaMock.lifeEvent.findMany.mockResolvedValue([
      { ...event, id: 'e-1', personId: 'p-1', unionId: null, type: 'birth', date: null, sources: 'Registre des naissances, Acte n° 12' },
      { ...event, id: 'e-2', personId: 'p-1', unionId: null, type: 'baptism', date: new Date('1879-03-09T00:00:00Z'), place: 'La Roche-sur-Yon' },
      { ...event, id: 'e-3', personId: 'p-1', unionId: null, type: 'occupation', date: new Date('1900-01-01T00:00:00Z'), dateEnd: new Date('1935-01-01T00:00:00Z'), datePrecision: 'from', description: 'Instituteur' },
      { ...event, id: 'e-4', personId: 'p-1', unionId: null, type: 'custom', label: 'Militaire', date: new Date('1914-01-01T00:00:00Z'), dateEnd: new Date('1918-01-01T00:00:00Z'), datePrecision: 'between', notes: 'Blessé à Verdun.\nRentré en 1919.' },
      { ...event, id: 'e-6', personId: null, unionId: 'u-1', type: 'marriage', date: null, sources: 'Registre des mariages de Limoges' },
      { ...event, id: 'e-7', personId: null, unionId: 'u-1', type: 'divorce', date: new Date('1920-06-01T00:00:00Z') },
    ])

    const response = await app.inject({ method: 'GET', url: '/trees/tree-1/export/gedcom', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    const text = response.body.replace(/\r\n/g, '\n')
    expect(text).toContain('1 OCCU Instituteur\n2 DATE FROM 1900 TO 1935')
    expect(text.match(/1 OCCU/g)).toHaveLength(1)
    expect(text).toContain('2 PEDI adopted')
    // Décédée sans date (issue #77) : la forme courte de la norme
    expect(text).toContain('1 NAME Marie /Bodin/\n1 SEX F\n1 DEAT Y\n')

    const roots = parseGedcom(text)
    const records = indexGedcomRecords(roots)
    const louis = roots.find((n) => n.tag === 'INDI' && n.children.some((c) => c.tag === 'NAME' && c.value.startsWith('Louis')))!
    const extras = personExtras(louis as never, records)
    expect(extras).toMatchObject({ birthDatePrecision: 'about', deathPlace: 'Nantes', nickname: 'Loulou' })
    expect(extras.events.map((e) => e.type)).toEqual(['birth', 'baptism', 'occupation', 'custom'])
    expect(extras.events[0].sources).toBe('Registre des naissances, Acte n° 12')
    expect(extras.events[3]).toMatchObject({ label: 'Militaire', datePrecision: 'between', notes: 'Blessé à Verdun.\nRentré en 1919.' })

    const fam = roots.find((n) => n.tag === 'FAM')!
    const family = familyExtras(fam as never, records)
    expect(family).toMatchObject({ startPlace: 'Limoges', startDatePrecision: 'estimated' })
    expect(family.events.map((e) => e.type)).toEqual(['marriage', 'divorce'])
    const jean = roots.find((n) => n.tag === 'INDI' && n.children.some((c) => c.tag === 'NAME' && c.value.startsWith('Jean')))!
    expect(adoptedFamilies(jean as never).size).toBe(1)
    await app.close()
  })

  it('allows tree access token to fetch graph', async () => {
    const app = createApp()
    await app.ready()

    const treeAccessToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:visitor',
      treeId: 'tree-1',
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: 'p-1' })
    prismaMock.person.findMany.mockResolvedValue([])
    prismaMock.union.findMany.mockResolvedValue([])
    prismaMock.parentChildLink.findMany.mockResolvedValue([])
    prismaMock.mediaItem.findMany.mockResolvedValue([])

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
      headers: { authorization: `Bearer ${treeAccessToken}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().rootPersonId).toBe('p-1')
    await app.close()
  })

  it('records a visit with the visitor first name when the graph opens', async () => {
    const app = createApp()
    await app.ready()

    const treeAccessToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:visitor',
      treeId: 'tree-1',
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: 'p-1' })
    prismaMock.person.findMany.mockResolvedValue([])
    prismaMock.union.findMany.mockResolvedValue([])
    prismaMock.parentChildLink.findMany.mockResolvedValue([])
    prismaMock.mediaItem.findMany.mockResolvedValue([])
    prismaMock.treeVisit.findFirst.mockResolvedValue(null)
    prismaMock.treeVisit.create.mockResolvedValue({})

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
      headers: {
        authorization: `Bearer ${treeAccessToken}`,
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
        'x-visitor-name': encodeURIComponent('Hélène'),
      },
    })

    expect(response.statusCode).toBe(200)
    await vi.waitFor(() => expect(prismaMock.treeVisit.create).toHaveBeenCalled())
    const data = prismaMock.treeVisit.create.mock.calls[0][0].data
    expect(data).toMatchObject({ treeId: 'tree-1', userId: null, accessKind: 'share', visitorName: 'Hélène', device: 'phone' })
    expect(data.visitorKey).toMatch(/^[0-9a-f]{32}$/)
    await app.close()
  })

  it('does not record a second visit for the same visitor within the window', async () => {
    const app = createApp()
    await app.ready()

    const treeAccessToken = (app as any).jwt.sign({
      kind: 'tree_access',
      sub: 'tree:tree-1:visitor',
      treeId: 'tree-1',
      role: 'visitor',
      accessVersion: new Date('2026-02-11T10:00:00.000Z').getTime(),
    })

    prismaMock.tree.findFirst.mockResolvedValue({ id: 'tree-1', rootPersonId: 'p-1' })
    prismaMock.person.findMany.mockResolvedValue([])
    prismaMock.union.findMany.mockResolvedValue([])
    prismaMock.parentChildLink.findMany.mockResolvedValue([])
    prismaMock.mediaItem.findMany.mockResolvedValue([])
    prismaMock.treeVisit.findFirst.mockResolvedValue({ id: 'v-1', visitorName: 'Hélène' })

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/graph',
      headers: { authorization: `Bearer ${treeAccessToken}` },
    })

    expect(response.statusCode).toBe(200)
    await vi.waitFor(() => expect(prismaMock.treeVisit.findFirst).toHaveBeenCalled())
    expect(prismaMock.treeVisit.create).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('Décès sans date (issue #77)', () => {
  it('marque décédé sans date, et une date de décès retire le drapeau', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/trees/tree-1/persons/person-1', headers: { authorization: `Bearer ${token}` }, payload })

    expect((await patch({ isDeceased: true })).statusCode).toBe(200)
    expect(prismaMock.person.updateMany.mock.calls.at(-1)[0].data).toMatchObject({ isDeceased: true })

    expect((await patch({ deathDate: '1950-01-01', isDeceased: true })).statusCode).toBe(200)
    expect(prismaMock.person.updateMany.mock.calls.at(-1)[0].data).toMatchObject({ isDeceased: false, deathDate: new Date('1950-01-01T00:00:00.000Z') })

    expect((await patch({ isDeceased: false, deathDate: null })).statusCode).toBe(200)
    expect(prismaMock.person.updateMany.mock.calls.at(-1)[0].data).toMatchObject({ isDeceased: false, deathDate: null })
    await app.close()
  })
})

describe('Moments de l’onglet Vie', () => {
  it('un admin ajoute un moment avec deux souvenirs, le modifie sans changer son type, le supprime', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const auth = { authorization: `Bearer ${token}` }
    prismaMock.mediaItem.count.mockResolvedValue(2)
    prismaMock.mediaItem.updateMany.mockResolvedValue({ count: 2 })
    prismaMock.lifeEvent.create.mockResolvedValue({ id: 'e-1', status: 'approved' })

    const created = await app.inject({
      method: 'POST', url: '/trees/tree-1/persons/person-1/life/events', headers: auth,
      payload: { label: 'Mariage à la mairie', date: '1940', datePrecision: 'about', place: 'Limoges', mediaIds: ['m-1', 'm-2'] },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual({ event: { id: 'e-1', status: 'approved' } })
    expect(prismaMock.lifeEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      treeId: 'tree-1', personId: 'person-1', type: 'custom', label: 'Mariage à la mairie', status: 'approved',
      date: new Date('1940-01-01T00:00:00.000Z'), datePrecision: 'about', place: 'Limoges', contributionSessionId: null,
    }) })
    expect(prismaMock.mediaItem.updateMany).toHaveBeenCalledWith({ where: { treeId: 'tree-1', id: { in: ['m-1', 'm-2'] } }, data: { lifeEventId: 'e-1' } })
    expect(prismaMock.contributionSession.create).not.toHaveBeenCalled()

    prismaMock.lifeEvent.findFirst.mockResolvedValue({ personId: 'person-1', unionId: null, type: 'occupation' })
    const patched = await app.inject({ method: 'PATCH', url: '/trees/tree-1/life/events/e-1', headers: auth, payload: { place: '', mediaIds: [] } })
    expect(patched.statusCode).toBe(200)
    expect(prismaMock.lifeEvent.update).toHaveBeenCalledWith({ where: { id: 'e-1' }, data: expect.objectContaining({ place: null }) })
    expect(prismaMock.lifeEvent.update.mock.calls[0][0].data).not.toHaveProperty('type')
    expect(prismaMock.mediaItem.updateMany).toHaveBeenCalledWith({ where: { treeId: 'tree-1', lifeEventId: 'e-1', id: { notIn: [] } }, data: { lifeEventId: null } })

    prismaMock.lifeEvent.updateMany.mockResolvedValue({ count: 1 })
    const deleted = await app.inject({ method: 'DELETE', url: '/trees/tree-1/life/events/e-1', headers: auth })
    expect(deleted.statusCode).toBe(204)
    await app.close()
  })

  it('naissance : un admin y accroche un acte et une source, une seule ligne par personne, sans date ni lieu', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const auth = { authorization: `Bearer ${token}` }
    prismaMock.mediaItem.count.mockResolvedValue(1)
    prismaMock.lifeEvent.findFirst.mockResolvedValueOnce(null)
    prismaMock.lifeEvent.create.mockResolvedValue({ id: 'e-b', status: 'approved' })
    const post = (payload: object) => app.inject({ method: 'POST', url: '/trees/tree-1/persons/person-1/life/events', headers: auth, payload })

    expect((await post({ type: 'birth', sources: 'Registre de Limoges', place: 'ignoré', mediaIds: ['acte'] })).statusCode).toBe(201)
    const data = prismaMock.lifeEvent.create.mock.calls[0][0].data
    expect(data).toMatchObject({ type: 'birth', personId: 'person-1', sources: 'Registre de Limoges' })
    expect(data).not.toHaveProperty('place')

    prismaMock.lifeEvent.findFirst.mockResolvedValueOnce({ id: 'e-b' })
    expect((await post({ type: 'birth', sources: 'x' })).statusCode).toBe(409)

    prismaMock.lifeEvent.findFirst.mockResolvedValue({ personId: 'person-1', unionId: null, type: 'birth' })
    expect((await app.inject({ method: 'PATCH', url: '/trees/tree-1/life/events/e-b', headers: auth, payload: { place: 'x', sources: 'Acte 12' } })).statusCode).toBe(200)
    expect(prismaMock.lifeEvent.update).toHaveBeenCalledWith({ where: { id: 'e-b' }, data: { notes: undefined, sources: 'Acte 12' } })
    await app.close()
  })

  it('la famille propose un moment : en attente, dans une contribution relue', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const auth = { authorization: `Bearer ${token}` }
    prismaMock.treeMembership.findUnique.mockResolvedValue({ role: 'member', tree: { deletedAt: null, settings: null } })
    prismaMock.contributionSession.count.mockResolvedValue(0)
    prismaMock.contributionSession.create.mockResolvedValue({ id: 's-1' })
    prismaMock.lifeEvent.create.mockResolvedValue({ id: 'e-2', status: 'pending', type: 'custom', place: 'Paris', notes: null, sources: null })

    const created = await app.inject({
      method: 'POST', url: '/trees/tree-1/persons/person-1/life/events', headers: auth,
      payload: { label: 'Départ pour Paris', date: '1925', submittedByLabel: 'Hélène' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual({ event: { id: 'e-2', status: 'pending' } })
    expect(prismaMock.contributionSession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'pending', submittedByLabel: 'Hélène' }) })
    expect(prismaMock.lifeEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'pending', contributionSessionId: 's-1' }) })
    expect(prismaMock.contributionChange.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      sessionId: 's-1', entityType: 'life_event', entityId: 'e-2', action: 'create', afterJson: expect.objectContaining({ title: 'Départ pour Paris' }),
    }) })

    // La famille ne touche ni aux naissances ni aux moments existants
    expect((await app.inject({ method: 'POST', url: '/trees/tree-1/persons/person-1/life/events', headers: auth, payload: { type: 'birth', sources: 'x' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'PATCH', url: '/trees/tree-1/life/events/e-1', headers: auth, payload: { place: 'x' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: '/trees/tree-1/life/events/e-1', headers: auth })).statusCode).toBe(403)
    await app.close()
  })

  it('refuse un souvenir d’une autre personne, un moment sans titre, un mariage sans union de la personne', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const auth = { authorization: `Bearer ${token}` }
    const post = (payload: object) => app.inject({ method: 'POST', url: '/trees/tree-1/persons/person-1/life/events', headers: auth, payload })

    prismaMock.mediaItem.count.mockResolvedValue(0)
    expect((await post({ label: 'Mariage', mediaIds: ['autre'] })).statusCode).toBe(400)
    expect((await post({ label: '  ' })).statusCode).toBe(400)
    prismaMock.union.findFirst.mockResolvedValue(null)
    expect((await post({ type: 'marriage', unionId: 'u-x', sources: 'x' })).statusCode).toBe(400)
    expect(prismaMock.lifeEvent.create).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('Visit log', () => {
  it('refuses the visit log to a non-admin member', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue({ role: 'member', tree: { deletedAt: null } })

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/visits',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('returns totals without the admin own visits, and recent visits', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findUnique.mockResolvedValue({ role: 'owner', tree: { deletedAt: null } })
    prismaMock.treeVisit.deleteMany.mockResolvedValue({ count: 0 })
    const now = Date.now()
    prismaMock.treeVisit.findMany
      .mockResolvedValueOnce([
        { visitorKey: 'a', createdAt: new Date(now - 1000) },
        { visitorKey: 'a', createdAt: new Date(now - 2 * 86400000) },
        { visitorKey: 'b', createdAt: new Date(now - 10 * 86400000) },
      ])
      .mockResolvedValueOnce([
        { id: 'v-2', createdAt: new Date(now - 1000), accessKind: 'share', visitorName: 'Hélène', device: 'phone', userId: null, user: null },
        { id: 'v-1', createdAt: new Date(now - 5000), accessKind: 'member', visitorName: null, device: 'desktop', userId: 'user-1', user: { email: 'user@example.com' } },
      ])

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/visits',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.summary).toEqual({ last7: { visits: 2, visitors: 1 }, last30: { visits: 3, visitors: 2 } })
    expect(body.recent[0]).toMatchObject({ name: 'Hélène', device: 'phone', isYou: false })
    expect(body.recent[1]).toMatchObject({ email: 'user@example.com', isYou: true })
    const totalsWhere = prismaMock.treeVisit.findMany.mock.calls[0][0].where
    expect(totalsWhere.OR).toEqual([{ userId: null }, { userId: { not: 'user-1' } }])
    await app.close()
  })
})

describe('Health check', () => {
  it('returns ok', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    await app.close()
  })
})

describe('CORS', () => {
  it('annonce PUT, PATCH et DELETE dans la réponse de pré-vérification', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/trees/tree-1',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'DELETE' },
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(response.headers['access-control-allow-methods']).toBe('GET,HEAD,PUT,PATCH,POST,DELETE')
    await app.close()
  })
})

describe('Tree CRUD', () => {
  it('creates a tree and returns it', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'POST',
      url: '/trees',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Mon Arbre',
        slug: 'mon-arbre',
        visitorPassword: 'visitor-pass-123',
        contributorPassword: 'contributor-pass-123',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.tree.create).toHaveBeenCalled()
    const createCall = prismaMock.tree.create.mock.calls[0][0]
    expect(createCall.data.memberships.create.role).toBe('owner')
    expect(createCall.data.settings.create).toBeDefined()
    expect(createCall.data.accessPasswords.create.visitorHash).toBeDefined()
    await app.close()
  })

  it('requires auth to create a tree', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'POST',
      url: '/trees',
      payload: { name: 'Mon Arbre', slug: 'mon-arbre' },
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('lists user trees', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeMembership.findMany.mockResolvedValue([
      {
        role: 'owner',
        tree: { id: 'tree-1', slug: 'mon-arbre', name: 'Mon Arbre', description: null, rootPersonId: null, createdAt: new Date() },
      },
    ])

    const response = await app.inject({
      method: 'GET',
      url: '/trees',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.trees).toHaveLength(1)
    expect(body.trees[0].name).toBe('Mon Arbre')
    await app.close()
  })

  it('requires auth to list trees', async () => {
    const app = createApp()

    const response = await app.inject({
      method: 'GET',
      url: '/trees',
    })

    expect(response.statusCode).toBe(401)
    await app.close()
  })
})

describe('Relationship guardrails', () => {
  it('rejects creating a union between ancestor and descendant', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    prismaMock.person.findFirst.mockImplementation(async (args: any) => ({
      id: args.where.id,
    }))
    prismaMock.parentChildLink.findMany.mockResolvedValue([
      {
        id: 'link-1',
        parentPersonId: 'person-parent',
        childPersonId: 'person-child',
        viaUnionId: null,
      },
    ])
    prismaMock.union.findMany.mockResolvedValue([])

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/unions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        partner1PersonId: 'person-parent',
        partner2PersonId: 'person-child',
        unionType: 'mariage',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('forbidden_union_with_ancestor_descendant')
    expect(prismaMock.union.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects creating a parent-child link that introduces a cycle', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    prismaMock.person.findFirst.mockImplementation(async (args: any) => ({
      id: args.where.id,
    }))
    prismaMock.union.findMany.mockResolvedValue([])
    prismaMock.parentChildLink.findMany.mockResolvedValue([
      {
        id: 'link-a',
        parentPersonId: 'a',
        childPersonId: 'b',
        viaUnionId: null,
      },
      {
        id: 'link-b',
        parentPersonId: 'b',
        childPersonId: 'c',
        viaUnionId: null,
      },
    ])

    const response = await app.inject({
      method: 'POST',
      url: '/trees/tree-1/links',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        parentPersonId: 'c',
        childPersonId: 'a',
        parentageType: 'biologique',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('parent_child_cycle_detected')
    expect(prismaMock.parentChildLink.create).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('Surnom (nickname) en écriture directe', () => {
  it('PATCH accepte le surnom, le coupe, et vide = null', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: '/trees/tree-1/persons/person-1', headers: { authorization: `Bearer ${token}` }, payload })

    expect((await patch({ nickname: '  Loulou  ' })).statusCode).toBe(200)
    expect(prismaMock.person.updateMany.mock.calls.at(-1)[0].data).toMatchObject({ nickname: 'Loulou' })

    expect((await patch({ nickname: '   ' })).statusCode).toBe(200)
    expect(prismaMock.person.updateMany.mock.calls.at(-1)[0].data).toMatchObject({ nickname: null })
    await app.close()
  })

  it('refuse un surnom de plus de 120 caractères', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    const res = await app.inject({ method: 'PATCH', url: '/trees/tree-1/persons/person-1', headers: { authorization: `Bearer ${token}` }, payload: { nickname: 'x'.repeat(121) } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
