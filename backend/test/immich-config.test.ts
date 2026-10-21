import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Connexion Immich par arbre : chaque arbre porte ses identifiants en base, seuls ses
// administrateurs les configurent, et la clé d'API ne ressort jamais du serveur.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      count: vi.fn(),
    },
    person: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    treeMembership: {
      findUnique: vi.fn(),
    },
    treeImmichConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    mediaItem: {
      aggregate: vi.fn(),
    },
    mediaPersonTag: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: prismaMock,
}))

let createApp: () => FastifyInstance
let encryptImmichApiKey: (value: string) => string
let TREE_1_ENC = ''
let TREE_2_ENC = ''
const fetchMock = vi.fn()

async function createUserToken(app: FastifyInstance, userId = 'user-1'): Promise<string> {
  await app.ready()
  return (app as any).jwt.sign(
    { kind: 'user', sub: userId, jti: randomUUID(), userId, email: 'user@example.com' },
    { expiresIn: '1h' },
  )
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.PORT = '4000'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.JWT_EXPIRES_IN = '7d'
  process.env.JWT_TREE_ACCESS_EXPIRES_IN = '24h'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
  // Instances autorisées par l'opérateur du serveur : les administrateurs d'un arbre
  // choisissent parmi elles, jamais en champ libre.
  process.env.IMMICH_ALLOWED_API_URLS = 'http://immich-tree-1.test,http://immich-tree-2.test,Maison=http://immich.example.org:2283,http://immich.example.org,http://immich-moved.example.org'

  // Les clés chiffrées se calculent après la mise en place de JWT_SECRET, comme en production.
  const secret = await import('../src/lib/immich-secret.js')
  encryptImmichApiKey = secret.encryptImmichApiKey
  TREE_1_ENC = encryptImmichApiKey('secret-key-tree-1')
  TREE_2_ENC = encryptImmichApiKey('secret-key-tree-2')

  const module = await import('../src/app.js')
  createApp = module.createApp

  vi.stubGlobal('fetch', fetchMock)
})

beforeEach(async () => {
  vi.clearAllMocks()

  prismaMock.user.count.mockResolvedValue(1)

  // user-1 administre tree-1 ; user-2 administre tree-2. Jamais l'arbre de l'autre.
  prismaMock.treeMembership.findUnique.mockImplementation(async ({ where }: { where: { treeId_userId?: { treeId: string; userId: string } } }) => {
    const { treeId, userId } = where.treeId_userId ?? ({} as { treeId: string; userId: string })
    if (treeId === 'tree-1' && userId === 'user-1') {
      return { treeId, userId, role: 'owner', tree: { deletedAt: null } }
    }
    if (treeId === 'tree-2' && userId === 'user-2') {
      return { treeId, userId, role: 'owner', tree: { deletedAt: null } }
    }
    if (treeId === 'tree-1' && userId === 'user-member') {
      return { treeId, userId, role: 'member', tree: { deletedAt: null } }
    }
    return null
  })

  prismaMock.treeImmichConfig.findUnique.mockImplementation(async ({ where }: { where: { treeId: string } }) => {
    if (where.treeId === 'tree-1') {
      return { apiUrl: 'http://immich-tree-1.test', apiKeyEnc: TREE_1_ENC, updatedAt: new Date('2026-10-01T00:00:00Z') }
    }
    if (where.treeId === 'tree-2') {
      return { apiUrl: 'http://immich-tree-2.test', apiKeyEnc: TREE_2_ENC, updatedAt: new Date('2026-10-02T00:00:00Z') }
    }
    return null
  })

  prismaMock.treeImmichConfig.upsert.mockImplementation(async (args: {
    create?: { apiUrl: string }
    update?: { apiUrl: string }
  }) => ({
    apiUrl: args.create?.apiUrl ?? args.update?.apiUrl,
    apiKeyEnc: args.create?.apiKeyEnc ?? args.update?.apiKeyEnc,
    updatedAt: new Date(),
  }))
  prismaMock.treeImmichConfig.deleteMany.mockResolvedValue({ count: 1 })
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })

  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ res: 'pong' }), { status: 200, headers: { 'content-type': 'application/json' } }))
})

