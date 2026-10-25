import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Propositions de la famille sur l'arbre (1.5.1) : photos posées sur l'arbre, annotations posées par le serveur
// à l'acceptation, état d'une proposition. Sur une vraie base, comme toute règle de droits :
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/genealogy_test npx vitest run test/propositions-fantomes.db.test.ts
const TEST_DB = process.env.TEST_DATABASE_URL

let app: FastifyInstance
let env: { ALLOW_REGISTRATION: boolean; MEDIA_STORAGE_PATH: string }
let prisma: typeof import('../src/lib/prisma.js')['prisma']
let ip = 0
const nextIp = () => `10.2.${Math.floor(++ip / 250)}.${ip % 250 + 1}`
const run = Date.now().toString(36)
const mail = (name: string) => `${name}-${run}@exemple.fr`
// PNG d'un pixel
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const storage = mkdtempSync(path.join(tmpdir(), 'pth-151-'))

async function call(method: string, url: string, token?: string, payload?: unknown) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    payload: payload as Record<string, unknown>,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    remoteAddress: nextIp(),
  })
  return { status: res.statusCode, body: res.body ? res.json() : null }
}

async function account(name: string) {
  const res = await call('POST', '/auth/register', undefined, { email: mail(name), password: 'mot-de-passe-solide', firstName: name })
  expect(res.status).toBe(201)
  return { token: res.body.token as string, id: res.body.user.id as string }
}

