import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { canReadTree } from '../lib/tree-access.js'
import { enabledSearchSources, searchSource, SearchSourceUnavailableError } from '../lib/search-sources.js'

// Panneau « Chercher quelqu'un » : le serveur interroge les sources allumées par l'opérateur
// (SEARCH_SOURCES) au nom d'une personne qui lit l'arbre. Rattaché à un arbre pour ne pas faire de
// l'instance un relais ouvert vers ces services ; rien n'est enregistré, seule la question part.

const paramsSchema = z.object({ id: z.string().min(1), source: z.string().min(1).max(40) })

const querySchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthYear: z.coerce.number().int().min(1500).max(2100).optional(),
  place: z.string().trim().max(120).optional(),
})

export const searchSourceRoutes: FastifyPluginAsync = async (app) => {
  // Sources que le front peut proposer : rien d'autre que leurs identifiants. Sous /trees comme le reste :
  // nginx ne relaie vers l'API que /api, /auth, /trees et /health
  app.get('/trees/:id/search-sources', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    if (!request.actor) return reply.code(401).send({ error: 'authentication_required' })
    if (!(await canReadTree(app, params.data.id, request.actor))) return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ sources: enabledSearchSources() })
  })

  app.post(
    '/trees/:id/search-sources/:source',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params)
      if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

      if (!request.actor) return reply.code(401).send({ error: 'authentication_required' })
      if (!(await canReadTree(app, params.data.id, request.actor))) return reply.code(403).send({ error: 'forbidden' })

      if (!enabledSearchSources().includes(params.data.source)) return reply.code(404).send({ error: 'source_not_enabled' })

      const body = querySchema.safeParse(request.body)
      if (!body.success) return reply.code(400).send({ error: 'invalid_query' })

      try {
        const results = await searchSource(params.data.source, body.data)
        return reply.send({ results })
      } catch (error) {
        if (error instanceof SearchSourceUnavailableError) {
          request.log.warn({ source: params.data.source, reason: error.message }, 'search source unavailable')
          // Quota : l'opérateur peut y remédier (MATCHID_TOKEN), le front le dit autrement qu'une panne
          return reply.code(502).send({ error: error.message === 'quota' ? 'source_quota' : 'source_unavailable' })
        }
        throw error
      }
    },
  )
}
