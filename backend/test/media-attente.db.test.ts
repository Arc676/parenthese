import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Souvenir en attente de relecture, sur une vraie base : seuls qui gère l'arbre et qui l'a envoyé le lisent,
// la famille qui connaîtrait son identifiant reçoit la même réponse qu'un média absent. Lancé seulement avec
// TEST_DATABASE_URL (base jetable, migrée, en UTF-8) :
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/genealogy_test npx vitest run test/media-attente.db.test.ts
const TEST_DB = process.env.TEST_DATABASE_URL

let app: FastifyInstance
let env: { ALLOW_REGISTRATION: boolean; MEDIA_STORAGE_PATH: string }
let ip = 0
const nextIp = () => `10.3.${Math.floor(++ip / 250)}.${ip % 250 + 1}`
const run = Date.now().toString(36)
const mail = (name: string) => `${name}-${run}@exemple.fr`
// PNG d'un pixel
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const storage = mkdtempSync(path.join(tmpdir(), 'pth-media-attente-'))

async function call(method: string, url: string, token?: string, payload?: unknown) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    payload: payload as Record<string, unknown>,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    remoteAddress: nextIp(),
  })
  let body = null
  try { body = res.body ? res.json() : null } catch { body = null }
  return { status: res.statusCode, body }
}

async function account(name: string) {
  const res = await call('POST', '/auth/register', undefined, { email: mail(name), password: 'mot-de-passe-solide', firstName: name })
  expect(res.status).toBe(201)
  return { token: res.body.token as string, id: res.body.user.id as string }
}

describe.skipIf(!TEST_DB)('souvenir en attente, vraie base', () => {
  let owner: { token: string; id: string }
  let member: { token: string; id: string }
  let reader: { token: string; id: string }
  let shareToken: string
  let treeId: string
  let personId: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = TEST_DB
    process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
    process.env.CORS_ORIGIN = 'http://localhost:5173'
    process.env.MEDIA_STORAGE_PATH = storage
    ;({ env } = await import('../src/config/env.js'))
    const { createApp } = await import('../src/app.js')
    app = createApp()
    env.ALLOW_REGISTRATION = true
    env.MEDIA_STORAGE_PATH = storage
    owner = await account('proprio')
    const tree = await call('POST', '/trees', owner.token, { name: 'Arbre de démo', slug: `attente-${run}`, visitorPassword: 'partage-demo-1', contributorPassword: 'partage-demo-1' })
    expect(tree.status).toBe(201)
    treeId = tree.body.tree?.id ?? tree.body.id
    const person = await call('POST', `/trees/${treeId}/persons`, owner.token, { firstName: 'Odette', lastName: 'Duval' })
    expect(person.status).toBe(201)
    personId = person.body.person?.id ?? person.body.id
    // Deux comptes de la famille, rattachés par le mot de passe de partage, et le lien de partage seul
    member = await account('membre')
    reader = await account('lecteur')
    for (const who of [member, reader]) {
      expect((await call('POST', `/trees/${treeId}/access/unlock`, who.token, { password: 'partage-demo-1' })).status).toBe(200)
    }
    const shared = await call('POST', `/trees/${treeId}/access/unlock`, undefined, { password: 'partage-demo-1' })
    expect(shared.status).toBe(200)
    shareToken = shared.body.token
  })

  afterAll(async () => {
    await app?.close()
  })

  const upload = (token: string) => call('POST', `/trees/${treeId}/persons/${personId}/media`, token, {
    type: 'photo', fileName: 'photo.png', mimeType: 'image/png', sizeBytes: Buffer.from(PIXEL, 'base64').length, dataBase64: PIXEL,
  })
  const read = (mediaId: string, token?: string) => call('GET', `/trees/${treeId}/media/${mediaId}`, token)
  // Jeton médias, celui que porte l'adresse d'une image (<img src>) : émis avec le graphe de l'arbre
  const mediaToken = async (token: string) => (await call('GET', `/trees/${treeId}/graph`, token)).body?.mediaToken as string

  it('un souvenir envoyé par un membre attend la relecture, et seuls le gestionnaire et son auteur le lisent', async () => {
    const sent = await upload(member.token)
    expect(sent.status).toBe(201)
    const media = sent.body.media ?? sent.body
    expect(media.status).toBe('pending')

    expect((await read(media.id, owner.token)).status).toBe(200)
    expect((await read(media.id, member.token)).status).toBe(200)
    expect((await read(media.id, reader.token)).status).toBe(404)
    expect((await read(media.id, shareToken)).status).toBe(404)
    expect((await read(media.id)).status).toBe(401)

    // Par l'adresse d'une image : le jeton médias du gestionnaire ouvre, celui du lecteur non
    expect((await read(`${media.id}?token=${await mediaToken(owner.token)}`)).status).toBe(200)
    expect((await read(`${media.id}?token=${await mediaToken(member.token)}`)).status).toBe(200)
    expect((await read(`${media.id}?token=${await mediaToken(reader.token)}`)).status).toBe(404)
    expect((await read(`${media.id}?token=${await mediaToken(shareToken)}`)).status).toBe(404)
  })

  it('un souvenir accepté se lit par toute la famille', async () => {
    const sent = await upload(member.token)
    const media = sent.body.media ?? sent.body
    expect(media.status).toBe('pending')
    const session = sent.body.contributionSessionId ?? media.contributionSessionId
    expect(session).toBeTruthy()
    const reviewed = await call('POST', `/trees/${treeId}/contributions/sessions/${session}/review`, owner.token, { decision: 'approved' })
    expect(reviewed.status).toBe(200)
    expect((await read(media.id, reader.token)).status).toBe(200)
    expect((await read(media.id, shareToken)).status).toBe(200)
  })

  it('un souvenir posé par le gestionnaire est visible tout de suite', async () => {
    const sent = await upload(owner.token)
    expect(sent.status).toBe(201)
    const media = sent.body.media ?? sent.body
    expect(media.status).toBe('approved')
    expect((await read(media.id, reader.token)).status).toBe(200)
  })
})
