import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { signMediaToken } from '../lib/tree-access.js'
import { recordTreeVisit, type VisitAccessKind } from '../lib/tree-visits.js'
import { buildGraphPayload } from '../utils/graph-payload.js'

const treeIdParamSchema = z.object({
  id: z.string().min(1),
})

type ReadAccess =
  | { ok: true; rootPersonId: string | null; visitKind: VisitAccessKind }
  | { ok: false; status: number; error: string }

// Qui peut lire un arbre : un accès par mot de passe de cet arbre, un membre, ou un compte avec qui il est
// partagé. Utilisé par le graphe et par la frise de vie d'une personne.
async function resolveReadAccess(app: FastifyInstance, actor: FastifyRequest['actor'], treeId: string): Promise<ReadAccess> {
  let rootPersonId: string | null = null
  let visitKind: VisitAccessKind = 'share'
  if (!actor) {
    return { ok: false, status: 401, error: 'authentication_required' }
  }

  if (actor.kind === 'tree_access') {
    if (actor.treeId !== treeId) {
      return { ok: false, status: 403, error: 'forbidden' }
    }

    const tree = await app.prisma.tree.findFirst({
      where: {
        id: treeId,
        deletedAt: null,
      },
      select: {
        id: true,
        rootPersonId: true,
      },
    })

    if (!tree) {
      return { ok: false, status: 404, error: 'tree_not_found' }
    }

    rootPersonId = tree.rootPersonId
  }

  if (actor.kind === 'user') {
    const membership = await app.prisma.treeMembership.findUnique({
      where: {
        treeId_userId: {
          treeId,
          userId: actor.userId,
        },
      },
      include: {
        tree: {
          select: {
            deletedAt: true,
            rootPersonId: true,
          },
        },
      },
    })

    if (membership && !membership.tree.deletedAt) {
      rootPersonId = membership.tree.rootPersonId
      visitKind = 'member'
    } else {
      const shared = await app.prisma.userTreeAccess.findUnique({
        where: {
          treeId_userId: {
            treeId,
            userId: actor.userId,
          },
        },
        include: {
          tree: {
            select: {
              deletedAt: true,
              rootPersonId: true,
            },
          },
        },
      })

      if (!shared || shared.tree.deletedAt) {
        return { ok: false, status: 403, error: 'forbidden' }
      }

      rootPersonId = shared.tree.rootPersonId
      visitKind = 'shared_account'
    }
  }

  return { ok: true, rootPersonId, visitKind }
}

