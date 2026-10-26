import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '../generated/prisma/client.js'
import { z } from 'zod'

import {
  InvalidAnnotationContentError,
  sanitizeAnnotationContentForRead,
  sanitizeAnnotationContentForWrite,
} from '../lib/annotation-content.js'
import { UPLOAD_BODY_LIMIT } from '../config/env.js'
import { canReadTree } from '../lib/tree-access.js'
import type { MembershipRole } from '../types/auth.js'

const treeIdParamSchema = z.object({
  id: z.string().min(1),
})

const annotationParamsSchema = z.object({
  id: z.string().min(1),
  annotationId: z.string().min(1),
})

// Bornes : sans elles, un envoi groupé de 12 Mo par requête et sans limite de fréquence remplissait la base
const MAX_BATCH_ITEMS = 500
const MAX_STYLE_CHARS = 4000
const MAX_ANNOTATIONS_PER_TREE = 5000
const ANNOTATION_RATE_LIMIT = { max: 60, timeWindow: '1 minute' }

const styleSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= MAX_STYLE_CHARS,
  { message: 'style_too_large' },
)

const createAnnotationSchema = z.object({
  type: z.enum(['drawing', 'sticker', 'text', 'photo']),
  x: z.number(),
  y: z.number(),
  content: z.string().min(1).max(50000),
  style: styleSchema.optional(),
  zIndex: z.number().int().optional(),
})

const patchAnnotationSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    content: z.string().min(1).max(50000).optional(),
    style: styleSchema.optional(),
    zIndex: z.number().int().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_field_required',
  })

const batchAnnotationSchema = z.object({
  create: z.array(createAnnotationSchema).max(MAX_BATCH_ITEMS).optional().default([]),
  update: z.array(z.object({
    id: z.string().min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    content: z.string().min(1).max(50000).optional(),
    style: styleSchema.optional(),
    zIndex: z.number().int().optional(),
  })).max(MAX_BATCH_ITEMS).optional().default([]),
  delete: z.array(z.string().min(1)).max(MAX_BATCH_ITEMS).optional().default([]),
})

function requireUser(request: FastifyRequest, reply: FastifyReply): { userId: string; email: string } | null {
  if (!request.actor || request.actor.kind !== 'user') {
    reply.code(401).send({ error: 'authentication_required' })
    return null
  }

  return {
    userId: request.actor.userId,
    email: request.actor.email,
  }
}

// null = chemin de photo refusé (voir lib/annotation-content.ts)
function cleanContent(content: string, treeId: string): string | null {
  try {
    return sanitizeAnnotationContentForWrite(content, treeId)
  } catch (error) {
    if (error instanceof InvalidAnnotationContentError) return null
    throw error
  }
}

function hasAdminRight(role: MembershipRole): boolean {
  return role === 'owner' || role === 'admin'
}

async function getAdminMembership(app: FastifyInstance, userId: string, treeId: string) {
  const membership = await app.prisma.treeMembership.findUnique({
    where: {
      treeId_userId: { treeId, userId },
    },
    include: {
      tree: {
        select: { deletedAt: true },
      },
    },
  })

  return membership
}

function hasActiveAdminMembership(membership: Awaited<ReturnType<typeof getAdminMembership>>): boolean {
  return Boolean(membership && !membership.tree.deletedAt && hasAdminRight(membership.role))
}

async function exceedsAnnotationCap(app: FastifyInstance, treeId: string, incoming: number): Promise<boolean> {
  if (incoming === 0) return false
  const count = await app.prisma.annotation.count({ where: { treeId, deletedAt: null } })
  return count + incoming > MAX_ANNOTATIONS_PER_TREE
}

