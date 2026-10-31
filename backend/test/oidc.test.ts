import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Connexion OIDC (#115), routes et règles de compte. Le protocole lui-même (PKCE, state, nonce, signature, émetteur,
// audience de l'ID token) est celui d'openid-client, simulé ici : il est testé de bout en bout contre un vrai
// fournisseur à part. Ce fichier vérifie ce que Parenthèse décide avec ce que le fournisseur renvoie.
const { prismaMock, oidcMock } = vi.hoisted(() => ({
  prismaMock: {
    // Sessions fermées (lib/token-revocation.ts), rechargées au démarrage
    revokedSession: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    userIdentity: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    treeInvitation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $disconnect: vi.fn(),
  },
  oidcMock: {
    startAuthorization: vi.fn(),
    finishAuthorization: vi.fn(),
  },
}))

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../src/lib/oidc.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/oidc.js')>()),
  ...oidcMock,
}))

const ISSUER = 'https://id.example.org'
const pending = { state: 'state-1', nonce: 'nonce-1', codeVerifier: 'v'.repeat(43), returnTo: '/' }
const identity = { issuer: ISSUER, subject: 'sub-1', email: 'camille@example.com', emailVerified: true, firstName: 'Camille' }

let app: FastifyInstance
let env: { ALLOW_REGISTRATION: boolean; PASSWORD_LOGIN: boolean; OIDC_REQUIRE_VERIFIED_EMAIL: boolean }

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/genealogy'
  process.env.JWT_SECRET = 'test-secret-with-sufficient-length'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
  process.env.OIDC_ISSUER = ISSUER
  process.env.OIDC_CLIENT_ID = 'parenthese'
  process.env.OIDC_CLIENT_SECRET = 'secret'
  process.env.OIDC_REDIRECT_URI = 'https://arbre.example.org/auth/oidc/callback'
  process.env.OIDC_PROVIDER_NAME = 'Authentik'
  ;({ env } = await import('../src/config/env.js'))
  const { createApp } = await import('../src/app.js')
  app = createApp()
})

