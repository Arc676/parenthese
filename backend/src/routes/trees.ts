import path from 'node:path'

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { env } from '../config/env.js'
import { hashPassword, verifyPassword } from '../lib/auth.js'
import { softDeletePersonCascade, softDeleteUnionCascade } from '../lib/entity-deletion.js'
import { removeStoredFile } from '../lib/media-files.js'
import { matchSharePassword } from '../lib/password-variants.js'
import { decryptSharePassword, encryptSharePassword } from '../lib/share-password.js'
import { purgeTrees } from '../lib/tree-purge.js'
import { nextSiblingOrder } from '../lib/sibling-order.js'
import { reserveTreeUnlockAttempt, serializePasswordCheck } from '../lib/unlock-guard.js'
import type { MembershipRole } from '../types/auth.js'
import { findParentChildValidationError, findUnionValidationError } from '../utils/relationship-guards.js'
import { personPrecisionResets, unionPrecisionResets } from '../lib/date-precision.js'
import { hasAnyName } from '../lib/person-names.js'
import { sexSchema } from '../lib/person-sex.js'
import { ContributionRouteError, resolveSubmissionContext } from './contributions.js'

const MAX_TREES_PER_ACCOUNT = 10

const treeIdParamSchema = z.object({
  id: z.string().min(1),
})

const createTreeSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(1).max(128),
  description: z.string().max(500).optional().nullable(),
  visitorPassword: z.string().min(8).max(128),
  contributorPassword: z.string().min(8).max(128),
})

const patchTreeSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    slug: z.string().min(1).max(128).optional(),
    description: z.string().max(500).optional().nullable(),
    rootPersonId: z.string().min(1).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_field_required',
  })

const unlockSchema = z.object({
  password: z.string().min(1).max(128),
})

const linkAccessSchema = z.object({
  accessToken: z.string().min(1),
})

const patchPasswordsSchema = z
  .object({
    // Mot de passe de partage unique : écrit dans les deux colonnes
    password: z.string().min(8).max(128).optional(),
    visitorPassword: z.string().min(8).max(128).optional(),
    contributorPassword: z.string().min(8).max(128).optional(),
  })
  .refine((value) => Boolean(value.password || value.visitorPassword || value.contributorPassword), {
    message: 'at_least_one_password_required',
  })

const rememberPasswordSchema = z.object({
  password: z.string().min(1).max(128),
})

const patchTreeSettingsSchema = z
  .object({
    memberContributionPolicy: z.enum(['direct', 'pending']).optional(),
    contributorPolicy: z.enum(['direct', 'pending']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_setting_required',
  })

const listAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().min(1).max(120).optional(),
})

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/

const createPersonSchema = z.object({
  firstName: z.string().trim().max(120),
  lastName: z.string().trim().max(120),
  birthName: z.string().max(120).optional().nullable(),
  nickname: z.string().max(120).optional().nullable(),
  birthDate: z.string().regex(isoDateRegex).optional().nullable(),
  deathDate: z.string().regex(isoDateRegex).optional().nullable(),
  isDeceased: z.boolean().optional(),
  birthPlace: z.string().max(200).optional().nullable(),
  deathPlace: z.string().max(200).optional().nullable(),
  profession: z.string().max(200).optional().nullable(),
  region: z.string().max(120).optional().nullable(),
  nationality: z.string().max(120).optional().nullable(),
  sex: sexSchema,
  notes: z.string().max(2000).optional().nullable(),
}).refine((value) => hasAnyName(value.firstName, value.lastName), { message: 'name_required', path: ['lastName'] })

const patchPersonSchema = z
  .object({
    firstName: z.string().trim().max(120).optional(),
    lastName: z.string().trim().max(120).optional(),
    birthName: z.string().max(120).optional().nullable(),
    nickname: z.string().max(120).optional().nullable(),
    birthDate: z.string().regex(isoDateRegex).optional().nullable(),
    deathDate: z.string().regex(isoDateRegex).optional().nullable(),
    isDeceased: z.boolean().optional(),
    birthPlace: z.string().max(200).optional().nullable(),
    deathPlace: z.string().max(200).optional().nullable(),
    profession: z.string().max(200).optional().nullable(),
    region: z.string().max(120).optional().nullable(),
    nationality: z.string().max(120).optional().nullable(),
    sex: sexSchema,
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_field_required',
  })

const createUnionSchema = z.object({
  partner1PersonId: z.string().min(1),
  partner2PersonId: z.string().min(1).optional().nullable(),
  unionType: z.string().max(50).optional().nullable(),
  startDate: z.string().regex(isoDateRegex).optional().nullable(),
  endDate: z.string().regex(isoDateRegex).optional().nullable(),
  displayOrder: z.number().int().positive().optional(),
})

const patchUnionSchema = z
  .object({
    partner1PersonId: z.string().min(1).optional(),
    partner2PersonId: z.string().min(1).optional().nullable(),
    unionType: z.string().max(50).optional().nullable(),
    startDate: z.string().regex(isoDateRegex).optional().nullable(),
    endDate: z.string().regex(isoDateRegex).optional().nullable(),
    displayOrder: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_field_required',
  })

const createParentChildLinkSchema = z.object({
  parentPersonId: z.string().min(1),
  childPersonId: z.string().min(1),
  viaUnionId: z.string().min(1).optional().nullable(),
  parentageType: z.string().max(50).optional().nullable(),
  displayOrder: z.number().int().positive().optional(),
})

const patchParentChildLinkSchema = z
  .object({
    parentPersonId: z.string().min(1).optional(),
    childPersonId: z.string().min(1).optional(),
    viaUnionId: z.string().min(1).optional().nullable(),
    parentageType: z.string().max(50).optional().nullable(),
    displayOrder: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_field_required',
  })

// Moments de l'onglet Vie (« Ajouter un moment »). Un administrateur ajoute, modifie, supprime ; la famille
// propose, et son moment attend la relecture comme un souvenir. Naissance, décès et mariage gardent leur date
// et leur lieu sur la personne ou l'union : leur ligne ne porte que des sources, une note et des souvenirs.
const LIFE_EVENT_PRECISIONS = ['about', 'estimated', 'calculated', 'before', 'after', 'between', 'from', 'to', 'interpreted'] as const
const RESERVED_LIFE_EVENT_TYPES = new Set(['birth', 'death', 'marriage'])
const lifeEventDateRegex = /^\d{4}(-\d{2}-\d{2})?$/
const lifeEventPayloadSchema = z.object({
  type: z.string().trim().min(1).max(40).regex(/^[a-z_]+$/).default('custom'),
  unionId: z.string().min(1).nullable().optional(),
  label: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  date: z.string().regex(lifeEventDateRegex).nullable().optional(),
  dateEnd: z.string().regex(lifeEventDateRegex).nullable().optional(),
  datePrecision: z.enum(LIFE_EVENT_PRECISIONS).nullable().optional(),
  place: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  sources: z.string().trim().max(4000).nullable().optional(),
  // Souvenirs déjà dans la fiche à rattacher au moment (les nouveaux fichiers s'envoient ensuite avec lifeEventId)
  mediaIds: z.array(z.string().min(1)).max(50).optional(),
  submittedByLabel: z.string().trim().min(1).max(120).optional(),
})
const lifeEventPatchSchema = lifeEventPayloadSchema.omit({ type: true, unionId: true, submittedByLabel: true }).partial()
const lifeEventParamsSchema = z.object({ id: z.string().min(1), eventId: z.string().min(1) })