describe('Immich configuration: read', () => {
  it('exposes only safe metadata, never the API key', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.config).toMatchObject({ configured: true, instanceId: 'c2ec51abd0edebf3', label: 'immich-tree-1.test' })
    const serialized = JSON.stringify(body)
    // Aucune adresse brute : ni l'instance, ni la liste ne laissent voir une URL.
    expect(serialized).not.toContain('http://')
    expect(serialized).not.toContain('secret-key-tree-1')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain(TREE_1_ENC)
    await app.close()
  })

  it('asks for the key again when it no longer decrypts, instead of reporting it configured', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    // Clé chiffrée avec un autre secret (JWT_SECRET changé) : illisible.
    prismaMock.treeImmichConfig.findUnique.mockResolvedValue({
      apiUrl: 'http://immich-tree-1.test',
      // Octets aléatoires au bon format : le déchiffrement échoue (authentification GCM).
      apiKeyEnc: `v1:${Buffer.alloc(64, 7).toString('base64')}`,
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.json().config).toEqual({
      configured: false,
      keyNeedsReentry: true,
      instanceId: 'c2ec51abd0edebf3',
      label: 'immich-tree-1.test',
      updatedAt: '2026-10-01T00:00:00.000Z',
    })

    // La connexion ne sert à rien tant que la clé n'est pas ressaisie.
    const status = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/immich/status',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(status.json()).toEqual({ available: false, reason: 'not_configured' })
    await app.close()
  })

  it('refuses to keep an unreadable key when the address is saved again', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeImmichConfig.findUnique.mockResolvedValueOnce({
      apiUrl: 'http://immich-tree-1.test',
      apiKeyEnc: 'v1:ce-texte-ne-se-dechiffre-pas',
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    })

    const response = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { instanceId: 'c2ec51abd0edebf3' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'api_key_required' })
    expect(prismaMock.treeImmichConfig.upsert).not.toHaveBeenCalled()
    await app.close()
  })

  it('reports a tree without a configuration row as not configured', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeImmichConfig.findUnique.mockResolvedValue(null)

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
    })

    // Un arbre fraîchement créé n'a pas de ligne : rien de configuré, rien d'hérité.
    expect(response.statusCode).toBe(200)
    expect(response.json().config).toEqual({ configured: false, keyNeedsReentry: false, instanceId: null, label: null, updatedAt: null })
    expect(response.json().instances).toEqual([
      { id: 'c2ec51abd0edebf3', label: 'immich-tree-1.test' },
      { id: '0715d0c35f2b0405', label: 'immich-tree-2.test' },
      { id: '6fc8e421ad9b5371', label: 'Maison' },
      { id: '2c47e4ca85342f88', label: 'immich.example.org' },
      { id: '2d46a51941003fcd', label: 'immich-moved.example.org' },
    ])
    expect(JSON.stringify(response.json())).not.toContain('http://')
    await app.close()
  })
})

