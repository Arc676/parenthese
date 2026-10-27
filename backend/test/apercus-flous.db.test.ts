import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Aperçus flous (lib/blurhash.ts), sur une vraie base : calculés à l'envoi d'une photo et d'un portrait,
// publiés dans le graphe, et rattrapés en tâche de fond pour ce qui n'en a pas (photos d'avant la migration,
// imports). Lancé seulement avec TEST_DATABASE_URL (base jetable, migrée, en UTF-8) :
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/genealogy_test npx vitest run test/apercus-flous.db.test.ts
const TEST_DB = process.env.TEST_DATABASE_URL

let app: FastifyInstance
let env: { ALLOW_REGISTRATION: boolean; MEDIA_STORAGE_PATH: string }
let ip = 0
const nextIp = () => `10.4.${Math.floor(++ip / 250)}.${ip % 250 + 1}`
const run = Date.now().toString(36)
const storage = mkdtempSync(path.join(tmpdir(), 'pth-apercus-'))
const PHOTO_BYTES = readFileSync(fileURLToPath(new URL('../../frontend/public/demo/souvenir-mariage-1918.webp', import.meta.url)))
const PHOTO = PHOTO_BYTES.toString('base64')

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

describe.skipIf(!TEST_DB)('aperçus flous, vraie base', () => {
  let token: string
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
    const owner = await call('POST', '/auth/register', undefined, { email: `apercus-${run}@exemple.fr`, password: 'mot-de-passe-solide', firstName: 'Patch' })
    expect(owner.status).toBe(201)
    token = owner.body.token
    const tree = await call('POST', '/trees', token, { name: 'Aperçus', slug: `apercus-${run}`, visitorPassword: 'partage-demo-1', contributorPassword: 'partage-demo-1' })
    treeId = tree.body.tree?.id ?? tree.body.id
    const person = await call('POST', `/trees/${treeId}/persons`, token, { firstName: 'Odette', lastName: 'Duval' })
    personId = person.body.person?.id ?? person.body.id
  })

  afterAll(async () => {
    await app?.close()
  })

  const graph = async () => (await call('GET', `/trees/${treeId}/graph`, token)).body

  it('une photo et un portrait envoyés ont leur aperçu tout de suite, publié dans le graphe', async () => {
    const media = await call('POST', `/trees/${treeId}/persons/${personId}/media`, token, { type: 'photo', fileName: 'mariage.webp', mimeType: 'image/webp', sizeBytes: PHOTO_BYTES.length, dataBase64: PHOTO })
    expect(media.status).toBe(201)
    const avatar = await call('POST', `/trees/${treeId}/persons/${personId}/avatar`, token, { fileName: 'portrait.webp', mimeType: 'image/webp', sizeBytes: PHOTO_BYTES.length, dataBase64: PHOTO })
    expect(avatar.status).toBeLessThan(300)
    const g = await graph()
    expect(g.graph?.medias?.[0]?.blurhash ?? g.medias?.[0]?.blurhash).toMatch(/^[0-9A-Za-z#$%*+,-.:;=?@[\]^_{|}~]{28}$/)
    const person = (g.graph?.persons ?? g.persons).find((p: { id: string }) => p.id === personId)
    expect(person.avatarBlurhash).toHaveLength(28)
  })

  it('la tâche de fond rattrape une photo et un portrait sans aperçu', async () => {
    await app.prisma.mediaItem.updateMany({ where: { treeId }, data: { blurhash: null } })
    await app.prisma.person.updateMany({ where: { id: personId }, data: { avatarBlurhash: null } })
    const { fillMissingBlurhashes } = await import('../src/lib/blurhash.js')
    const done = await fillMissingBlurhashes(app, path.resolve(storage))
    expect(done).toBeGreaterThanOrEqual(2)
    expect((await app.prisma.mediaItem.findFirst({ where: { treeId } }))?.blurhash).toHaveLength(28)
    expect((await app.prisma.person.findUnique({ where: { id: personId } }))?.avatarBlurhash).toHaveLength(28)
  })

  it('un fichier illisible reçoit un aperçu vide, pour ne pas être relu à chaque passage', async () => {
    const media = await app.prisma.mediaItem.findFirst({ where: { treeId } })
    await app.prisma.mediaItem.update({ where: { id: media!.id }, data: { blurhash: null, filePath: `${treeId}/absent.webp` } })
    const { fillMissingBlurhashes } = await import('../src/lib/blurhash.js')
    await fillMissingBlurhashes(app, path.resolve(storage))
    expect((await app.prisma.mediaItem.findUnique({ where: { id: media!.id } }))?.blurhash).toBe('')
  })
})