const lifeEventDate = (value: string | null | undefined) => {
  if (value === undefined) return undefined
  if (!value) return null
  return new Date(`${value.length === 4 ? `${value}-01-01` : value}T00:00:00.000Z`)
}
const emptyToNull = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() ? value.trim() : null)

function lifeEventData(payload: z.infer<typeof lifeEventPatchSchema>, reserved: boolean) {
  const common = { notes: emptyToNull(payload.notes), sources: emptyToNull(payload.sources) }
  // Naissance, décès, mariage : rien d'autre que les sources et la note
  if (reserved) return common
  return {
    ...common,
    label: emptyToNull(payload.label),
    description: emptyToNull(payload.description),
    date: lifeEventDate(payload.date),
    dateEnd: lifeEventDate(payload.dateEnd),
    datePrecision: payload.datePrecision,
    // Saisi dans l'app : pas de texte GEDCOM d'origine à garder
    dateText: null,
    place: emptyToNull(payload.place),
  }
}

const personParamsSchema = z.object({
  id: z.string().min(1),
  personId: z.string().min(1),
})

const unionParamsSchema = z.object({
  id: z.string().min(1),
  unionId: z.string().min(1),
})

const linkParamsSchema = z.object({
  id: z.string().min(1),
  linkId: z.string().min(1),
})

// Ordre d'une fratrie : pour chaque enfant, dans l'ordre voulu, les liens qui le rattachent à ses parents
const childrenOrderSchema = z.object({
  order: z
    .array(
      z.object({
        childId: z.string().min(1),
        linkIds: z.array(z.string().min(1)).min(1).max(4),
      }),
    )
    .min(2)
    .max(200),
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

function hasAdminRight(role: MembershipRole): boolean {
  return role === 'owner' || role === 'admin'
}

// Rattache un compte à l'arbre ouvert par le mot de passe de partage, si ce mot de passe est toujours celui en
// vigueur (accessVersion). Le verrou partagé sur la ligne fait attendre un changement de mot de passe concurrent
// jusqu'à la fin du rattachement, qu'il supprime ensuite ; passé avant, il change la version et on ne rattache pas.
// Sans lui, un unlock lancé juste avant un changement recréait le rattachement après la purge.
async function attachShareAccess(app: FastifyInstance, treeId: string, userId: string, accessVersion: number): Promise<boolean> {
  return app.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ updatedAt: Date }>>`
      SELECT "updatedAt" FROM tree_access_passwords WHERE "treeId" = ${treeId} FOR SHARE`
    if (rows.length === 0 || rows[0].updatedAt.getTime() !== accessVersion) {
      return false
    }

    const now = new Date()
    const role = 'contributor' as const
    await tx.userTreeAccess.upsert({
      where: { treeId_userId: { treeId, userId } },
      create: { treeId, userId, role },
      update: { role, updatedAt: now },
    })
    await tx.user.update({
      where: { id: userId },
      data: {
        lastOpenedTreeId: treeId,
        lastOpenedAccessMode: 'share',
        lastOpenedRole: role,
        lastOpenedAt: now,
      },
    })
    return true
  })
}

async function getMembership(app: FastifyInstance, userId: string, treeId: string) {
  return app.prisma.treeMembership.findUnique({
    where: {
      treeId_userId: {
        treeId,
        userId,
      },
    },
  })
}

function toDateOrNull(value?: string | null): Date | null {
  if (!value) {
    return null
  }

  return new Date(`${value}T00:00:00.000Z`)
}

function toTrimmedStringOrNull(value?: string | null): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isValidSlug(value: string): boolean {
  return /^[a-z0-9-]{3,64}$/.test(value)
}

async function getAdminMembership(app: FastifyInstance, userId: string, treeId: string) {
  const membership = await app.prisma.treeMembership.findUnique({
    where: {
      treeId_userId: {
        treeId,
        userId,
      },
    },
    include: {
      tree: {
        select: {
          deletedAt: true,
        },
      },
    },
  })

  return membership
}

function hasActiveAdminMembership(
  membership:
    | Prisma.TreeMembershipGetPayload<{
        include: {
          tree: {
            select: {
              deletedAt: true
            }
          }
        }
      }>
    | null,
): boolean {
  return Boolean(membership && !membership.tree.deletedAt && hasAdminRight(membership.role))
}