describe('Immich configuration: write', () => {
  it('lets a tree administrator configure their tree, key encrypted and audited without secret', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeImmichConfig.findUnique.mockResolvedValue(null)

    const response = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { instanceId: '6fc8e421ad9b5371', apiKey: 'my-new-key' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().config).toMatchObject({ configured: true, instanceId: '6fc8e421ad9b5371', label: 'Maison' })
    // L'adresse stockée est celle de la liste de l'opérateur, jamais une valeur envoyée par le client.
    expect(prismaMock.treeImmichConfig.upsert.mock.calls[0][0].create.apiUrl).toBe('http://immich.example.org:2283')

    const upsertArgs = prismaMock.treeImmichConfig.upsert.mock.calls[0][0]
    expect(upsertArgs.where).toEqual({ treeId: 'tree-1' })
    expect(upsertArgs.create.apiKeyEnc).not.toContain('my-new-key')
    expect(upsertArgs.create.apiKeyEnc).toMatch(/^v1:/)
    expect(upsertArgs.update.apiKeyEnc).toBe(upsertArgs.create.apiKeyEnc)

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        treeId: 'tree-1',
        actorType: 'user',
        actorId: 'user-1',
        action: 'immich_config_updated',
        entityType: 'tree_immich_config',
        entityId: 'tree-1',
        payloadJson: { instanceId: '6fc8e421ad9b5371', apiKeyChanged: true },
      },
    })

    expect(JSON.stringify(response.json())).not.toContain('my-new-key')
    await app.close()
  })

  it('keeps the existing key when the same address is saved again', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { instanceId: 'c2ec51abd0edebf3' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().config.instanceId).toBe('c2ec51abd0edebf3')

    const upsertArgs = prismaMock.treeImmichConfig.upsert.mock.calls[0][0]
    // La clé en place est conservée telle quelle : pas de nouvelle clé, pas de déchiffrage.
    expect(upsertArgs.create.apiKeyEnc).toBe(TREE_1_ENC)
    expect(upsertArgs.update.apiKeyEnc).toBe(TREE_1_ENC)
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.payloadJson).toEqual({
      instanceId: 'c2ec51abd0edebf3',
      apiKeyChanged: false,
    })
    await app.close()
  })

  it('requires a new key when the address changes: the old key never travels', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { instanceId: '2d46a51941003fcd' },
    })

    // La clé de l'ancienne instance ne vaut rien pour la nouvelle, et ne lui est jamais
    // envoyée : il faut une nouvelle clé, rien n'est écrit sans elle.
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'api_key_required' })
    expect(prismaMock.treeImmichConfig.upsert).not.toHaveBeenCalled()
    await app.close()
  })

  it('requires a key for a first configuration', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeImmichConfig.findUnique.mockResolvedValue(null)

    const response = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { instanceId: '2c47e4ca85342f88' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'api_key_required' })
    expect(prismaMock.treeImmichConfig.upsert).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects an identifier that is not an instance id', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { instanceId: 'ftp://immich.example.org', apiKey: 'my-new-key' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('invalid_payload')
    expect(prismaMock.treeImmichConfig.upsert).not.toHaveBeenCalled()
    await app.close()
  })

  it('refuses non-administrators and other trees', async () => {
    const app = createApp()
    const ownerToken = await createUserToken(app)
    const memberToken = await createUserToken(app, 'user-member')

    const member = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { instanceId: '2c47e4ca85342f88', apiKey: 'stolen-key' },
    })
    expect(member.statusCode).toBe(403)

    // L'administrateur de tree-1 ne touche pas la configuration de tree-2.
    const otherTree = await app.inject({
      method: 'PUT',
      url: '/trees/tree-2/immich/config',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { instanceId: '2c47e4ca85342f88', apiKey: 'evil-key' },
    })
    expect(otherTree.statusCode).toBe(403)

    const anonymous = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      payload: { instanceId: '2c47e4ca85342f88', apiKey: 'key' },
    })
    expect(anonymous.statusCode).toBe(401)

    expect(prismaMock.treeImmichConfig.upsert).not.toHaveBeenCalled()
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('Immich configuration: removal', () => {
  it('revokes the tree access and audits the removal', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().config).toEqual({ configured: false, keyNeedsReentry: false, instanceId: null, label: null, updatedAt: null })
    expect(prismaMock.treeImmichConfig.deleteMany).toHaveBeenCalledWith({ where: { treeId: 'tree-1' } })
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        treeId: 'tree-1',
        actorType: 'user',
        actorId: 'user-1',
        action: 'immich_config_removed',
        entityType: 'tree_immich_config',
        entityId: 'tree-1',
        payloadJson: {},
      },
    })

    // Une fois la configuration retirée, plus aucun appel vers l'instance ne part.
    prismaMock.treeImmichConfig.findUnique.mockResolvedValue(null)
    fetchMock.mockClear()
    const people = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/immich/people',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(people.statusCode).toBe(503)
    expect(people.json()).toEqual({ error: 'immich_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
    await app.close()
  })

  it('refuses removal by a non-administrator or on another tree', async () => {
    const app = createApp()
    const ownerToken = await createUserToken(app)
    const memberToken = await createUserToken(app, 'user-member')

    const member = await app.inject({
      method: 'DELETE',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(member.statusCode).toBe(403)

    const otherTree = await app.inject({
      method: 'DELETE',
      url: '/trees/tree-2/immich/config',
      headers: { authorization: `Bearer ${ownerToken}` },
    })
    expect(otherTree.statusCode).toBe(403)

    expect(prismaMock.treeImmichConfig.deleteMany).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('Immich credentials: tree isolation', () => {
  it('uses tree 2 credentials for tree 2 requests, never tree 1 credentials', async () => {
    const app = createApp()
    const token2 = await createUserToken(app, 'user-2')

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ people: [], total: 0, hasNextPage: false }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-2/immich/people',
      headers: { authorization: `Bearer ${token2}` },
    })

    expect(response.statusCode).toBe(200)
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://immich-tree-2.test/api/people?page=1&size=1000')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-api-key': 'secret-key-tree-2' })
    expect(prismaMock.treeImmichConfig.findUnique).toHaveBeenCalledWith({
      where: { treeId: 'tree-2' },
      select: { apiUrl: true, apiKeyEnc: true },
    })
    await app.close()
  })

  it('refuses tree 1 credentials to serve tree 2 requests', async () => {
    const app = createApp()
    const token1 = await createUserToken(app, 'user-1')

    // user-1 administre tree-1 mais pas tree-2 : refus avant toute résolution de configuration.
    const response = await app.inject({
      method: 'GET',
      url: '/trees/tree-2/immich/people',
      headers: { authorization: `Bearer ${token1}` },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: 'forbidden' })
    expect(fetchMock).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('Immich configuration: operator allowlist', () => {
  it('rejects an instance outside the list and changes nothing', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { instanceId: '1234567890abcdef', apiKey: 'stolen-key' },
    })

    // Le serveur ne devient jamais un proxy vers un service interne choisi librement.
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'instance_not_allowed' })
    expect(prismaMock.treeImmichConfig.upsert).not.toHaveBeenCalled()
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('stores the canonical address of the instance chosen by its identifier', async () => {
    const app = createApp()
    const token = await createUserToken(app)

    const response = await app.inject({
      method: 'PUT',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
      payload: { instanceId: 'c2ec51abd0edebf3', apiKey: 'my-new-key' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().config).toMatchObject({ configured: true, instanceId: 'c2ec51abd0edebf3', label: 'immich-tree-1.test' })
    expect(prismaMock.treeImmichConfig.upsert.mock.calls[0][0].create.apiUrl).toBe('http://immich-tree-1.test')
    await app.close()
  })

  it('stops using a stored connection whose address left the list', async () => {
    const app = createApp()
    const token = await createUserToken(app)
    prismaMock.treeImmichConfig.findUnique.mockResolvedValue({
      apiUrl: 'http://removed.example.org',
      apiKeyEnc: TREE_1_ENC,
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    })

    // La connexion stockée devient « non configurée » : l'adresse n'est plus autorisée.
    const config = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/immich/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(config.statusCode).toBe(200)
    expect(config.json().config).toEqual({ configured: false, keyNeedsReentry: false, instanceId: null, label: null, updatedAt: null })

    const status = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/immich/status',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(status.json()).toEqual({ available: false, reason: 'not_configured' })

    const people = await app.inject({
      method: 'GET',
      url: '/trees/tree-1/immich/people',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(people.statusCode).toBe(503)
    expect(people.json()).toEqual({ error: 'immich_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
    await app.close()
  })
})
