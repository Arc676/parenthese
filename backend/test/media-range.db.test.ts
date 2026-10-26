import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Un souvenir se lit par morceaux (Range), sur une vraie base. Lancé seulement avec TEST_DATABASE_URL :
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/genealogy_test npx vitest run test/media-range.db.test.ts
const TEST_DB = process.env.TEST_DATABASE_URL

let app: FastifyInstance
let env: { ALLOW_REGISTRATION: boolean; MEDIA_STORAGE_PATH: string }
let ip = 0
const nextIp = () => `10.4.${Math.floor(++ip / 250)}.${ip % 250 + 1}`
const run = Date.now().toString(36)
// PNG d'un pixel
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const storage = mkdtempSync(path.join(tmpdir(), 'pth-media-range-'))

async function call(method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: method as 'GET',
    url,
    payload: payload as Record<string, unknown>,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    remoteAddress: nextIp(),
  })
}

describe.skipIf(!TEST_DB)('souvenir lu par morceaux, vraie base', () => {
  let token: string
  let url: string
  let treeId: string
  let personId: string
  let whole: Buffer

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
    const owner = await call('POST', '/auth/register', undefined, { email: `range-${run}@exemple.fr`, password: 'mot-de-passe-solide', firstName: 'Hélène' })
    token = owner.json().token
    const tree = await call('POST', '/trees', token, { name: 'Arbre de démo', slug: `range-${run}`, visitorPassword: 'partage-demo-1', contributorPassword: 'partage-demo-1' })
    treeId = tree.json().tree?.id ?? tree.json().id
    const person = await call('POST', `/trees/${treeId}/persons`, token, { firstName: 'Odette', lastName: 'Duval' })
    personId = person.json().person?.id ?? person.json().id
    const sent = await call('POST', `/trees/${treeId}/persons/${personId}/media`, token, {
      type: 'photo', fileName: 'photo.png', mimeType: 'image/png', sizeBytes: Buffer.from(PIXEL, 'base64').length, dataBase64: PIXEL,
    })
    expect(sent.statusCode).toBe(201)
    const media = sent.json().media ?? sent.json()
    url = `/trees/${treeId}/media/${media.id}`
    const full = await call('GET', url, token)
    expect(full.statusCode).toBe(200)
    whole = full.rawPayload
  })

  afterAll(async () => {
    await app?.close()
  })

  it('sans plage : tout le fichier, et l annonce des plages', async () => {
    const res = await call('GET', url, token)
    expect(res.statusCode).toBe(200)
    expect(res.headers['accept-ranges']).toBe('bytes')
    expect(Number(res.headers['content-length'])).toBe(whole.length)
    expect(res.headers['content-type']).toBe('image/png')
  })

  it('les deux premiers octets, comme Safari avant une vidéo', async () => {
    const res = await call('GET', url, token, undefined, { range: 'bytes=0-1' })
    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe(`bytes 0-1/${whole.length}`)
    expect(res.rawPayload.equals(whole.subarray(0, 2))).toBe(true)
  })

  it('la fin du fichier, et une plage hors du fichier', async () => {
    const tail = await call('GET', url, token, undefined, { range: 'bytes=-10' })
    expect(tail.statusCode).toBe(206)
    expect(tail.rawPayload.equals(whole.subarray(whole.length - 10))).toBe(true)
    const out = await call('GET', url, token, undefined, { range: `bytes=${whole.length}-` })
    expect(out.statusCode).toBe(416)
    expect(out.headers['content-range']).toBe(`bytes */${whole.length}`)
  })

  it('les droits passent avant la plage, souvenir en attente compris', async () => {
    expect((await call('GET', url, undefined, undefined, { range: 'bytes=0-1' })).statusCode).toBe(401)
    // Un membre envoie un souvenir, qui attend la relecture ; un autre membre le demande par morceaux
    const register = async (name: string) => (await call('POST', '/auth/register', undefined, { email: `${name}-${run}@exemple.fr`, password: 'mot-de-passe-solide', firstName: name })).json().token as string
    const author = await register('auteur')
    const reader = await register('lecteur')
    for (const t of [author, reader]) expect((await call('POST', `/trees/${treeId}/access/unlock`, t, { password: 'partage-demo-1' })).statusCode).toBe(200)
    const sent = await call('POST', `/trees/${treeId}/persons/${personId}/media`, author, {
      type: 'photo', fileName: 'photo.png', mimeType: 'image/png', sizeBytes: Buffer.from(PIXEL, 'base64').length, dataBase64: PIXEL,
    })
    const pending = sent.json().media ?? sent.json()
    expect(pending.status).toBe('pending')
    const pendingUrl = `/trees/${treeId}/media/${pending.id}`
    expect((await call('GET', pendingUrl, reader, undefined, { range: 'bytes=0-1' })).statusCode).toBe(404)
    expect((await call('GET', pendingUrl, author, undefined, { range: 'bytes=0-1' })).statusCode).toBe(206)
  })
})
