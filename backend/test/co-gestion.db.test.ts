import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Co-gestion d'un arbre (#145), sur une vraie base : une fonction de droits se vérifie avec de vraies requêtes,
// pas avec des mocks. Lancé seulement avec TEST_DATABASE_URL (base jetable, migrée, en UTF-8 pour les emoji) :
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/genealogy_test npx vitest run test/co-gestion.db.test.ts
const TEST_DB = process.env.TEST_DATABASE_URL

const { oidcMock } = vi.hoisted(() => ({ oidcMock: { startAuthorization: vi.fn(), finishAuthorization: vi.fn() } }))
vi.mock('../src/lib/oidc.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/oidc.js')>()),
  ...oidcMock,
}))

const ISSUER = 'https://id.example.org'
let app: FastifyInstance
let env: { ALLOW_REGISTRATION: boolean; PASSWORD_LOGIN: boolean }
let prisma: typeof import('../src/lib/prisma.js')['prisma']
let ip = 0
const nextIp = () => `10.1.${Math.floor(++ip / 250)}.${ip % 250 + 1}`
const run = Date.now().toString(36)
const mail = (name: string) => `${name}-${run}@exemple.fr`

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

async function register(name: string, extra: Record<string, unknown> = {}) {
  const res = await call('POST', '/auth/register', undefined, { email: mail(name), password: 'mot-de-passe-solide', firstName: name, ...extra })
  return res
}

async function account(name: string) {
  const res = await register(name)
  expect(res.status).toBe(201)
  return { token: res.body.token as string, id: res.body.user.id as string, email: mail(name) }
}