afterAll(async () => {
  for (const key of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_PROVIDER_NAME']) delete process.env[key]
  await app?.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  env.ALLOW_REGISTRATION = true
  env.PASSWORD_LOGIN = true
  env.OIDC_REQUIRE_VERIFIED_EMAIL = true
  oidcMock.startAuthorization.mockImplementation(async (returnTo: string) => ({
    url: new URL(`${ISSUER}/authorize?state=state-1`),
    pending: { ...pending, returnTo },
  }))
  oidcMock.finishAuthorization.mockResolvedValue(identity)
  prismaMock.user.count.mockResolvedValue(1)
  prismaMock.user.findUnique.mockResolvedValue(null)
  prismaMock.userIdentity.findUnique.mockResolvedValue(null)
  prismaMock.treeInvitation.findFirst.mockResolvedValue(null)
  prismaMock.treeInvitation.findMany.mockResolvedValue([])
  prismaMock.userIdentity.create.mockResolvedValue({})
  prismaMock.user.create.mockResolvedValue({ id: 'user-new' })
  prismaMock.$transaction.mockImplementation(async (run: (tx: typeof prismaMock) => unknown) => run(prismaMock))
  prismaMock.$executeRaw.mockResolvedValue(1)
})

// Chaque connexion simulée vient de sa propre adresse : les routes OIDC sont limitées à 20 appels par minute et
// par adresse, et le fichier en fait plus
let visitor = 0
const nextAddress = () => `10.0.${Math.floor(++visitor / 250)}.${visitor % 250 + 1}`
let currentAddress = nextAddress()

// Début de connexion : renvoie le cookie signé que le navigateur rapportera au retour
async function start(returnTo = '/') {
  currentAddress = nextAddress()
  const res = await app.inject({ method: 'GET', url: `/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`, remoteAddress: currentAddress })
  const setCookie = String(res.headers['set-cookie'])
  return { res, cookie: setCookie.split(';')[0] }
}

async function callback(cookie?: string, query = '?code=abc&state=state-1') {
  return app.inject({ method: 'GET', url: `/auth/oidc/callback${query}`, headers: cookie ? { cookie } : {}, remoteAddress: currentAddress })
}

function fragmentOf(location: string | undefined) {
  return new URLSearchParams(String(location).split('#')[1] ?? '')
}

describe('départ et retour', () => {
  it("annonce le fournisseur à l'écran de connexion", async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/options' })
    expect(res.json()).toEqual({ registration: true, passwordLogin: true, oidc: { name: 'Authentik' }, signupPrompts: false })
  })

  it('part chez le fournisseur avec un cookie signé, httpOnly, lax, sécurisé en https', async () => {
    const { res } = await start()
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe(`${ISSUER}/authorize?state=state-1`)
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toMatch(/^parenthese_oidc=/)
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/SameSite=Lax/)
    expect(setCookie).toMatch(/Secure/)
  })

  it("n'accepte comme retour que la racine ou un arbre partagé (pas de redirection ouverte)", async () => {
    await start('/arbre/famille-exemple')
    expect(oidcMock.startAuthorization).toHaveBeenLastCalledWith('/arbre/famille-exemple')
    for (const bad of ['https://evil.example', '//evil.example', '/arbre/../../x', '/\\evil.example']) {
      await start(bad)
      expect(oidcMock.startAuthorization).toHaveBeenLastCalledWith('/')
    }
  })

  it('refuse un retour sans connexion commencée dans ce navigateur', async () => {
    const res = await callback()
    expect(res.statusCode).toBe(302)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_failed')
    expect(oidcMock.finishAuthorization).not.toHaveBeenCalled()
  })

  it('refuse un cookie modifié', async () => {
    const { cookie } = await start()
    const forged = cookie.replace(/state-1/, 'state-2').replace(/%22state%22%3A%22state-1/, '%22state%22%3A%22state-2')
    const tampered = forged === cookie ? `${cookie}x` : forged
    const res = await callback(tampered)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_failed')
    expect(oidcMock.finishAuthorization).not.toHaveBeenCalled()
  })

  it("passe à openid-client l'état gardé dans le cookie, et refuse quand la vérification échoue", async () => {
    const { cookie } = await start()
    oidcMock.finishAuthorization.mockRejectedValueOnce(new Error('unexpected ID Token "aud" (audience) claim value'))
    const res = await callback(cookie)
    expect(oidcMock.finishAuthorization).toHaveBeenCalledWith('?code=abc&state=state-1', expect.objectContaining({ state: 'state-1', nonce: 'nonce-1' }))
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_failed')
    expect(String(res.headers['set-cookie'])).toMatch(/parenthese_oidc=;/)
  })

  it('revient sur l’arbre partagé demandé au départ', async () => {
    prismaMock.userIdentity.findUnique.mockResolvedValue({ userId: 'user-9' })
    const { cookie } = await start('/arbre/famille-exemple')
    const res = await callback(cookie)
    expect(String(res.headers.location)).toMatch(/^https:\/\/arbre\.example\.org\/arbre\/famille-exemple#oidc=/)
  })
})