export const graphRoutes: FastifyPluginAsync = async (app) => {
  app.get('/trees/:id/graph', async (request, reply) => {
    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const treeId = params.data.id
    const actor = request.actor
    let rootPersonId: string | null = null
    let visitKind: VisitAccessKind = 'share'

    const access = await resolveReadAccess(app, actor, treeId)
    if (!access.ok || !actor) {
      if (access.ok) return reply.code(401).send({ error: 'authentication_required' })
      return reply.code(access.status).send({ error: access.error })
    }
    rootPersonId = access.rootPersonId
    visitKind = access.visitKind

    // Journal des visites (onglet Visites des administrateurs), sans attendre
    void recordTreeVisit(app, request, treeId, visitKind, actor.kind === 'user' ? actor.userId : null)

    const [persons, unions, links, medias, annotations] = await Promise.all([
      app.prisma.person.findMany({
        where: {
          treeId,
          deletedAt: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      app.prisma.union.findMany({
        where: {
          treeId,
          deletedAt: null,
        },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      app.prisma.parentChildLink.findMany({
        where: {
          treeId,
          deletedAt: null,
        },
        orderBy: [{ parentPersonId: 'asc' }, { viaUnionId: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      app.prisma.mediaItem.findMany({
        where: {
          treeId,
          status: 'approved',
          deletedAt: null,
        },
        orderBy: [{ personId: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      app.prisma.annotation.findMany({
        where: {
          treeId,
          deletedAt: null,
        },
        orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    ])

    const graph = buildGraphPayload(treeId, persons, unions, links, medias, annotations)

    return reply.send({
      treeId,
      rootPersonId,
      graph,
      // Pour l'adresse des images (<img src> n'envoie pas la session) : lecture des médias de cet arbre seulement
      mediaToken: signMediaToken(app, treeId, actor),
    })
  })

  // Frise de vie d'une personne : chargée à l'ouverture de la fiche plutôt que dans le graphe, qui resterait
  // lourd sur un grand arbre. Mêmes droits de lecture que le graphe.
  app.get('/trees/:id/persons/:personId/life', async (request, reply) => {
    const params = z.object({ id: z.string().min(1), personId: z.string().min(1) }).safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }
    const { id: treeId, personId } = params.data
    const access = await resolveReadAccess(app, request.actor, treeId)
    if (!access.ok) {
      return reply.code(access.status).send({ error: access.error })
    }

    const person = await app.prisma.person.findFirst({
      where: { id: personId, treeId, deletedAt: null },
      select: {
        id: true, birthDatePrecision: true, birthDateEnd: true, deathDatePrecision: true, deathDateEnd: true,
        deathPlace: true, nickname: true,
      },
    })
    if (!person) {
      return reply.code(404).send({ error: 'person_not_found' })
    }

    const unions = await app.prisma.union.findMany({
      where: { treeId, deletedAt: null, OR: [{ partner1PersonId: personId }, { partner2PersonId: personId }] },
      select: { id: true, partner1PersonId: true, partner2PersonId: true, startDate: true, startPlace: true, startDatePrecision: true, endDate: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const unionIds = unions.map((union) => union.id)
    const events = await app.prisma.lifeEvent.findMany({
      where: { treeId, deletedAt: null, status: 'approved', OR: [{ personId }, ...(unionIds.length ? [{ unionId: { in: unionIds } }] : [])] },
      select: {
        id: true, personId: true, unionId: true, type: true, label: true, date: true, dateEnd: true, datePrecision: true,
        dateText: true, place: true, description: true, notes: true, sources: true, mediaId: true, displayOrder: true,
      },
      orderBy: [{ date: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
    })

    // Souvenirs rattachés à chaque moment (photo, vidéo, acte…), visibles seulement une fois acceptés
    const attached = events.length
      ? await app.prisma.mediaItem.findMany({
        where: { treeId, lifeEventId: { in: events.map((event) => event.id) }, status: 'approved', deletedAt: null },
        select: { id: true, lifeEventId: true },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      })
      : []
    const mediaIdsByEvent = new Map<string, string[]>()
    for (const media of attached) {
      if (!media.lifeEventId) continue
      mediaIdsByEvent.set(media.lifeEventId, [...(mediaIdsByEvent.get(media.lifeEventId) ?? []), media.id])
    }

    const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null)
    return reply.send({
      person: {
        birthDatePrecision: person.birthDatePrecision,
        birthDateEnd: day(person.birthDateEnd),
        deathDatePrecision: person.deathDatePrecision,
        deathDateEnd: day(person.deathDateEnd),
        deathPlace: person.deathPlace,
        nickname: person.nickname,
      },
      unions: unions.map((union) => ({
        id: union.id,
        partnerId: union.partner1PersonId === personId ? union.partner2PersonId : union.partner1PersonId,
        startDate: day(union.startDate),
        startPlace: union.startPlace,
        startDatePrecision: union.startDatePrecision,
        endDate: day(union.endDate),
      })),
      // L'ancienne colonne mediaId est reprise par media_items.lifeEventId (migration du 17/10)
      events: events.map(({ mediaId: _legacy, ...event }) => ({
        ...event,
        date: day(event.date),
        dateEnd: day(event.dateEnd),
        mediaIds: mediaIdsByEvent.get(event.id) ?? [],
      })),
    })
  })
}