export const annotationRoutes: FastifyPluginAsync = async (app) => {
  // CREATE annotation
  app.post('/trees/:id/annotations', { config: { rateLimit: ANNOTATION_RATE_LIMIT } }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_tree_id' })

    const payload = createAnnotationSchema.safeParse(request.body)
    if (!payload.success) return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) return reply.code(403).send({ error: 'forbidden' })

    if (await exceedsAnnotationCap(app, params.data.id, 1)) return reply.code(413).send({ error: 'annotation_limit_reached' })

    const content = cleanContent(payload.data.content, params.data.id)
    if (content === null) return reply.code(400).send({ error: 'invalid_annotation_photo_path' })

    const annotation = await app.prisma.annotation.create({
      data: {
        treeId: params.data.id,
        type: payload.data.type,
        x: payload.data.x,
        y: payload.data.y,
        content,
        style: (payload.data.style ?? {}) as Prisma.InputJsonValue,
        zIndex: payload.data.zIndex ?? 0,
        createdBy: user.userId,
      },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'annotation_created',
        entityType: 'annotation',
        entityId: annotation.id,
        payloadJson: { type: annotation.type },
      },
    })

    return reply.code(201).send({ annotation })
  })

  // LIST annotations
  app.get('/trees/:id/annotations', async (request, reply) => {
    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_tree_id' })

    if (!request.actor) return reply.code(401).send({ error: 'authentication_required' })
    if (!(await canReadTree(app, params.data.id, request.actor))) return reply.code(403).send({ error: 'forbidden' })

    const annotations = await app.prisma.annotation.findMany({
      where: {
        treeId: params.data.id,
        deletedAt: null,
      },
      orderBy: [{ zIndex: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })

    return reply.send({
      annotations: annotations.map((annotation) => ({ ...annotation, content: sanitizeAnnotationContentForRead(annotation.content) })),
    })
  })

  // UPDATE annotation
  app.patch('/trees/:id/annotations/:annotationId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return

    const params = annotationParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const payload = patchAnnotationSchema.safeParse(request.body)
    if (!payload.success) return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) return reply.code(403).send({ error: 'forbidden' })

    const data: Record<string, unknown> = {}
    if (payload.data.x !== undefined) data.x = payload.data.x
    if (payload.data.y !== undefined) data.y = payload.data.y
    if (payload.data.content !== undefined) {
      const content = cleanContent(payload.data.content, params.data.id)
      if (content === null) return reply.code(400).send({ error: 'invalid_annotation_photo_path' })
      data.content = content
    }
    if (payload.data.style !== undefined) data.style = payload.data.style
    if (payload.data.zIndex !== undefined) data.zIndex = payload.data.zIndex

    const updated = await app.prisma.annotation.updateMany({
      where: {
        id: params.data.annotationId,
        treeId: params.data.id,
        deletedAt: null,
      },
      data,
    })

    if (updated.count === 0) return reply.code(404).send({ error: 'annotation_not_found' })

    const annotation = await app.prisma.annotation.findUnique({
      where: { id: params.data.annotationId },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'annotation_updated',
        entityType: 'annotation',
        entityId: params.data.annotationId,
        payloadJson: { changedFields: Object.keys(payload.data) },
      },
    })

    return reply.send({ annotation })
  })

  // DELETE annotation (soft delete)
  app.delete('/trees/:id/annotations/:annotationId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return

    const params = annotationParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) return reply.code(403).send({ error: 'forbidden' })

    const deleted = await app.prisma.annotation.updateMany({
      where: {
        id: params.data.annotationId,
        treeId: params.data.id,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    })

    if (deleted.count === 0) return reply.code(404).send({ error: 'annotation_not_found' })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'annotation_deleted',
        entityType: 'annotation',
        entityId: params.data.annotationId,
      },
    })

    return reply.send({ ok: true })
  })

  // BATCH annotations (create + update + delete in one request)
  app.post('/trees/:id/annotations/batch', { bodyLimit: UPLOAD_BODY_LIMIT, config: { rateLimit: ANNOTATION_RATE_LIMIT } }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_tree_id' })

    const payload = batchAnnotationSchema.safeParse(request.body)
    if (!payload.success) return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) return reply.code(403).send({ error: 'forbidden' })

    if (await exceedsAnnotationCap(app, params.data.id, payload.data.create.length)) {
      return reply.code(413).send({ error: 'annotation_limit_reached' })
    }

    const treeId = params.data.id
    const results = { created: 0, updated: 0, deleted: 0 }

    // Tout est vérifié avant la première écriture
    const createContents = payload.data.create.map((item) => cleanContent(item.content, treeId))
    const updateContents = payload.data.update.map((item) => (item.content === undefined ? undefined : cleanContent(item.content, treeId)))
    if (createContents.includes(null) || updateContents.includes(null)) {
      return reply.code(400).send({ error: 'invalid_annotation_photo_path' })
    }

    // Créations, modifications, suppressions et trace : tout ou rien, un nouvel essai ne double rien
    await app.prisma.$transaction(async (tx) => {
      // Creates
      for (const [index, item] of payload.data.create.entries()) {
        await tx.annotation.create({
          data: {
            treeId,
            type: item.type,
            x: item.x,
            y: item.y,
            content: createContents[index] as string,
            style: (item.style ?? {}) as Prisma.InputJsonValue,
            zIndex: item.zIndex ?? 0,
            createdBy: user.userId,
          },
        })
        results.created++
      }

      // Updates
      for (const [index, item] of payload.data.update.entries()) {
        const data: Record<string, unknown> = {}
        if (item.x !== undefined) data.x = item.x
        if (item.y !== undefined) data.y = item.y
        if (item.content !== undefined) data.content = updateContents[index]
        if (item.style !== undefined) data.style = item.style
        if (item.zIndex !== undefined) data.zIndex = item.zIndex

        if (Object.keys(data).length > 0) {
          const updated = await tx.annotation.updateMany({
            where: { id: item.id, treeId, deletedAt: null },
            data,
          })
          if (updated.count > 0) results.updated++
        }
      }

      // Deletes
      if (payload.data.delete.length > 0) {
        const deleted = await tx.annotation.updateMany({
          where: {
            id: { in: payload.data.delete },
            treeId,
            deletedAt: null,
          },
          data: { deletedAt: new Date() },
        })
        results.deleted = deleted.count
      }

      await tx.auditLog.create({
        data: {
          treeId,
          actorType: 'user',
          actorId: user.userId,
          action: 'annotations_batch',
          entityType: 'annotation',
          entityId: treeId,
          payloadJson: results,
        },
      })
    })

    return reply.send({ ok: true, ...results })
  })
}