describe('compte relié, créé ou refusé', () => {
  it('identité déjà reliée : connexion, même si le fournisseur ne dit plus l’email vérifié', async () => {
    prismaMock.userIdentity.findUnique.mockResolvedValue({ userId: 'user-9' })
    oidcMock.finishAuthorization.mockResolvedValue({ ...identity, emailVerified: false, email: null })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc')).toBeTruthy()
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('identité déjà reliée : retrouvée par émetteur et sujet, jamais par email (le fournisseur a pu le réattribuer)', async () => {
    prismaMock.userIdentity.findUnique.mockResolvedValue({ userId: 'user-9' })
    oidcMock.finishAuthorization.mockResolvedValue({ ...identity, email: 'reattribue@example.com' })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(prismaMock.userIdentity.findUnique).toHaveBeenCalledWith({
      where: { issuer_subject: { issuer: ISSUER, subject: 'sub-1' } },
      select: { userId: true },
    })
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    expect(fragmentOf(res.headers.location).get('oidc')).toBeTruthy()
  })

  it("nouveau sujet avec un email vérifié déjà relié à un autre sujet : refusé, le compte ne change pas de mains", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-7', passwordHash: null, identities: [{ id: 'identity-1' }] })
    oidcMock.finishAuthorization.mockResolvedValue({ ...identity, subject: 'sub-2' })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_email_taken')
    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled()
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it("email vérifié d'un compte à mot de passe : refusé, ni relié ni dupliqué (le compte a pu être créé par un tiers)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-7', passwordHash: 'hash' })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_email_taken')
    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled()
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('email vérifié qui a déjà un compte sans mot de passe : relie le compte, ne le duplique pas', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-7', passwordHash: null })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(prismaMock.userIdentity.create).toHaveBeenCalledWith({ data: { userId: 'user-7', issuer: ISSUER, subject: 'sub-1' } })
    expect(prismaMock.user.create).not.toHaveBeenCalled()
    expect(fragmentOf(res.headers.location).get('oidc')).toBeTruthy()
  })

  it("email non vérifié : ni relié ni créé (sinon n'importe qui prendrait le compte de cette adresse)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-7' })
    oidcMock.finishAuthorization.mockResolvedValue({ ...identity, emailVerified: false })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_email_unverified')
    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled()
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('OIDC_REQUIRE_VERIFIED_EMAIL=false accepte un email non vérifié', async () => {
    env.OIDC_REQUIRE_VERIFIED_EMAIL = false
    oidcMock.finishAuthorization.mockResolvedValue({ ...identity, emailVerified: false })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(prismaMock.user.create).toHaveBeenCalled()
    expect(fragmentOf(res.headers.location).get('oidc')).toBeTruthy()
  })

  it('OIDC_REQUIRE_VERIFIED_EMAIL=false ne relie jamais un compte existant sur un email non vérifié', async () => {
    env.OIDC_REQUIRE_VERIFIED_EMAIL = false
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-7' })
    oidcMock.finishAuthorization.mockResolvedValue({ ...identity, emailVerified: false })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_email_unverified')
    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled()
  })

  it('sans email du tout : refus clair', async () => {
    oidcMock.finishAuthorization.mockResolvedValue({ ...identity, email: null })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_email_missing')
  })

  it('compte neuf sans mot de passe, identité reliée, quand l’instance en accepte', async () => {
    const { cookie } = await start()
    await callback(cookie)
    expect(prismaMock.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'camille@example.com',
        passwordHash: null,
        identities: { create: { issuer: ISSUER, subject: 'sub-1' } },
      }),
    }))
  })

  it('inscription fermée : le fournisseur ne crée pas de compte (#113)', async () => {
    env.ALLOW_REGISTRATION = false
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('registration_closed')
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('inscription fermée : un compte existant se connecte toujours par le fournisseur', async () => {
    env.ALLOW_REGISTRATION = false
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-7' })
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc')).toBeTruthy()
  })

  it('inscription fermée sur une instance vide : le premier compte naît par le fournisseur', async () => {
    env.ALLOW_REGISTRATION = false
    prismaMock.user.count.mockResolvedValue(0)
    const { cookie } = await start()
    const res = await callback(cookie)
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
    expect(fragmentOf(res.headers.location).get('oidc')).toBeTruthy()
  })
})

describe('échange du jeton de passage', () => {
  async function handoff() {
    prismaMock.userIdentity.findUnique.mockResolvedValue({ userId: 'user-9' })
    const { cookie } = await start()
    const res = await callback(cookie)
    return fragmentOf(res.headers.location).get('oidc') as string
  }

  it('donne une session une seule fois', async () => {
    const code = await handoff()
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-9', email: 'camille@example.com', firstName: 'Camille', passwordHash: null })
    const first = await app.inject({ method: 'POST', url: '/auth/oidc/exchange', payload: { code } })
    expect(first.statusCode).toBe(200)
    expect(first.json().user).toEqual({ id: 'user-9', email: 'camille@example.com', firstName: 'Camille', hasPassword: false })

    const second = await app.inject({ method: 'POST', url: '/auth/oidc/exchange', payload: { code } })
    expect(second.statusCode).toBe(401)
  })

  it("le jeton de passage n'ouvre aucune session, et une session n'est pas un jeton de passage", async () => {
    const code = await handoff()
    const asBearer = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${code}` } })
    expect(asBearer.statusCode).toBe(401)

    const session = app.jwt.sign({ kind: 'user', sub: 'user-9', jti: 'j', userId: 'user-9', email: 'camille@example.com' })
    const asCode = await app.inject({ method: 'POST', url: '/auth/oidc/exchange', payload: { code: session } })
    expect(asCode.statusCode).toBe(401)
  })
})

describe('connexion par le fournisseur seulement (PASSWORD_LOGIN=false)', () => {
  it('refuse connexion et inscription par mot de passe, et le dit à l’écran', async () => {
    env.PASSWORD_LOGIN = false
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@example.com', password: 'motdepasse1' } })
    const register = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'a@example.com', password: 'motdepasse1' } })
    expect(login.statusCode).toBe(403)
    expect(login.json()).toEqual({ error: 'password_login_disabled' })
    expect(register.statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/auth/options' })).json().passwordLogin).toBe(false)
  })

  it('un compte sans mot de passe ne se connecte jamais par mot de passe', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-9', email: 'camille@example.com', firstName: null, passwordHash: null })
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'camille@example.com', password: 'nimportequoi' } })
    expect(res.statusCode).toBe(401)
  }, 15000)
})

describe('rattacher le fournisseur à un compte à mot de passe (avant PASSWORD_LOGIN=false)', () => {
  const sessionOf = (userId: string) => app.jwt.sign({ kind: 'user', sub: userId, jti: `s-${userId}`, userId, email: 'anais@example.com' })

  async function ticketFor(userId: string) {
    const res = await app.inject({ method: 'POST', url: '/auth/oidc/link', headers: { authorization: `Bearer ${sessionOf(userId)}` }, remoteAddress: nextAddress() })
    expect(res.statusCode).toBe(200)
    return res.json().ticket as string
  }

  async function startLink(ticket: string) {
    currentAddress = nextAddress()
    const res = await app.inject({ method: 'GET', url: `/auth/oidc/start?link=${encodeURIComponent(ticket)}&returnTo=${encodeURIComponent('/arbre/abc')}`, remoteAddress: currentAddress })
    return { res, cookie: String(res.headers['set-cookie']).split(';')[0] }
  }

  it('sans session, pas de ticket', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/oidc/link', remoteAddress: nextAddress() })
    expect(res.statusCode).toBe(401)
  })

  it("relie l'identité au compte qui a demandé le ticket, même avec un mot de passe et sans regarder l'email", async () => {
    const ticket = await ticketFor('user-pw')
    const { res: started, cookie } = await startLink(ticket)
    expect(started.statusCode).toBe(302)
    // Le retour de l'app ne vient pas de la requête : un rattachement revient toujours à la racine
    expect(oidcMock.startAuthorization).toHaveBeenCalledWith('/')
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-pw' })
    oidcMock.finishAuthorization.mockResolvedValue({ ...identity, email: 'autre@example.com', emailVerified: false })
    const res = await callback(cookie)
    expect(prismaMock.userIdentity.create).toHaveBeenCalledWith({ data: { userId: 'user-pw', issuer: ISSUER, subject: 'sub-1' } })
    const code = fragmentOf(res.headers.location).get('oidc') as string
    expect(app.jwt.decode<{ sub: string }>(code)?.sub).toBe('user-pw')
    // Le rattachement ne passe jamais par la recherche d'un compte par email ni par la création d'un compte
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it("une identité déjà reliée à un autre compte n'est jamais déplacée", async () => {
    const ticket = await ticketFor('user-pw')
    const { cookie } = await startLink(ticket)
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-pw' })
    prismaMock.userIdentity.findUnique.mockResolvedValue({ userId: 'user-other' })
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_identity_taken')
    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled()
  })

  it('déjà reliée à ce compte : connexion, rien de recréé', async () => {
    const ticket = await ticketFor('user-pw')
    const { cookie } = await startLink(ticket)
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-pw' })
    prismaMock.userIdentity.findUnique.mockResolvedValue({ userId: 'user-pw' })
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc')).toBeTruthy()
    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled()
  })

  it('le ticket sert une fois, et un faux ticket ou une session ne lancent rien', async () => {
    const ticket = await ticketFor('user-pw')
    expect((await startLink(ticket)).res.statusCode).toBe(302)
    const again = await startLink(ticket)
    expect(fragmentOf(again.res.headers.location).get('oidc_error')).toBe('oidc_link_expired')
    const forged = await startLink('nimportequoi')
    expect(fragmentOf(forged.res.headers.location).get('oidc_error')).toBe('oidc_link_expired')
    const session = await startLink(sessionOf('user-pw'))
    expect(fragmentOf(session.res.headers.location).get('oidc_error')).toBe('oidc_link_expired')
  })

  it("le ticket n'ouvre aucune session", async () => {
    const ticket = await ticketFor('user-pw')
    const asBearer = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${ticket}` } })
    expect(asBearer.statusCode).toBe(401)
  })

  it('compte supprimé entre le ticket et le retour : refusé', async () => {
    const ticket = await ticketFor('user-pw')
    const { cookie } = await startLink(ticket)
    prismaMock.user.findUnique.mockResolvedValue(null)
    const res = await callback(cookie)
    expect(fragmentOf(res.headers.location).get('oidc_error')).toBe('oidc_failed')
    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled()
  })
})

describe('journaux', () => {
  it("le code d'autorisation du retour n'est pas journalisé", async () => {
    const { redactUrl } = await import('../src/app.js')
    expect(redactUrl('/auth/oidc/callback?code=secret-code&state=s1')).toBe('/auth/oidc/callback?code=[masqué]&state=s1')
  })
})