export const treeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/trees', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const [memberships, sharedAccesses, userState] = await Promise.all([
      app.prisma.treeMembership.findMany({
        where: {
          userId: user.userId,
          tree: {
            deletedAt: null,
          },
        },
        include: {
          tree: {
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
              rootPersonId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
      app.prisma.userTreeAccess.findMany({
        where: {
          userId: user.userId,
          tree: {
            deletedAt: null,
          },
        },
        include: {
          tree: {
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
              rootPersonId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
      }),
      app.prisma.user.findUnique({
        where: {
          id: user.userId,
        },
        select: {
          lastOpenedTreeId: true,
          lastOpenedAccessMode: true,
          lastOpenedRole: true,
          lastOpenedAt: true,
        },
      }),
    ])

    const membershipTreeIds = new Set(memberships.map((membership: { treeId: string }) => membership.treeId))
    const mergedTrees: Array<{
      id: string
      slug: string
      name: string
      description: string | null
      rootPersonId: string | null
      createdAt: Date
      updatedAt: Date
      role: string
      accessMode: 'member' | 'share'
      lastAccessedAt: Date | null
    }> = []

    for (const membership of memberships) {
      mergedTrees.push({
        ...membership.tree,
        role: membership.role,
        accessMode: 'member',
        lastAccessedAt: null,
      })
    }

    for (const shared of sharedAccesses) {
      if (membershipTreeIds.has(shared.treeId)) {
        continue
      }

      mergedTrees.push({
        ...shared.tree,
        role: shared.role,
        accessMode: 'share',
        lastAccessedAt: shared.updatedAt,
      })
    }

    mergedTrees.sort((left, right) => {
      const leftTime = left.lastAccessedAt?.getTime() ?? left.updatedAt.getTime()
      const rightTime = right.lastAccessedAt?.getTime() ?? right.updatedAt.getTime()
      return rightTime - leftTime
    })

    const lastOpenedTree = userState?.lastOpenedTreeId
      ? mergedTrees.find((tree) => {
          if (tree.id !== userState.lastOpenedTreeId) return false
          if (!userState.lastOpenedAccessMode) return true
          return tree.accessMode === userState.lastOpenedAccessMode
        })
      : null

    return reply.send({
      trees: mergedTrees,
      lastOpenedTree: lastOpenedTree
        ? {
            treeId: lastOpenedTree.id,
            accessMode: lastOpenedTree.accessMode,
            role: userState?.lastOpenedRole || lastOpenedTree.role,
            lastOpenedAt: userState?.lastOpenedAt || lastOpenedTree.lastAccessedAt || null,
          }
        : null,
    })
  })

  app.post('/trees', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const parsed = createTreeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
    }

    // Le quota disque est par arbre : sans plafond d'arbres, un compte multipliait sa place sans limite
    const ownedTrees = await app.prisma.treeMembership.count({
      where: { userId: user.userId, role: 'owner', tree: { deletedAt: null } },
    })
    if (ownedTrees >= MAX_TREES_PER_ACCOUNT) {
      return reply.code(403).send({ error: 'tree_limit_reached' })
    }

    const normalizedSlug = normalizeSlug(parsed.data.slug)
    if (!isValidSlug(normalizedSlug)) {
      return reply.code(400).send({
        error: 'invalid_payload',
        details: {
          formErrors: [],
          fieldErrors: {
            slug: ['Slug invalide apres normalisation. Utiliser 3-64 caracteres alphanumeriques ou tirets.'],
          },
        },
      })
    }

    const visitorHash = await hashPassword(parsed.data.visitorPassword)
    const contributorHash = await hashPassword(parsed.data.contributorPassword)

    try {
      const tree = await app.prisma.tree.create({
        data: {
          ownerUserId: user.userId,
          name: parsed.data.name,
          slug: normalizedSlug,
          description: parsed.data.description ?? null,
          accessPasswords: {
            create: {
              visitorHash,
              contributorHash,
            },
          },
          ...(parsed.data.visitorPassword === parsed.data.contributorPassword
            ? { sharePassword: { create: { passwordEnc: encryptSharePassword(parsed.data.visitorPassword) } } }
            : {}),
          memberships: {
            create: {
              userId: user.userId,
              role: 'owner',
            },
          },
          settings: {
            create: {
              memberContributionPolicy: 'pending',
              visitorPolicy: 'read_only',
              contributorPolicy: 'pending',
            },
          },
        },
      })

      await app.prisma.user.update({
        where: {
          id: user.userId,
        },
        data: {
          lastOpenedTreeId: tree.id,
          lastOpenedAccessMode: 'member',
          lastOpenedRole: 'owner',
          lastOpenedAt: new Date(),
        },
      })

      return reply.code(201).send({ tree })
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
        return reply.code(409).send({ error: 'slug_already_exists' })
      }

      throw error
    }
  })

  app.get('/trees/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const membership = await getMembership(app, user.userId, params.data.id)
    if (!membership) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const tree = await app.prisma.tree.findFirst({
      where: {
        id: params.data.id,
        deletedAt: null,
      },
      include: {
        settings: true,
      },
    })

    if (!tree) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    return reply.send({
      tree,
      role: membership.role,
    })
  })

  app.patch('/trees/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = patchTreeSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getMembership(app, user.userId, params.data.id)
    if (!membership || !hasAdminRight(membership.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    try {
      const updateData: {
        name?: string
        slug?: string
        description?: string | null
        rootPersonId?: string | null
      } = {}

      if (payload.data.name !== undefined) {
        updateData.name = payload.data.name
      }

      if (payload.data.slug !== undefined) {
        const normalizedSlug = normalizeSlug(payload.data.slug)
        if (!isValidSlug(normalizedSlug)) {
          return reply.code(400).send({
            error: 'invalid_payload',
            details: {
              formErrors: [],
              fieldErrors: {
                slug: ['Slug invalide apres normalisation. Utiliser 3-64 caracteres alphanumeriques ou tirets.'],
              },
            },
          })
        }

        updateData.slug = normalizedSlug
      }

      if (payload.data.description !== undefined) {
        updateData.description = payload.data.description
      }

      if (payload.data.rootPersonId !== undefined) {
        if (payload.data.rootPersonId === null) {
          updateData.rootPersonId = null
        } else {
          const rootPerson = await app.prisma.person.findFirst({
            where: {
              id: payload.data.rootPersonId,
              treeId: params.data.id,
              deletedAt: null,
            },
            select: {
              id: true,
            },
          })

          if (!rootPerson) {
            return reply.code(400).send({ error: 'invalid_root_person_id' })
          }

          updateData.rootPersonId = payload.data.rootPersonId
        }
      }

      const changedFields = Object.keys(updateData)
      const updateResult = await app.prisma.tree.updateMany({
        where: {
          id: params.data.id,
          deletedAt: null,
        },
        data: updateData,
      })

      if (updateResult.count === 0) {
        return reply.code(404).send({ error: 'tree_not_found' })
      }

      const updated = await app.prisma.tree.findUnique({
        where: { id: params.data.id },
      })

      await app.prisma.auditLog.create({
        data: {
          treeId: params.data.id,
          actorType: 'user',
          actorId: user.userId,
          action: 'tree_updated',
          entityType: 'tree',
          entityId: params.data.id,
          payloadJson: {
            changedFields,
          },
        },
      })

      return reply.send({ tree: updated })
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
        return reply.code(409).send({ error: 'slug_already_exists' })
      }

      throw error
    }
  })

  app.delete('/trees/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const membership = await getMembership(app, user.userId, params.data.id)
    if (!membership || membership.role !== 'owner') {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const existingTree = await app.prisma.tree.findFirst({
      where: {
        id: params.data.id,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    })

    if (!existingTree) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    // Suppression définitive : données en cascade (journal d'audit compris) puis dossier médias.
    await purgeTrees(app.prisma, [existingTree.id], request.log)

    return reply.send({ ok: true })
  })

  app.post(
    '/trees/:id/access/unlock',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const params = treeIdParamSchema.safeParse(request.params)
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid_tree_id' })
      }

      const payload = unlockSchema.safeParse(request.body)
      if (!payload.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
      }

      const accessConfig = await app.prisma.treeAccessPasswords.findUnique({
        where: {
          treeId: params.data.id,
        },
        include: {
          tree: {
            select: {
              deletedAt: true,
            },
          },
        },
      })

      if (!accessConfig || accessConfig.tree.deletedAt) {
        return reply.code(404).send({ error: 'tree_not_found' })
      }

      const releaseAttempt = reserveTreeUnlockAttempt(params.data.id)
      if (!releaseAttempt) {
        return reply.code(429).send({ error: 'too_many_attempts' })
      }

      // Un seul mot de passe de partage (25/09/2026) : regarder et proposer. Les deux colonnes restent,
      // les arbres créés avant ont encore deux mots de passe différents, les deux ouvrent en contributeur.
      // Apostrophe typographique ou espace finale ajoutées par un clavier de téléphone : acceptées (password-variants.ts)
      const check = serializePasswordCheck(() => matchSharePassword(
        payload.data.password,
        [accessConfig.contributorHash, accessConfig.visitorHash],
        verifyPassword,
      ))
      if (!check) {
        releaseAttempt()
        return reply.code(429).send({ error: 'too_many_attempts' })
      }
      const matches = await check

      if (!matches) {
        return reply.code(401).send({ error: 'invalid_password' })
      }
      releaseAttempt()

      const role = 'contributor' as const

      const token = app.jwt.sign(
        {
          kind: 'tree_access',
          sub: `tree:${params.data.id}:${role}`,
          treeId: params.data.id,
          role,
          accessVersion: accessConfig.updatedAt.getTime(),
        },
        {
          expiresIn: env.JWT_TREE_ACCESS_EXPIRES_IN,
        },
      )

      if (request.actor && request.actor.kind === 'user') {
        const attached = await attachShareAccess(app, params.data.id, request.actor.userId, accessConfig.updatedAt.getTime())
        if (!attached) {
          return reply.code(409).send({ error: 'access_changed' })
        }
      }

      return reply.send({
        token,
        treeId: params.data.id,
        role,
      })
    },
  )

  // Rattache au compte connecté un accès partagé déjà ouvert : le jeton d'arbre (obtenu par mot de passe)
  // tient lieu de preuve, on ne redemande pas le mot de passe. Même effet que l'unlock avec un compte.
  app.post('/trees/:id/access/link', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = linkAccessSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    let accessPayload: { kind?: string; treeId?: string; role?: string; accessVersion?: number }
    try {
      accessPayload = app.jwt.verify(payload.data.accessToken)
    } catch {
      return reply.code(401).send({ error: 'invalid_access_token' })
    }

    // Un jeton « visitor » d'avant le mot de passe unique vaut désormais contributeur
    const role = accessPayload.role === 'contributor' || accessPayload.role === 'visitor' ? ('contributor' as const) : null
    if (accessPayload.kind !== 'tree_access' || accessPayload.treeId !== params.data.id || !role) {
      return reply.code(401).send({ error: 'invalid_access_token' })
    }

    const accessConfig = await app.prisma.treeAccessPasswords.findUnique({
      where: {
        treeId: params.data.id,
      },
      include: {
        tree: {
          select: {
            deletedAt: true,
          },
        },
      },
    })

    if (!accessConfig || accessConfig.tree.deletedAt) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    if (accessConfig.updatedAt.getTime() !== accessPayload.accessVersion) {
      return reply.code(401).send({ error: 'invalid_access_token' })
    }

    const attached = await attachShareAccess(app, params.data.id, user.userId, accessPayload.accessVersion)
    if (!attached) {
      return reply.code(401).send({ error: 'invalid_access_token' })
    }

    return reply.send({ treeId: params.data.id, role })
  })

  // Le mot de passe de partage en vigueur, pour le propriétaire (null si jamais retenu par le serveur)
  app.get('/trees/:id/access/passwords', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const membership = await getMembership(app, user.userId, params.data.id)
    if (!membership || !hasAdminRight(membership.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const stored = await app.prisma.treeSharePassword.findUnique({ where: { treeId: params.data.id } })
    return reply.send({ share: decryptSharePassword(stored?.passwordEnc) })
  })

  // Arbres d'avant : le propriétaire tape le mot de passe déjà donné, le serveur le vérifie et le retient
  // sans rien changer aux accès (les hash et leur updatedAt ne bougent pas).
  app.post('/trees/:id/access/passwords/remember', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = rememberPasswordSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getMembership(app, user.userId, params.data.id)
    if (!membership || !hasAdminRight(membership.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const accessConfig = await app.prisma.treeAccessPasswords.findUnique({ where: { treeId: params.data.id } })
    if (!accessConfig) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    // On garde la variante exacte qui correspond au hash, c'est elle que la famille doit recevoir
    const check = serializePasswordCheck(() => matchSharePassword(
      payload.data.password,
      [accessConfig.contributorHash, accessConfig.visitorHash],
      verifyPassword,
    ))
    if (!check) {
      return reply.code(429).send({ error: 'too_many_attempts' })
    }
    const password = await check
    if (!password) {
      return reply.code(422).send({ error: 'password_mismatch' })
    }

    const passwordEnc = encryptSharePassword(password)
    await app.prisma.treeSharePassword.upsert({
      where: { treeId: params.data.id },
      create: { treeId: params.data.id, passwordEnc },
      update: { passwordEnc, setAt: new Date() },
    })

    return reply.send({ share: password })
  })

  app.patch('/trees/:id/access/passwords', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = patchPasswordsSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getMembership(app, user.userId, params.data.id)
    if (!membership || !hasAdminRight(membership.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const existing = await app.prisma.treeAccessPasswords.findUnique({
      where: {
        treeId: params.data.id,
      },
    })

    if (!existing) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    const data: { visitorHash?: string; contributorHash?: string } = {}
    if (payload.data.password) {
      const shareHash = await hashPassword(payload.data.password)
      data.visitorHash = shareHash
      data.contributorHash = shareHash
    }

    if (payload.data.visitorPassword) {
      data.visitorHash = await hashPassword(payload.data.visitorPassword)
    }

    if (payload.data.contributorPassword) {
      data.contributorHash = await hashPassword(payload.data.contributorPassword)
    }

    // Une seule transaction : nouveau mot de passe, rattachements purgés et mot de passe lisible changent
    // ensemble (voir attachShareAccess pour l'unlock concurrent)
    await app.prisma.$transaction(async (tx) => {
      await tx.treeAccessPasswords.update({
        where: {
          treeId: params.data.id,
        },
        data,
      })

      // Changer le mot de passe met dehors ceux qui l'avaient : les jetons d'arbre tombent avec la version,
      // les comptes rattachés par ce mot de passe perdent aussi leur accès (ils le retapent s'ils ont le nouveau)
      if (Object.keys(data).length > 0) {
        await tx.userTreeAccess.deleteMany({ where: { treeId: params.data.id } })
      }

      // Le mot de passe lisible suit toujours celui en vigueur ; deux mots de passe distincts = plus de valeur unique
      if (payload.data.password) {
        const passwordEnc = encryptSharePassword(payload.data.password)
        await tx.treeSharePassword.upsert({
          where: { treeId: params.data.id },
          create: { treeId: params.data.id, passwordEnc },
          update: { passwordEnc, setAt: new Date() },
        })
      } else {
        await tx.treeSharePassword.deleteMany({ where: { treeId: params.data.id } })
      }
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'access_passwords_rotated',
        entityType: 'tree_access_passwords',
        entityId: params.data.id,
        payloadJson: {
          rotatedVisitorPassword: Boolean(payload.data.password || payload.data.visitorPassword),
          rotatedContributorPassword: Boolean(payload.data.password || payload.data.contributorPassword),
        },
      },
    })

    return reply.send({ ok: true })
  })

  app.get('/trees/:id/stats', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const [persons, unions, links, medias, pendingContributions, totalContributions] = await Promise.all([
      app.prisma.person.count({
        where: {
          treeId: params.data.id,
          deletedAt: null,
        },
      }),
      app.prisma.union.count({
        where: {
          treeId: params.data.id,
          deletedAt: null,
        },
      }),
      app.prisma.parentChildLink.count({
        where: {
          treeId: params.data.id,
          deletedAt: null,
        },
      }),
      app.prisma.mediaItem.count({
        where: {
          treeId: params.data.id,
          status: 'approved',
          deletedAt: null,
        },
      }),
      app.prisma.contributionSession.count({
        where: {
          treeId: params.data.id,
          status: 'pending',
        },
      }),
      app.prisma.contributionSession.count({
        where: {
          treeId: params.data.id,
        },
      }),
    ])

    return reply.send({
      stats: {
        persons,
        unions,
        filiations: links,
        medias,
        pendingContributions,
        totalContributions,
      },
    })
  })

  app.get('/trees/:id/settings', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const settings = await app.prisma.treeSettings.findUnique({
      where: {
        treeId: params.data.id,
      },
    })

    if (!settings) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    return reply.send({ settings })
  })

  app.patch('/trees/:id/settings', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = patchTreeSettingsSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const settings = await app.prisma.treeSettings.upsert({
      where: {
        treeId: params.data.id,
      },
      create: {
        treeId: params.data.id,
        memberContributionPolicy: payload.data.memberContributionPolicy ?? 'pending',
        visitorPolicy: 'read_only',
        contributorPolicy: payload.data.contributorPolicy ?? 'pending',
      },
      update: {
        memberContributionPolicy: payload.data.memberContributionPolicy,
        contributorPolicy: payload.data.contributorPolicy,
      },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'tree_settings_updated',
        entityType: 'tree_settings',
        entityId: params.data.id,
        payloadJson: payload.data,
      },
    })

    return reply.send({ settings })
  })

  app.get('/trees/:id/audit', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const query = listAuditQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', details: query.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const logs = await app.prisma.auditLog.findMany({
      where: {
        treeId: params.data.id,
        action: query.data.action,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: query.data.offset,
      take: query.data.limit + 1,
    })

    const hasMore = logs.length > query.data.limit
    const items = hasMore ? logs.slice(0, query.data.limit) : logs

    return reply.send({
      logs: items,
      nextOffset: hasMore ? query.data.offset + query.data.limit : null,
    })
  })

  app.post('/trees/:id/persons', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = createPersonSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!membership) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (!hasAdminRight(membership.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (membership.tree.deletedAt) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    const person = await app.prisma.person.create({
      data: {
        treeId: params.data.id,
        firstName: payload.data.firstName.trim(),
        lastName: payload.data.lastName.trim(),
        birthName: toTrimmedStringOrNull(payload.data.birthName),
        nickname: toTrimmedStringOrNull(payload.data.nickname),
        birthDate: toDateOrNull(payload.data.birthDate),
        deathDate: toDateOrNull(payload.data.deathDate),
        // Une date de décès dit déjà que la personne est décédée : le drapeau ne sert que sans date
        isDeceased: !payload.data.deathDate && Boolean(payload.data.isDeceased),
        birthPlace: toTrimmedStringOrNull(payload.data.birthPlace),
        deathPlace: toTrimmedStringOrNull(payload.data.deathPlace),
        profession: toTrimmedStringOrNull(payload.data.profession),
        region: toTrimmedStringOrNull(payload.data.region),
        nationality: toTrimmedStringOrNull(payload.data.nationality),
        sex: payload.data.sex ?? null,
        notes: payload.data.notes ?? null,
        createdBy: user.userId,
        updatedBy: user.userId,
      },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'person_created',
        entityType: 'person',
        entityId: person.id,
        payloadJson: {
          firstName: person.firstName,
          lastName: person.lastName,
        },
      },
    })

    return reply.code(201).send({ person })
  })

  app.patch('/trees/:id/persons/:personId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = personParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    const payload = patchPersonSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    // Au moins un nom : on regarde le résultat de la modification, pas seulement ce qu'elle envoie
    if (payload.data.firstName !== undefined || payload.data.lastName !== undefined) {
      const before = await app.prisma.person.findFirst({
        where: { id: params.data.personId, treeId: params.data.id, deletedAt: null },
        select: { firstName: true, lastName: true },
      })
      if (before && !hasAnyName(payload.data.firstName ?? before.firstName, payload.data.lastName ?? before.lastName)) {
        return reply.code(400).send({ error: 'invalid_payload', details: 'name_required' })
      }
    }

    const data: {
      firstName?: string
      lastName?: string
      birthName?: string | null
      nickname?: string | null
      birthDate?: Date | null
      deathDate?: Date | null
      isDeceased?: boolean
      birthPlace?: string | null
      deathPlace?: string | null
      profession?: string | null
      region?: string | null
      nationality?: string | null
      sex?: string | null
      notes?: string | null
      updatedBy?: string
    } = {}

    if (payload.data.firstName !== undefined) {
      data.firstName = payload.data.firstName.trim()
    }

    if (payload.data.lastName !== undefined) {
      data.lastName = payload.data.lastName.trim()
    }

    if (payload.data.birthName !== undefined) {
      data.birthName = toTrimmedStringOrNull(payload.data.birthName)
    }

    if (payload.data.nickname !== undefined) {
      data.nickname = toTrimmedStringOrNull(payload.data.nickname)
    }

    if (payload.data.birthDate !== undefined) {
      data.birthDate = toDateOrNull(payload.data.birthDate)
    }

    if (payload.data.deathDate !== undefined) {
      data.deathDate = toDateOrNull(payload.data.deathDate)
    }

    if (payload.data.isDeceased !== undefined) {
      data.isDeceased = payload.data.isDeceased
    }
    // Avec une date de décès, le drapeau « sans date » n'a plus lieu d'être
    if (data.deathDate) {
      data.isDeceased = false
    }

    if (payload.data.birthPlace !== undefined) {
      data.birthPlace = toTrimmedStringOrNull(payload.data.birthPlace)
    }

    if (payload.data.deathPlace !== undefined) {
      data.deathPlace = toTrimmedStringOrNull(payload.data.deathPlace)
    }

    if (payload.data.profession !== undefined) {
      data.profession = toTrimmedStringOrNull(payload.data.profession)
    }

    if (payload.data.region !== undefined) {
      data.region = toTrimmedStringOrNull(payload.data.region)
    }

    if (payload.data.nationality !== undefined) {
      data.nationality = toTrimmedStringOrNull(payload.data.nationality)
    }

    if (payload.data.sex !== undefined) {
      data.sex = payload.data.sex
    }

    if (payload.data.notes !== undefined) {
      data.notes = payload.data.notes
    }

    data.updatedBy = user.userId

    const datesChanged = data.birthDate !== undefined || data.deathDate !== undefined
    const current = datesChanged
      ? await app.prisma.person.findFirst({
        where: { id: params.data.personId, treeId: params.data.id, deletedAt: null },
        select: { birthDate: true, deathDate: true },
      })
      : null

    const updated = await app.prisma.person.updateMany({
      where: {
        id: params.data.personId,
        treeId: params.data.id,
        deletedAt: null,
      },
      data: { ...data, ...personPrecisionResets(current, data) },
    })

    if (updated.count === 0) {
      return reply.code(404).send({ error: 'person_not_found' })
    }

    const person = await app.prisma.person.findFirst({
      where: {
        id: params.data.personId,
        treeId: params.data.id,
        deletedAt: null,
      },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'person_updated',
        entityType: 'person',
        entityId: params.data.personId,
        payloadJson: {
          changedFields: Object.keys(payload.data),
        },
      },
    })

    return reply.send({ person })
  })

  app.delete('/trees/:id/persons/:personId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = personParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const deleted = await app.prisma.$transaction((tx) =>
      softDeletePersonCascade(tx, params.data.id, params.data.personId, user.userId),
    )

    if (!deleted) {
      return reply.code(404).send({ error: 'person_not_found' })
    }

    const storageRoot = path.resolve(env.MEDIA_STORAGE_PATH)
    await Promise.all(deleted.filePaths.map((filePath) => removeStoredFile(storageRoot, filePath)))

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'person_deleted',
        entityType: 'person',
        entityId: params.data.personId,
        payloadJson: {
          deletedUnions: deleted.unions,
          deletedLinks: deleted.links,
          deletedMedia: deleted.medias,
        },
      },
    })

    return reply.send({
      ok: true,
      cascaded: {
        unions: deleted.unions,
        links: deleted.links,
        medias: deleted.medias,
      },
    })
  })

  app.post('/trees/:id/unions', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = createUnionSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!membership) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (!hasAdminRight(membership.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (membership.tree.deletedAt) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    const [partner1, partner2] = await Promise.all([
      app.prisma.person.findFirst({
        where: {
          id: payload.data.partner1PersonId,
          treeId: params.data.id,
          deletedAt: null,
        },
        select: { id: true },
      }),
      payload.data.partner2PersonId
        ? app.prisma.person.findFirst({
            where: {
              id: payload.data.partner2PersonId,
              treeId: params.data.id,
              deletedAt: null,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])

    if (!partner1 || (payload.data.partner2PersonId && !partner2)) {
      return reply.code(400).send({ error: 'invalid_person_reference' })
    }

    const unionValidationError = await findUnionValidationError(
      app.prisma,
      params.data.id,
      payload.data.partner1PersonId,
      payload.data.partner2PersonId ?? null,
    )
    if (unionValidationError) {
      return reply.code(400).send({ error: unionValidationError })
    }

    const union = await app.prisma.union.create({
      data: {
        treeId: params.data.id,
        partner1PersonId: payload.data.partner1PersonId,
        partner2PersonId: payload.data.partner2PersonId ?? null,
        unionType: payload.data.unionType ?? null,
        startDate: toDateOrNull(payload.data.startDate),
        endDate: toDateOrNull(payload.data.endDate),
        displayOrder: payload.data.displayOrder ?? 1,
      },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'union_created',
        entityType: 'union',
        entityId: union.id,
        payloadJson: {
          partner1PersonId: union.partner1PersonId,
          partner2PersonId: union.partner2PersonId,
        },
      },
    })

    return reply.code(201).send({ union })
  })

  app.patch('/trees/:id/unions/:unionId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = unionParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    const payload = patchUnionSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const existingUnion = await app.prisma.union.findFirst({
      where: {
        id: params.data.unionId,
        treeId: params.data.id,
        deletedAt: null,
      },
      select: {
        partner1PersonId: true,
        partner2PersonId: true,
        startDate: true,
      },
    })

    if (!existingUnion) {
      return reply.code(404).send({ error: 'union_not_found' })
    }

    if (payload.data.partner1PersonId) {
      const partner1 = await app.prisma.person.findFirst({
        where: {
          id: payload.data.partner1PersonId,
          treeId: params.data.id,
          deletedAt: null,
        },
        select: { id: true },
      })

      if (!partner1) {
        return reply.code(400).send({ error: 'invalid_person_reference' })
      }
    }

    if (payload.data.partner2PersonId) {
      const partner2 = await app.prisma.person.findFirst({
        where: {
          id: payload.data.partner2PersonId,
          treeId: params.data.id,
          deletedAt: null,
        },
        select: { id: true },
      })

      if (!partner2) {
        return reply.code(400).send({ error: 'invalid_person_reference' })
      }
    }

    const hasPartner2Field = Object.prototype.hasOwnProperty.call(payload.data, 'partner2PersonId')
    const finalPartner1PersonId = payload.data.partner1PersonId ?? existingUnion.partner1PersonId
    const finalPartner2PersonId = hasPartner2Field ? payload.data.partner2PersonId ?? null : existingUnion.partner2PersonId
    const unionValidationError = await findUnionValidationError(
      app.prisma,
      params.data.id,
      finalPartner1PersonId,
      finalPartner2PersonId,
    )
    if (unionValidationError) {
      return reply.code(400).send({ error: unionValidationError })
    }

    const startDate = payload.data.startDate !== undefined ? toDateOrNull(payload.data.startDate) : undefined
    const updated = await app.prisma.union.updateMany({
      where: {
        id: params.data.unionId,
        treeId: params.data.id,
        deletedAt: null,
      },
      data: {
        ...unionPrecisionResets(existingUnion, { startDate }),
        partner1PersonId: payload.data.partner1PersonId,
        partner2PersonId: payload.data.partner2PersonId,
        unionType: payload.data.unionType,
        startDate,
        endDate: payload.data.endDate !== undefined ? toDateOrNull(payload.data.endDate) : undefined,
        displayOrder: payload.data.displayOrder,
      },
    })

    if (updated.count === 0) {
      return reply.code(404).send({ error: 'union_not_found' })
    }

    const union = await app.prisma.union.findFirst({
      where: {
        id: params.data.unionId,
        treeId: params.data.id,
        deletedAt: null,
      },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'union_updated',
        entityType: 'union',
        entityId: params.data.unionId,
        payloadJson: {
          changedFields: Object.keys(payload.data),
        },
      },
    })

    return reply.send({ union })
  })

  app.delete('/trees/:id/unions/:unionId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = unionParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const deletedUnion = await softDeleteUnionCascade(app.prisma, params.data.id, params.data.unionId)

    if (!deletedUnion) {
      return reply.code(404).send({ error: 'union_not_found' })
    }

    const deletedLinks = { count: deletedUnion.links }

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'union_deleted',
        entityType: 'union',
        entityId: params.data.unionId,
        payloadJson: {
          deletedLinks: deletedLinks.count,
        },
      },
    })

    return reply.send({
      ok: true,
      cascaded: {
        links: deletedLinks.count,
      },
    })
  })

  app.post('/trees/:id/links', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = createParentChildLinkSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!membership) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (!hasAdminRight(membership.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (membership.tree.deletedAt) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    const [parent, child, union] = await Promise.all([
      app.prisma.person.findFirst({
        where: {
          id: payload.data.parentPersonId,
          treeId: params.data.id,
          deletedAt: null,
        },
        select: { id: true },
      }),
      app.prisma.person.findFirst({
        where: {
          id: payload.data.childPersonId,
          treeId: params.data.id,
          deletedAt: null,
        },
        select: { id: true },
      }),
      payload.data.viaUnionId
        ? app.prisma.union.findFirst({
            where: {
              id: payload.data.viaUnionId,
              treeId: params.data.id,
              deletedAt: null,
            },
            select: {
              id: true,
              partner1PersonId: true,
              partner2PersonId: true,
            },
          })
        : Promise.resolve(null),
    ])

    if (!parent || !child) {
      return reply.code(400).send({ error: 'invalid_person_reference' })
    }

    if (payload.data.viaUnionId && !union) {
      return reply.code(400).send({ error: 'invalid_union_reference' })
    }

    const linkValidationError = await findParentChildValidationError(
      app.prisma,
      params.data.id,
      payload.data.parentPersonId,
      payload.data.childPersonId,
      {
        viaUnionId: payload.data.viaUnionId ?? null,
        resolvedViaUnion: union ?? null,
      },
    )
    if (linkValidationError) {
      return reply.code(400).send({ error: linkValidationError })
    }

    const link = await app.prisma.parentChildLink.create({
      data: {
        treeId: params.data.id,
        parentPersonId: payload.data.parentPersonId,
        childPersonId: payload.data.childPersonId,
        viaUnionId: payload.data.viaUnionId ?? null,
        parentageType: payload.data.parentageType ?? 'biologique',
        displayOrder: payload.data.displayOrder ?? await nextSiblingOrder(app.prisma, params.data.id, payload.data.parentPersonId),
      },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'parent_child_link_created',
        entityType: 'parent_child_link',
        entityId: link.id,
        payloadJson: {
          parentPersonId: link.parentPersonId,
          childPersonId: link.childPersonId,
          viaUnionId: link.viaUnionId,
        },
      },
    })

    return reply.code(201).send({ link })
  })

  app.patch('/trees/:id/links/:linkId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = linkParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    const payload = patchParentChildLinkSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const existingLink = await app.prisma.parentChildLink.findFirst({
      where: {
        id: params.data.linkId,
        treeId: params.data.id,
        deletedAt: null,
      },
      select: {
        parentPersonId: true,
        childPersonId: true,
        viaUnionId: true,
      },
    })
    if (!existingLink) {
      return reply.code(404).send({ error: 'link_not_found' })
    }

    if (payload.data.parentPersonId) {
      const parent = await app.prisma.person.findFirst({
        where: {
          id: payload.data.parentPersonId,
          treeId: params.data.id,
          deletedAt: null,
        },
        select: { id: true },
      })

      if (!parent) {
        return reply.code(400).send({ error: 'invalid_person_reference' })
      }
    }

    if (payload.data.childPersonId) {
      const child = await app.prisma.person.findFirst({
        where: {
          id: payload.data.childPersonId,
          treeId: params.data.id,
          deletedAt: null,
        },
        select: { id: true },
      })

      if (!child) {
        return reply.code(400).send({ error: 'invalid_person_reference' })
      }
    }

    let resolvedViaUnion: { id: string; partner1PersonId: string; partner2PersonId: string | null } | null = null
    if (payload.data.viaUnionId) {
      const union = await app.prisma.union.findFirst({
        where: {
          id: payload.data.viaUnionId,
          treeId: params.data.id,
          deletedAt: null,
        },
        select: {
          id: true,
          partner1PersonId: true,
          partner2PersonId: true,
        },
      })

      if (!union) {
        return reply.code(400).send({ error: 'invalid_union_reference' })
      }

      resolvedViaUnion = union
    }

    const hasViaUnionIdField = Object.prototype.hasOwnProperty.call(payload.data, 'viaUnionId')
    const finalParentPersonId = payload.data.parentPersonId ?? existingLink.parentPersonId
    const finalChildPersonId = payload.data.childPersonId ?? existingLink.childPersonId
    const finalViaUnionId = hasViaUnionIdField ? payload.data.viaUnionId ?? null : existingLink.viaUnionId
    const linkValidationError = await findParentChildValidationError(
      app.prisma,
      params.data.id,
      finalParentPersonId,
      finalChildPersonId,
      {
        excludeLinkId: params.data.linkId,
        viaUnionId: finalViaUnionId,
        resolvedViaUnion: finalViaUnionId ? resolvedViaUnion : null,
      },
    )
    if (linkValidationError) {
      return reply.code(400).send({ error: linkValidationError })
    }

    const updated = await app.prisma.parentChildLink.updateMany({
      where: {
        id: params.data.linkId,
        treeId: params.data.id,
        deletedAt: null,
      },
      data: {
        parentPersonId: payload.data.parentPersonId,
        childPersonId: payload.data.childPersonId,
        viaUnionId: payload.data.viaUnionId,
        parentageType: payload.data.parentageType,
        displayOrder: payload.data.displayOrder,
      },
    })

    if (updated.count === 0) {
      return reply.code(404).send({ error: 'link_not_found' })
    }

    const link = await app.prisma.parentChildLink.findFirst({
      where: {
        id: params.data.linkId,
        treeId: params.data.id,
        deletedAt: null,
      },
    })

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'parent_child_link_updated',
        entityType: 'parent_child_link',
        entityId: params.data.linkId,
        payloadJson: {
          changedFields: Object.keys(payload.data),
        },
      },
    })

    return reply.send({ link })
  })

  // Souvenirs rattachables : approuvés, d'une de ces personnes, dans cet arbre. La famille ne prend
  // que des souvenirs libres : elle ne détache pas un souvenir du moment d'un autre.
  const validLifeEventMedia = async (treeId: string, ownerIds: string[], mediaIds: string[] | undefined, onlyFree = false) => {
    if (!mediaIds?.length) return true
    const unique = [...new Set(mediaIds)]
    const count = await app.prisma.mediaItem.count({
      where: { id: { in: unique }, treeId, personId: { in: ownerIds }, status: 'approved', deletedAt: null, ...(onlyFree ? { lifeEventId: null } : {}) },
    })
    return count === unique.length
  }

  // Rattache exactement ces souvenirs au moment (et détache ceux qui ne sont plus dans la liste)
  const setLifeEventMedia = async (db: Prisma.TransactionClient, treeId: string, eventId: string, mediaIds: string[] | undefined) => {
    if (mediaIds === undefined) return
    const unique = [...new Set(mediaIds)]
    await db.mediaItem.updateMany({ where: { treeId, lifeEventId: eventId, id: { notIn: unique } }, data: { lifeEventId: null } })
    if (unique.length) await db.mediaItem.updateMany({ where: { treeId, id: { in: unique } }, data: { lifeEventId: eventId } })
  }

  app.post('/trees/:id/persons/:personId/life/events', async (request, reply) => {
    const actor = request.actor
    if (!actor) return reply.code(401).send({ error: 'authentication_required' })
    const params = personParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const payload = lifeEventPayloadSchema.safeParse(request.body ?? {})
    if (!payload.success) return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    const reserved = RESERVED_LIFE_EVENT_TYPES.has(payload.data.type)
    if (!reserved && payload.data.type === 'custom' && !payload.data.label?.trim() && !payload.data.description?.trim()) {
      return reply.code(400).send({ error: 'invalid_payload' })
    }

    // Administrateur : visible tout de suite. Famille : une contribution relue, sauf si l'arbre applique tout de suite
    const membership = actor.kind === 'user' ? await getAdminMembership(app, actor.userId, params.data.id) : null
    const isAdmin = hasActiveAdminMembership(membership)
    let contribution: Awaited<ReturnType<typeof resolveSubmissionContext>> | null = null
    if (!isAdmin) {
      // Les sources d'une naissance ou d'un mariage restent l'affaire de l'administrateur
      if (reserved) return reply.code(403).send({ error: 'forbidden' })
      try {
        contribution = await resolveSubmissionContext(app, actor, params.data.id)
      } catch (error) {
        if (error instanceof ContributionRouteError) return reply.code(error.statusCode).send({ error: error.code })
        throw error
      }
      if (contribution.autoStatus === 'pending') {
        const pendingCount = await app.prisma.contributionSession.count({ where: { treeId: params.data.id, status: 'pending' } })
        if (pendingCount >= 200) return reply.code(429).send({ error: 'too_many_pending_contributions' })
      }
    }

    const person = await app.prisma.person.findFirst({
      where: { id: params.data.personId, treeId: params.data.id, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })
    if (!person) return reply.code(404).send({ error: 'person_not_found' })

    // Naissance et décès : une seule ligne par personne ; mariage : une par union de cette personne
    let unionId: string | null = null
    let ownerIds = [person.id]
    if (reserved) {
      if (payload.data.type === 'marriage') {
        const union = payload.data.unionId
          ? await app.prisma.union.findFirst({
            where: { id: payload.data.unionId, treeId: params.data.id, deletedAt: null, OR: [{ partner1PersonId: person.id }, { partner2PersonId: person.id }] },
            select: { id: true, partner1PersonId: true, partner2PersonId: true },
          })
          : null
        if (!union) return reply.code(400).send({ error: 'invalid_union_reference' })
        unionId = union.id
        ownerIds = [union.partner1PersonId, union.partner2PersonId].filter((id): id is string => Boolean(id))
      }
      const existing = await app.prisma.lifeEvent.findFirst({
        where: { treeId: params.data.id, deletedAt: null, type: payload.data.type, ...(unionId ? { unionId } : { personId: person.id }) },
        select: { id: true },
      })
      if (existing) return reply.code(409).send({ error: 'event_exists', eventId: existing.id })
    }
    if (!(await validLifeEventMedia(params.data.id, ownerIds, payload.data.mediaIds, !isAdmin))) {
      return reply.code(400).send({ error: 'invalid_media_reference' })
    }

    const isPending = contribution?.autoStatus === 'pending'
    const title = payload.data.label?.trim() || payload.data.description?.trim() || payload.data.type
    // Session, moment, souvenirs et trace de la contribution : tout ou rien
    const event = await app.prisma.$transaction(async (tx) => {
      const session = contribution
        ? await tx.contributionSession.create({
          data: {
            treeId: params.data.id,
            submittedByUserId: contribution.submittedByUserId,
            submittedByLabel: payload.data.submittedByLabel?.trim() || contribution.submittedByLabel,
            mode: contribution.mode,
            status: contribution.autoStatus,
            title: `Moment pour ${person.firstName || person.lastName}`.slice(0, 120),
            reviewedAt: isPending ? undefined : new Date(),
            reviewedBy: isPending ? undefined : contribution.submittedByUserId,
          },
        })
        : null

      const event = await tx.lifeEvent.create({
        data: {
          treeId: params.data.id,
          personId: unionId ? null : person.id,
          unionId,
          type: payload.data.type,
          ...lifeEventData(payload.data, reserved),
          status: isPending ? 'pending' : 'approved',
          contributionSessionId: session?.id ?? null,
        },
      })
      await setLifeEventMedia(tx, params.data.id, event.id, payload.data.mediaIds)

      if (session) {
        await tx.contributionChange.create({
          data: {
            sessionId: session.id,
            entityType: 'life_event',
            entityId: event.id,
            action: 'create',
            afterJson: {
              personId: person.id, type: event.type, title, date: payload.data.date ?? null, dateEnd: payload.data.dateEnd ?? null,
              datePrecision: payload.data.datePrecision ?? null, place: event.place, notes: event.notes, sources: event.sources,
            },
            decision: isPending ? undefined : 'approved',
          },
        })
      }
      return event
    })
    return reply.code(201).send({ event: { id: event.id, status: event.status } })
  })

  app.patch('/trees/:id/life/events/:eventId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const params = lifeEventParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    const payload = lifeEventPatchSchema.safeParse(request.body ?? {})
    if (!payload.success) return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) return reply.code(403).send({ error: 'forbidden' })

    const existing = await app.prisma.lifeEvent.findFirst({
      where: { id: params.data.eventId, treeId: params.data.id, deletedAt: null, status: 'approved' },
      select: { personId: true, unionId: true, type: true },
    })
    if (!existing) return reply.code(404).send({ error: 'event_not_found' })

    // Souvenirs d'une ligne de mariage : ceux de l'un ou l'autre conjoint
    let ownerIds: string[] = existing.personId ? [existing.personId] : []
    if (existing.unionId) {
      const union = await app.prisma.union.findFirst({ where: { id: existing.unionId, treeId: params.data.id }, select: { partner1PersonId: true, partner2PersonId: true } })
      ownerIds = [union?.partner1PersonId, union?.partner2PersonId].filter((id): id is string => Boolean(id))
    }
    if (!(await validLifeEventMedia(params.data.id, ownerIds, payload.data.mediaIds))) {
      return reply.code(400).send({ error: 'invalid_media_reference' })
    }

    await app.prisma.$transaction(async (tx) => {
      await tx.lifeEvent.update({
        where: { id: params.data.eventId },
        data: lifeEventData(payload.data, RESERVED_LIFE_EVENT_TYPES.has(existing.type)),
      })
      await setLifeEventMedia(tx, params.data.id, params.data.eventId, payload.data.mediaIds)
    })
    return reply.send({ ok: true })
  })

  app.delete('/trees/:id/life/events/:eventId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const params = lifeEventParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) return reply.code(403).send({ error: 'forbidden' })

    const deletedCount = await app.prisma.$transaction(async (tx) => {
      const deleted = await tx.lifeEvent.updateMany({
        where: { id: params.data.eventId, treeId: params.data.id, deletedAt: null, personId: { not: null }, type: { notIn: [...RESERVED_LIFE_EVENT_TYPES] } },
        data: { deletedAt: new Date() },
      })
      // Les souvenirs restent dans la fiche, simplement détachés du moment
      if (deleted.count > 0) await tx.mediaItem.updateMany({ where: { treeId: params.data.id, lifeEventId: params.data.eventId }, data: { lifeEventId: null } })
      return deleted.count
    })
    if (deletedCount === 0) return reply.code(404).send({ error: 'event_not_found' })
    return reply.code(204).send()
  })

  app.put('/trees/:id/links/order', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    const payload = childrenOrderSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const childIds = payload.data.order.map((entry) => entry.childId)
    const linkIds = payload.data.order.flatMap((entry) => entry.linkIds)
    if (new Set(childIds).size !== childIds.length || new Set(linkIds).size !== linkIds.length) {
      return reply.code(400).send({ error: 'invalid_payload' })
    }

    const links = await app.prisma.parentChildLink.findMany({
      where: { id: { in: linkIds }, treeId: params.data.id, deletedAt: null },
      select: { id: true, parentPersonId: true, childPersonId: true, viaUnionId: true },
    })
    const linkById = new Map(links.map((link) => [link.id, link]))
    if (links.length !== linkIds.length) {
      return reply.code(404).send({ error: 'link_not_found' })
    }

    // Chaque lien appartient bien à son enfant, et les enfants partagent au moins un parent
    const parentSets: Set<string>[] = []
    for (const entry of payload.data.order) {
      const parents = new Set<string>()
      for (const linkId of entry.linkIds) {
        const link = linkById.get(linkId)
        if (!link || link.childPersonId !== entry.childId) {
          return reply.code(400).send({ error: 'invalid_link_reference' })
        }
        parents.add(link.parentPersonId)
      }
      parentSets.push(parents)
    }
    const hasSharedParent = [...parentSets[0]].some((parentId) => parentSets.every((parents) => parents.has(parentId)))
    if (!hasSharedParent) {
      return reply.code(400).send({ error: 'not_siblings' })
    }

    // L'arbre ne montre qu'un lien par enfant et par union : le lien vers l'autre parent de la même union
    // prend le même ordre, pour que les deux restent d'accord
    await app.prisma.$transaction(
      payload.data.order.map((entry, index) => {
        const unionIds = [...new Set(entry.linkIds.map((id) => linkById.get(id)?.viaUnionId).filter((id): id is string => Boolean(id)))]
        return app.prisma.parentChildLink.updateMany({
          where: {
            treeId: params.data.id,
            deletedAt: null,
            childPersonId: entry.childId,
            OR: [{ id: { in: entry.linkIds } }, ...(unionIds.length ? [{ viaUnionId: { in: unionIds } }] : [])],
          },
          data: { displayOrder: index + 1 },
        })
      }),
    )

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'children_reordered',
        entityType: 'parent_child_link',
        entityId: payload.data.order[0].linkIds[0],
        payloadJson: { childIds },
      },
    })

    return reply.send({ ok: true })
  })

  app.delete('/trees/:id/links/:linkId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) {
      return
    }

    const params = linkParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    const membership = await getAdminMembership(app, user.userId, params.data.id)
    if (!hasActiveAdminMembership(membership)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const deleted = await app.prisma.parentChildLink.updateMany({
      where: {
        id: params.data.linkId,
        treeId: params.data.id,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    })

    if (deleted.count === 0) {
      return reply.code(404).send({ error: 'link_not_found' })
    }

    await app.prisma.auditLog.create({
      data: {
        treeId: params.data.id,
        actorType: 'user',
        actorId: user.userId,
        action: 'parent_child_link_deleted',
        entityType: 'parent_child_link',
        entityId: params.data.linkId,
      },
    })

    return reply.send({ ok: true })
  })
}
