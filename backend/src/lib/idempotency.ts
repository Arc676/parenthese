import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

// Envois rejoués sans doublon (en-tête Idempotency-Key). Sur un réseau faible, la famille renvoie une proposition
// ou une photo dont la réponse s'est perdue : le serveur avait déjà tout créé, et l'arbre recevait deux fois la
// même chose. Le navigateur tire une clé au début d'un envoi et la garde pour chaque nouvel essai ; le serveur
// répond au second essai avec la réponse du premier, sans rien recréer. Deux essais simultanés : le second attend
// le premier.
//
// En mémoire, sur une seule instance de l'API (le cas de Parenthèse et de l'auto-hébergement) : un redémarrage
// oublie les clés, ce qui ne recrée de doublon que si un essai tombe pile pendant le redémarrage.

// Les créations faites par la famille : propositions, souvenirs, photos posées sur l'arbre, moments
const IDEMPOTENT_ROUTES = new Set([
  'POST /trees/:id/contributions/sessions',
  'POST /trees/:id/persons/:personId/media',
  'POST /trees/:id/annotation-photos',
  'POST /trees/:id/persons/:personId/life/events',
])

const TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 5000
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/

type Stored = { statusCode: number, contentType: string | undefined, payload: string }
type Entry = { expires: number, done: Stored | null, settled: Promise<void>, settle: () => void }

const entries = new Map<string, Entry>()

function prune(now: number) {
  for (const [scope, entry] of entries) {
    if (entry.expires <= now) entries.delete(scope)
  }
  // Au-delà du plafond, les plus anciennes partent d'abord (la Map garde l'ordre d'insertion)
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.get(oldest)?.settle()
    entries.delete(oldest)
  }
}

// Une clé ne vaut que pour la même route, la même adresse et la même personne : celle d'un autre ne rejoue rien
function scopeOf(request: FastifyRequest, key: string) {
  const who = createHash('sha256').update(request.headers.authorization ?? `ip:${request.ip}`).digest('hex').slice(0, 32)
  return `${request.method} ${request.url} ${who} ${key}`
}

function replay(reply: FastifyReply, stored: Stored) {
  if (stored.contentType) reply.header('content-type', stored.contentType)
  return reply.code(stored.statusCode).header('idempotent-replayed', 'true').send(stored.payload)
}

export function registerIdempotency(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (!IDEMPOTENT_ROUTES.has(`${request.method} ${request.routeOptions.url}`)) return
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return

    const now = Date.now()
    prune(now)
    const scope = scopeOf(request, key)

    // Un essai précédent est en cours : on attend sa fin, puis on rejoue sa réponse s'il a abouti
    for (let existing = entries.get(scope); existing; existing = entries.get(scope)) {
      if (existing.done) return replay(reply, existing.done)
      await existing.settled
    }

    let settle = () => {}
    const settled = new Promise<void>((resolve) => { settle = resolve })
    entries.set(scope, { expires: now + TTL_MS, done: null, settled, settle })
    request.idempotencyScope = scope
  })

  app.addHook('onSend', async (request, reply, payload) => {
    const scope = request.idempotencyScope
    if (!scope) return payload
    const entry = entries.get(scope)
    if (!entry) return payload
    // Seule une réussite se rejoue ; un échec laisse le prochain essai refaire la requête
    if (reply.statusCode < 300 && typeof payload === 'string') {
      const contentType = reply.getHeader('content-type')
      entry.done = { statusCode: reply.statusCode, contentType: typeof contentType === 'string' ? contentType : undefined, payload }
    } else {
      entries.delete(scope)
    }
    entry.settle()
    return payload
  })

  // Requête coupée avant toute réponse : l'essai suivant ne doit pas attendre pour rien
  app.addHook('onResponse', async (request) => {
    const scope = request.idempotencyScope
    const entry = scope ? entries.get(scope) : undefined
    if (entry && !entry.done) {
      entries.delete(scope as string)
      entry.settle()
    }
  })
}

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyScope?: string
  }
}

// Tests
export function resetIdempotency() {
  entries.clear()
}