describe.skipIf(!TEST_DB)('co-gestion, vraie base', () => {
  let owner: { token: string; id: string; email: string }
  let treeId: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = TEST_DB
    process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
    process.env.CORS_ORIGIN = 'http://localhost:5173'
    process.env.OIDC_ISSUER = ISSUER
    process.env.OIDC_CLIENT_ID = 'parenthese'
    process.env.OIDC_CLIENT_SECRET = 'secret'
    process.env.OIDC_REDIRECT_URI = 'https://arbre.example.org/auth/oidc/callback'
    ;({ env } = await import('../src/config/env.js'))
    ;({ prisma } = await import('../src/lib/prisma.js'))
    const { createApp } = await import('../src/app.js')
    app = createApp()
    env.ALLOW_REGISTRATION = true
    owner = await account('proprio')
    const tree = await call('POST', '/trees', owner.token, { name: 'Arbre de démo', slug: `demo-${run}`, visitorPassword: 'partage-demo-1', contributorPassword: 'partage-demo-1' })
    expect(tree.status).toBe(201)
    treeId = tree.body.tree?.id ?? tree.body.id
  })

  beforeEach(() => {
    env.ALLOW_REGISTRATION = true
    env.PASSWORD_LOGIN = true
  })

  afterAll(async () => {
    await app?.close()
  })

  async function invite(email: string) {
    const res = await call('POST', `/trees/${treeId}/invitations`, owner.token, { email })
    expect(res.status).toBe(201)
    return res.body as { token: string; invitation: { id: string } }
  }

  it("un compte sans lien avec l'arbre ne voit ni ne change les gestionnaires", async () => {
    const stranger = await account('inconnu')
    expect((await call('GET', `/trees/${treeId}/managers`, stranger.token)).status).toBe(403)
    expect((await call('POST', `/trees/${treeId}/invitations`, stranger.token, { email: stranger.email })).status).toBe(403)
    expect((await call('DELETE', `/trees/${treeId}/managers/${owner.id}`, stranger.token)).status).toBe(403)
    expect((await call('GET', `/trees/${treeId}/managers`)).status).toBe(401)
  })

  it("le lien n'ouvre rien au mauvais compte, ne sert qu'une fois, et donne les droits d'administration", async () => {
    const coEmail = mail('cogest')
    const { token, invitation } = await invite(coEmail)

    const preview = await call('GET', `/invitations/${token}`)
    expect(preview.status).toBe(200)
    expect(preview.body.treeName).toBe('Arbre de démo')
    expect(preview.body.emailHint).not.toContain(coEmail.split('@')[0])

    // Le lien entre de mauvaises mains : un compte à une autre adresse ne l'accepte pas
    const thief = await account('voleur')
    expect((await call('POST', `/invitations/${token}/accept`, thief.token)).body.error).toBe('invitation_email_mismatch')
    expect((await call('PATCH', `/trees/${treeId}`, thief.token, { name: 'Volé' })).status).toBe(403)

    const co = await account('cogest')
    const accepted = await call('POST', `/invitations/${token}/accept`, co.token)
    expect(accepted.status).toBe(200)
    expect(accepted.body).toEqual({ treeId, role: 'admin' })
    expect((await call('POST', `/invitations/${token}/accept`, co.token)).status).toBe(404)
    expect((await call('GET', `/invitations/${token}`)).body).toEqual({ error: 'invitation_used' })
    expect((await prisma.treeInvitation.findUnique({ where: { id: invitation.id } }))?.acceptedUserId).toBe(co.id)

    // Co-gestionnaire : modifie l'arbre, voit la liste, mais n'invite pas, ne retire personne, ne supprime pas l'arbre
    expect((await call('PATCH', `/trees/${treeId}`, co.token, { description: 'Par la co-gestionnaire' })).status).toBe(200)
    const list = await call('GET', `/trees/${treeId}/managers`, co.token)
    expect(list.body.canManage).toBe(false)
    expect(list.body.managers.map((m: { role: string }) => m.role).sort()).toEqual(['admin', 'owner'])
    expect((await call('POST', `/trees/${treeId}/invitations`, co.token, { email: mail('autre') })).status).toBe(403)
    expect((await call('DELETE', `/trees/${treeId}/managers/${owner.id}`, co.token)).status).toBe(403)
    expect((await call('DELETE', `/trees/${treeId}`, co.token, { confirmName: 'Arbre de démo' })).status).toBe(403)

    // Le propriétaire le retire : son jeton de session ne sert plus à rien sur l'arbre, tout de suite
    expect((await call('DELETE', `/trees/${treeId}/managers/${co.id}`, owner.token)).status).toBe(200)
    expect((await call('PATCH', `/trees/${treeId}`, co.token, { description: 'Encore moi' })).status).toBe(403)
    expect((await call('GET', `/trees/${treeId}/managers`, co.token)).status).toBe(403)
  })

  it('un co-gestionnaire quitte seul, et ne retire jamais un autre co-gestionnaire', async () => {
    const a = await account('gestion-a')
    const b = await account('gestion-b')
    for (const who of [a, b]) {
      const { token } = await invite(who.email)
      expect((await call('POST', `/invitations/${token}/accept`, who.token)).status).toBe(200)
    }
    expect((await call('DELETE', `/trees/${treeId}/managers/${b.id}`, a.token)).status).toBe(403)
    expect((await call('DELETE', `/trees/${treeId}/managers/${a.id}`, a.token)).status).toBe(200)
    expect((await call('PATCH', `/trees/${treeId}`, a.token, { description: 'x' })).status).toBe(403)
    expect((await call('PATCH', `/trees/${treeId}`, b.token, { description: 'y' })).status).toBe(200)
    // Le propriétaire ne se retire pas lui-même
    expect((await call('DELETE', `/trees/${treeId}/managers/${owner.id}`, owner.token)).status).toBe(403)
    await call('DELETE', `/trees/${treeId}/managers/${b.id}`, owner.token)
  })

  it('« Copier le lien » remplace le lien ; annulé ou expiré, il ne sert plus', async () => {
    const email = mail('rotation')
    const first = await invite(email)
    const rotated = await call('POST', `/trees/${treeId}/invitations/${first.invitation.id}/link`, owner.token)
    expect(rotated.status).toBe(200)
    expect((await call('GET', `/invitations/${first.token}`)).status).toBe(404)
    expect((await call('GET', `/invitations/${rotated.body.token}`)).status).toBe(200)

    expect((await call('DELETE', `/trees/${treeId}/invitations/${first.invitation.id}`, owner.token)).status).toBe(200)
    const user = await account('rotation')
    expect((await call('POST', `/invitations/${rotated.body.token}/accept`, user.token)).status).toBe(404)

    const late = await invite(email)
    await prisma.treeInvitation.update({ where: { id: late.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await call('POST', `/invitations/${late.token}/accept`, user.token)).status).toBe(404)
    expect((await call('GET', `/invitations/${late.token}`)).body).toEqual({ error: 'invitation_expired' })
    expect((await call('GET', `/invitations/${rotated.body.token}`)).body).toEqual({ error: 'invitation_invalid' })
  })

  it("inscription fermée : l'invitation ouvre un compte, à l'adresse invitée seulement", async () => {
    const email = mail('ferme')
    const { token } = await invite(email)
    env.ALLOW_REGISTRATION = false

    expect((await register('sans-invitation')).body.error).toBe('registration_closed')
    expect((await register('autre-adresse', { invitationToken: token })).body.error).toBe('invitation_email_mismatch')
    expect((await register('x', { invitationToken: 'faux-jeton' })).status).toBe(410)

    const created = await register('ferme', { invitationToken: token })
    expect(created.status).toBe(201)
    expect(created.body.joinedTreeId).toBe(treeId)
    expect((await call('PATCH', `/trees/${treeId}`, created.body.token, { description: 'z' })).status).toBe(200)
    // Le lien a servi : il n'ouvre pas un second compte
    expect((await call('POST', '/auth/register', undefined, { email: mail('ferme2'), password: 'mot-de-passe-solide', invitationToken: token })).status).toBe(410)
    await call('DELETE', `/trees/${treeId}/managers/${created.body.user.id}`, owner.token)
  })

  it("un co-gestionnaire n'utilise jamais Immich, qui passe par la clé du propriétaire", async () => {
    const co = await account('immich')
    const { token } = await invite(co.email)
    expect((await call('POST', `/invitations/${token}/accept`, co.token)).status).toBe(200)
    const config = await call('GET', `/trees/${treeId}/immich/config`, co.token)
    expect(config.status).toBe(200)
    expect(config.body).toEqual({ config: null, instances: [], ownerOnly: true })
    for (const url of ['/immich/assets?page=1&q=plage', '/immich/people', '/immich/status', '/immich/assets/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b/thumbnail', '/immich/thumbnail/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b']) {
      expect((await call('GET', `/trees/${treeId}${url}`, co.token)).status).toBe(403)
    }
    expect((await call('PUT', `/trees/${treeId}/immich/config`, co.token, { instanceId: '0123456789abcdef', apiKey: 'y' })).status).toBe(403)
    expect((await call('DELETE', `/trees/${treeId}/immich/config`, co.token)).status).toBe(403)
    await call('DELETE', `/trees/${treeId}/managers/${co.id}`, owner.token)
  })

  it("retiré, un co-gestionnaire qui avait ouvert l'arbre par le mot de passe de partage ne le lit plus", async () => {
    const co = await account('partage')
    const unlocked = await call('POST', `/trees/${treeId}/access/unlock`, co.token, { password: 'partage-demo-1' })
    expect(unlocked.status).toBe(200)
    expect((await call('GET', `/trees/${treeId}/graph`, co.token)).status).toBe(200)
    const { token } = await invite(co.email)
    expect((await call('POST', `/invitations/${token}/accept`, co.token)).status).toBe(200)
    expect((await call('DELETE', `/trees/${treeId}/managers/${co.id}`, owner.token)).status).toBe(200)
    expect((await call('GET', `/trees/${treeId}/graph`, co.token)).status).toBe(403)
  })

  it("l'icône de l'arbre : un emoji ou rien, posée par un gestionnaire, rendue dans la liste des arbres", async () => {
    expect((await call('PATCH', `/trees/${treeId}`, owner.token, { icon: 'abc' })).status).toBe(400)
    expect((await call('PATCH', `/trees/${treeId}`, owner.token, { icon: '🌳' })).status).toBe(200)
    const list = await call('GET', '/trees', owner.token)
    expect(list.body.trees.find((t: { id: string }) => t.id === treeId).icon).toBe('🌳')
    expect((await call('PATCH', `/trees/${treeId}`, owner.token, { icon: null })).status).toBe(200)
  })

  describe('OIDC', () => {
    let address = 0
    async function oidcLogin(identity: { subject: string; email: string; emailVerified: boolean }) {
      const remoteAddress = `10.9.0.${++address}`
      oidcMock.startAuthorization.mockImplementation(async (returnTo: string) => ({
        url: new URL(`${ISSUER}/authorize?state=s`),
        pending: { state: 's', nonce: 'n', codeVerifier: 'v'.repeat(43), returnTo },
      }))
      oidcMock.finishAuthorization.mockResolvedValue({ issuer: ISSUER, firstName: null, ...identity })
      const start = await app.inject({ method: 'GET', url: '/auth/oidc/start?returnTo=/', remoteAddress })
      const cookie = String(start.headers['set-cookie']).split(';')[0]
      const back = await app.inject({ method: 'GET', url: '/auth/oidc/callback?code=c&state=s', headers: { cookie }, remoteAddress })
      return new URLSearchParams(String(back.headers.location).split('#')[1] ?? '')
    }

    it("email vérifié par le fournisseur : rattaché sans le lien, même inscription fermée", async () => {
      const email = mail('oidc-ok')
      await invite(email)
      env.ALLOW_REGISTRATION = false
      const fragment = await oidcLogin({ subject: `sub-ok-${run}`, email, emailVerified: true })
      expect(fragment.get('oidc')).toBeTruthy()
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
      const membership = await prisma.treeMembership.findUnique({ where: { treeId_userId: { treeId, userId: user!.id } } })
      expect(membership?.role).toBe('admin')
    })

    it("email non vérifié : jamais rattaché, et pas de compte sur une instance fermée", async () => {
      const email = mail('oidc-non-verifie')
      await invite(email)
      env.ALLOW_REGISTRATION = false
      const fragment = await oidcLogin({ subject: `sub-nv-${run}`, email, emailVerified: false })
      expect(fragment.get('oidc_error')).toBe('oidc_email_unverified')
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    })

    it("identité déjà reliée dont l'email a changé chez le fournisseur : pas d'invitation prise sans le lien", async () => {
      const subject = `sub-change-${run}`
      expect((await oidcLogin({ subject, email: mail('avant'), emailVerified: true })).get('oidc')).toBeTruthy()
      const target = mail('cible')
      await invite(target)
      expect((await oidcLogin({ subject, email: target, emailVerified: true })).get('oidc')).toBeTruthy()
      const user = await prisma.user.findUnique({ where: { email: mail('avant') }, select: { id: true } })
      expect(await prisma.treeMembership.findUnique({ where: { treeId_userId: { treeId, userId: user!.id } } })).toBeNull()
    })

    it("email non vérifié sur un compte déjà relié : l'invitation reste en attente", async () => {
      const email = mail('oidc-relie')
      const subject = `sub-relie-${run}`
      expect((await oidcLogin({ subject, email, emailVerified: true })).get('oidc')).toBeTruthy()
      await invite(email)
      expect((await oidcLogin({ subject, email, emailVerified: false })).get('oidc')).toBeTruthy()
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
      expect(await prisma.treeMembership.findUnique({ where: { treeId_userId: { treeId, userId: user!.id } } })).toBeNull()
    })
  })
})