describe.skipIf(!TEST_DB)('propositions de la famille sur l\'arbre, vraie base', () => {
  let owner: { token: string; id: string }
  let treeId: string
  let family: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = TEST_DB
    process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
    process.env.CORS_ORIGIN = 'http://localhost:5173'
    process.env.MEDIA_STORAGE_PATH = storage
    ;({ env } = await import('../src/config/env.js'))
    ;({ prisma } = await import('../src/lib/prisma.js'))
    const { createApp } = await import('../src/app.js')
    app = createApp()
    env.ALLOW_REGISTRATION = true
    env.MEDIA_STORAGE_PATH = storage
    owner = await account('proprio')
    const tree = await call('POST', '/trees', owner.token, { name: 'Arbre de démo', slug: `fantomes-${run}`, visitorPassword: 'partage-demo-1', contributorPassword: 'partage-demo-1' })
    expect(tree.status).toBe(201)
    treeId = tree.body.tree?.id ?? tree.body.id
    const unlocked = await call('POST', `/trees/${treeId}/access/unlock`, undefined, { password: 'partage-demo-1' })
    expect(unlocked.status).toBe(200)
    family = unlocked.body.token
  })

  afterAll(async () => {
    await app?.close()
  })

  const upload = (token?: string) => call('POST', `/trees/${treeId}/annotation-photos`, token, {
    fileName: 'photo.png', mimeType: 'image/png', sizeBytes: Buffer.from(PIXEL, 'base64').length, dataBase64: PIXEL,
  })
  const photoAnnotation = (photoPath: string) => ({ type: 'photo', x: 10, y: 20, content: JSON.stringify({ photoPath, width: 1, height: 1 }), style: {}, zIndex: 1 })
  const propose = (token: string, changes: unknown[]) => call('POST', `/trees/${treeId}/contributions/sessions`, token, { title: 'Proposition de la famille', submittedByLabel: 'Cousine', changes })
  const review = (sessionId: string, decision: 'approved' | 'rejected') => call('POST', `/trees/${treeId}/contributions/sessions/${sessionId}/review`, owner.token, { decision })
  const annotations = async () => (await call('GET', `/trees/${treeId}/annotations`, owner.token)).body.annotations as Array<{ id: string; type: string; content: string }>
  const fileOf = async (photoId: string) => (await prisma.annotationPhotoUpload.findUnique({ where: { id: photoId } }))?.filePath

  it("personne d'extérieur ne pose une photo : sans jeton 401, un compte sans lien avec l'arbre 403", async () => {
    expect((await upload()).status).toBe(401)
    const stranger = await account('inconnu')
    expect((await upload(stranger.token)).status).toBe(403)
  })

  it('la photo de la famille attend la relecture, puis devient une annotation au moment où elle est acceptée', async () => {
    const sent = await upload(family)
    expect(sent.status).toBe(201)
    const filePath = await fileOf(sent.body.photoId)
    expect(filePath).toBeTruthy()

    const proposed = await propose(family, [{ entityType: 'annotation', action: 'create', after: photoAnnotation(sent.body.photoPath) }])
    expect(proposed.status).toBe(201)
    expect((await annotations()).some((a) => a.content.includes(sent.body.photoId))).toBe(false)

    expect((await review(proposed.body.session.id, 'approved')).status).toBe(200)
    expect((await annotations()).some((a) => a.type === 'photo' && a.content.includes(sent.body.photoId))).toBe(true)
    expect(await fileOf(sent.body.photoId)).toBeUndefined()
    expect(existsSync(path.join(storage, filePath as string))).toBe(true)
  })

  it('refusée, la photo de la famille est effacée du disque', async () => {
    const sent = await upload(family)
    const filePath = await fileOf(sent.body.photoId) as string
    const proposed = await propose(family, [{ entityType: 'annotation', action: 'create', after: photoAnnotation(sent.body.photoPath) }])
    expect((await review(proposed.body.session.id, 'rejected')).status).toBe(200)
    expect(await fileOf(sent.body.photoId)).toBeUndefined()
    expect(existsSync(path.join(storage, filePath))).toBe(false)
    expect((await annotations()).some((a) => a.content.includes(sent.body.photoId))).toBe(false)
  })

  it('un dessin accepté est posé par le serveur, sans geste du navigateur', async () => {
    const before = (await annotations()).length
    const proposed = await propose(family, [{ entityType: 'annotation', action: 'create', after: { type: 'drawing', x: 1, y: 2, content: 'M0 0 L10 10', style: { color: '#b4532a' } } }])
    expect((await review(proposed.body.session.id, 'approved')).status).toBe(200)
    expect((await annotations()).length).toBe(before + 1)
  })

  it("une ancienne proposition d'annotation incomplète est écartée sans bloquer le reste de la relecture", async () => {
    const before = (await annotations()).length
    const session = await prisma.contributionSession.create({
      data: {
        treeId, submittedByLabel: 'Cousine', mode: 'tree_access', status: 'pending', title: 'Avant la 1.5.1',
        changes: { create: [
          { entityType: 'annotation', action: 'create', afterJson: { type: 'drawing', x: 0, y: 0 } },
          { entityType: 'annotation', action: 'create', afterJson: { type: 'text', x: 5, y: 5, content: 'Mamie' } },
        ] },
      },
    })
    const reviewed = await review(session.id, 'approved')
    expect(reviewed.status).toBe(200)
    expect(reviewed.body.approvedCount).toBe(1)
    expect(reviewed.body.rejectedCount).toBe(1)
    expect((await annotations()).length).toBe(before + 1)
  })

  it("une photo qui n'est pas de cet arbre est refusée dès l'envoi", async () => {
    const res = await propose(family, [{ entityType: 'annotation', action: 'create', after: photoAnnotation('/trees/un-autre-arbre/annotation-photos/abc') }])
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_annotation_photo_path')
  })

  it("l'état d'une proposition : lisible par qui lit l'arbre, pas par un compte sans lien", async () => {
    const proposed = await propose(family, [{ entityType: 'annotation', action: 'create', after: { type: 'sticker', x: 0, y: 0, content: '🌳' } }])
    const url = `/trees/${treeId}/contributions/sessions/${proposed.body.session.id}/status`
    expect((await call('GET', url, family)).body.status).toBe('pending')
    const stranger = await account('curieux')
    expect((await call('GET', url, stranger.token)).status).toBe(403)
    await review(proposed.body.session.id, 'approved')
    expect((await call('GET', url, family)).body.status).toBe('approved')
  })

  it("un envoi jamais proposé depuis 7 jours est effacé au suivant ; celui d'une proposition en attente reste", async () => {
    const orphan = await upload(family)
    const kept = await upload(family)
    await propose(family, [{ entityType: 'annotation', action: 'create', after: photoAnnotation(kept.body.photoPath) }])
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await prisma.annotationPhotoUpload.updateMany({ where: { id: { in: [orphan.body.photoId, kept.body.photoId] } }, data: { createdAt: old } })
    const orphanPath = await fileOf(orphan.body.photoId) as string

    expect((await upload(family)).status).toBe(201)
    expect(await fileOf(orphan.body.photoId)).toBeUndefined()
    expect(existsSync(path.join(storage, orphanPath))).toBe(false)
    expect(await fileOf(kept.body.photoId)).toBeTruthy()
  })

  it('revue : refusée puis acceptée dans la même relecture, la photo reste sur le disque', async () => {
    const sent = await upload(family)
    const filePath = await fileOf(sent.body.photoId) as string
    const proposed = await propose(family, [
      { entityType: 'annotation', action: 'create', after: photoAnnotation(sent.body.photoPath) },
      { entityType: 'annotation', action: 'create', after: { ...photoAnnotation(sent.body.photoPath), x: 99 } },
    ])
    const session = await prisma.contributionSession.findUnique({ where: { id: proposed.body.session.id }, include: { changes: { orderBy: { createdAt: 'asc' } } } })
    const [first, second] = session!.changes
    const res = await call('POST', `/trees/${treeId}/contributions/sessions/${session!.id}/review`, owner.token, {
      decision: 'approved',
      changeDecisions: [{ changeId: first.id, decision: 'rejected' }, { changeId: second.id, decision: 'approved' }],
    })
    expect(res.status).toBe(200)
    expect(existsSync(path.join(storage, filePath))).toBe(true)
  })

  it("revue : un chemin de photo échappé dans le JSON compte quand même comme cité par une proposition en attente", async () => {
    const sent = await upload(family)
    const filePath = await fileOf(sent.body.photoId) as string
    const plain = await propose(family, [{ entityType: 'annotation', action: 'create', after: photoAnnotation(sent.body.photoPath) }])
    const escaped = `{"photoPath":"${sent.body.photoPath.replaceAll('/', '\/')}","width":1,"height":1}`
    const other = await propose(family, [{ entityType: 'annotation', action: 'create', after: { type: 'photo', x: 1, y: 1, content: escaped } }])
    expect(other.status).toBe(201)
    await review(plain.body.session.id, 'rejected')
    expect(existsSync(path.join(storage, filePath))).toBe(true)
    await review(other.body.session.id, 'approved')
    expect((await annotations()).some((a) => a.content.includes(sent.body.photoId))).toBe(true)
    expect(existsSync(path.join(storage, filePath))).toBe(true)
  })

  it('revue : 70 envois simultanés sur un arbre neuf ne dépassent pas le plafond de 50', async () => {
    const fresh = await call('POST', '/trees', owner.token, { name: 'Arbre neuf', slug: `neuf-${run}`, visitorPassword: 'partage-neuf-1', contributorPassword: 'partage-neuf-1' })
    const freshId = fresh.body.tree?.id ?? fresh.body.id
    const access = (await call('POST', `/trees/${freshId}/access/unlock`, undefined, { password: 'partage-neuf-1' })).body.token
    const results = await Promise.all(Array.from({ length: 70 }, () => call('POST', `/trees/${freshId}/annotation-photos`, access, {
      fileName: 'photo.png', mimeType: 'image/png', sizeBytes: Buffer.from(PIXEL, 'base64').length, dataBase64: PIXEL,
    })))
    expect(results.filter((r) => r.status === 201).length).toBe(50)
    expect(await prisma.annotationPhotoUpload.count({ where: { treeId: freshId } })).toBe(50)
  })

  it('au-delà de 50 photos en attente sur un arbre, la famille est arrêtée ; un gestionnaire non', async () => {
    const existing = await prisma.annotationPhotoUpload.count({ where: { treeId } })
    await prisma.annotationPhotoUpload.createMany({
      data: Array.from({ length: 50 - existing }, (_, index) => ({ id: `rempli-${run}-${index}`, treeId, filePath: `${treeId}/annotation-photos/rempli-${index}.png` })),
    })
    expect((await upload(family)).status).toBe(429)
    expect((await upload(owner.token)).status).toBe(201)
  })
})
