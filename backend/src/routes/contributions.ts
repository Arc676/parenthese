import path from 'node:path'

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { env, UPLOAD_BODY_LIMIT } from '../config/env.js'
import { sanitizeAnnotationContentForRead } from '../lib/annotation-content.js'
import { softDeletePersonCascade, softDeleteUnionCascade } from '../lib/entity-deletion.js'
import { removeStoredFile } from '../lib/media-files.js'
import { syncPersonMediaOrder } from '../lib/media-order.js'

import type { Actor, MembershipRole } from '../types/auth.js'
import { findParentChildValidationError, findUnionValidationError } from '../utils/relationship-guards.js'

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/

const treeIdParamSchema = z.object({
  id: z.string().min(1),
})

const sessionParamsSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
})

// Une fiche de personne ou une annotation tient en quelques Ko : sans plafond, un détenteur du mot de passe
// remplissait la base à 12 Mo par envoi
const MAX_CHANGE_JSON_CHARS = 64_000
const MAX_PENDING_SESSIONS_PER_TREE = 200
const boundedJson = z.unknown().optional().refine(
  (value) => value === undefined || JSON.stringify(value).length <= MAX_CHANGE_JSON_CHARS,
  { message: 'change_too_large' },
)

const contributionChangeSchema = z.object({
  entityType: z.enum(['person', 'union', 'parent_child_link', 'annotation', 'media']),
  action: z.enum(['create', 'update', 'delete', 'reorder']),
  entityId: z.string().min(1).optional().nullable(),
  before: boundedJson,
  after: boundedJson,
  conflictState: z.enum(['none', 'needs_review']).optional(),
})

const createSessionSchema = z.object({
  title: z.string().min(2).max(120),
  submittedByLabel: z.string().trim().min(1).max(120).optional(),
  comment: z.string().trim().max(500).optional().nullable(),
  // Une famille propose quelques personnes à la fois ; au-delà, c'est un envoi en boucle
  changes: z.array(contributionChangeSchema).min(1).max(200),
})

const listSessionsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
})

const reviewSessionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  changeDecisions: z
    .array(
      z.object({
        changeId: z.string().min(1),
        decision: z.enum(['approved', 'rejected']),
      }),
    )
    .optional(),
})

const personCreateSchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  birthName: z.string().max(120).optional().nullable(),
  birthDate: z.string().regex(isoDateRegex).optional().nullable(),
  deathDate: z.string().regex(isoDateRegex).optional().nullable(),
  birthPlace: z.string().max(200).optional().nullable(),
  profession: z.string().max(200).optional().nullable(),
  region: z.string().max(120).optional().nullable(),
  nationality: z.string().max(120).optional().nullable(),
  sex: z.string().max(20).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

const personUpdateSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    birthName: z.string().max(120).optional().nullable(),
    birthDate: z.string().regex(isoDateRegex).optional().nullable(),
    deathDate: z.string().regex(isoDateRegex).optional().nullable(),
    birthPlace: z.string().max(200).optional().nullable(),
    profession: z.string().max(200).optional().nullable(),
    region: z.string().max(120).optional().nullable(),
    nationality: z.string().max(120).optional().nullable(),
    sex: z.string().max(20).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_person_field_required',
  })

const unionCreateSchema = z.object({
  partner1PersonId: z.string().min(1),
  partner2PersonId: z.string().min(1).optional().nullable(),
  unionType: z.string().max(50).optional().nullable(),
  startDate: z.string().regex(isoDateRegex).optional().nullable(),
  endDate: z.string().regex(isoDateRegex).optional().nullable(),
  displayOrder: z.number().int().positive().optional(),
})

const unionUpdateSchema = z
  .object({
    partner1PersonId: z.string().min(1).optional(),
    partner2PersonId: z.string().min(1).optional().nullable(),
    unionType: z.string().max(50).optional().nullable(),
    startDate: z.string().regex(isoDateRegex).optional().nullable(),
    endDate: z.string().regex(isoDateRegex).optional().nullable(),
    displayOrder: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_union_field_required',
  })

const linkCreateSchema = z.object({
  parentPersonId: z.string().min(1),
  childPersonId: z.string().min(1),
  viaUnionId: z.string().min(1).optional().nullable(),
  parentageType: z.string().max(50).optional().nullable(),
  displayOrder: z.number().int().positive().optional(),
})

const linkUpdateSchema = z
  .object({
    parentPersonId: z.string().min(1).optional(),
    childPersonId: z.string().min(1).optional(),
    viaUnionId: z.string().min(1).optional().nullable(),
    parentageType: z.string().max(50).optional().nullable(),
    displayOrder: z.number().int().positive().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at_least_one_link_field_required',
  })

const reorderSchema = z.object({
  displayOrder: z.number().int().positive(),
})

type ContributionStatus = 'pending' | 'approved' | 'rejected'

type ParsedChange = z.infer<typeof contributionChangeSchema>

type TxClient = Prisma.TransactionClient

// Identifiants provisoires : une personne ajoutée dans une contribution porte `ref: "tmp:…"`,
// ses liens (union, parent-enfant) y font référence ; remplacés par le vrai id à l'application.
type RefMap = Map<string, string>
const TEMP_REF_PREFIX = 'tmp:'
const REF_FIELDS = ['partner1PersonId', 'partner2PersonId', 'parentPersonId', 'childPersonId', 'viaUnionId'] as const

function resolveTempRefs(after: Record<string, unknown>, refs: RefMap): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...after }
  for (const field of REF_FIELDS) {
    const value = resolved[field]
    if (typeof value === 'string' && value.startsWith(TEMP_REF_PREFIX)) {
      const realId = refs.get(value)
      if (!realId) {
        throw new ContributionRouteError(400, 'unresolved_reference')
      }
      resolved[field] = realId
    }
  }
  return resolved
}

function recordTempRef(after: unknown, createdId: string, refs: RefMap) {
  if (isRecord(after) && typeof after.ref === 'string' && after.ref.startsWith(TEMP_REF_PREFIX)) {
    refs.set(after.ref, createdId)
  }
}

// Personnes d'abord, puis unions, puis liens : un lien vers une personne ajoutée s'applique après elle
const ENTITY_ORDER: Record<string, number> = { person: 0, union: 1, parent_child_link: 2, media: 3, annotation: 4 }
function byApplicationOrder<T extends { entityType: string; action: string }>(changes: T[]): T[] {
  const rank = (change: T) => (ENTITY_ORDER[change.entityType] ?? 9) * 10 + (change.action === 'create' ? 0 : 1)
  return changes.map((change, index) => ({ change, index }))
    .sort((a, b) => rank(a.change) - rank(b.change) || a.index - b.index)
    .map(({ change }) => change)
}

export class ContributionRouteError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string) {
    super(code)
    this.statusCode = statusCode
    this.code = code
  }
}

function hasAdminRight(role: MembershipRole): boolean {
  return role === 'owner' || role === 'admin'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

// Contenu d'annotation dans une proposition : même nettoyage qu'à la lecture des annotations
function stripAnnotationUrl<T>(value: T): T {
  if (!isRecord(value) || typeof value.content !== 'string') return value
  return { ...value, content: sanitizeAnnotationContentForRead(value.content) } as T
}

function toPrismaJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | Prisma.NullTypes.JsonNull | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return Prisma.JsonNull
  }

  return value as Prisma.InputJsonValue
}

async function assertTreeIsActive(tx: TxClient, treeId: string): Promise<void> {
  const tree = await tx.tree.findFirst({
    where: {
      id: treeId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  })

  if (!tree) {
    throw new ContributionRouteError(404, 'tree_not_found')
  }
}

async function assertPersonExists(tx: TxClient, treeId: string, personId: string): Promise<void> {
  const person = await tx.person.findFirst({
    where: {
      id: personId,
      treeId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  })

  if (!person) {
    throw new ContributionRouteError(400, 'invalid_person_reference')
  }
}

async function assertUnionExists(
  tx: TxClient,
  treeId: string,
  unionId: string,
): Promise<{ id: string; partner1PersonId: string; partner2PersonId: string | null }> {
  const union = await tx.union.findFirst({
    where: {
      id: unionId,
      treeId,
      deletedAt: null,
    },
    select: {
      id: true,
      partner1PersonId: true,
      partner2PersonId: true,
    },
  })

  if (!union) {
    throw new ContributionRouteError(400, 'invalid_union_reference')
  }

  return union
}

async function applyContributionChange(
  tx: TxClient,
  treeId: string,
  change: ParsedChange,
  actorUserId: string | null,
  refs: RefMap = new Map(),
  // Fichiers à effacer une fois la transaction validée (suppression d'une personne)
  filesToRemove: string[] = [],
): Promise<{ entityId: string | null }> {
  // Les annotations sont appliquées par le client après la relecture (batchAnnotations) :
  // rien à faire ici. Avant, elles tombaient dans la branche des liens et faisaient échouer la relecture.
  if (change.entityType === 'annotation') {
    return { entityId: change.entityId ?? null }
  }

  // Souvenir envoyé par la famille : le fichier existe déjà, on le rend visible
  if (change.entityType === 'media') {
    if (change.action !== 'create' || !change.entityId) {
      throw new ContributionRouteError(400, 'unsupported_change_action_for_media')
    }

    const media = await tx.mediaItem.findFirst({
      where: { id: change.entityId, treeId, deletedAt: null },
      select: { personId: true },
    })

    if (!media) {
      throw new ContributionRouteError(400, 'invalid_entity_reference')
    }

    await tx.mediaItem.update({
      where: { id: change.entityId },
      // placé après les souvenirs existants, puis renumérotation
      data: { status: 'approved', displayOrder: 1_000_000 },
    })
    await syncPersonMediaOrder(tx, treeId, media.personId)

    return { entityId: change.entityId }
  }

  if (change.entityType === 'person') {
    if (change.action === 'create') {
      if (!isRecord(change.after)) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      const parsed = personCreateSchema.safeParse(change.after)
      if (!parsed.success) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      const created = await tx.person.create({
        data: {
          treeId,
          firstName: parsed.data.firstName.trim(),
          lastName: parsed.data.lastName.trim(),
          birthName: toTrimmedStringOrNull(parsed.data.birthName),
          birthDate: toDateOrNull(parsed.data.birthDate),
          deathDate: toDateOrNull(parsed.data.deathDate),
          birthPlace: toTrimmedStringOrNull(parsed.data.birthPlace),
          profession: toTrimmedStringOrNull(parsed.data.profession),
          region: toTrimmedStringOrNull(parsed.data.region),
          nationality: toTrimmedStringOrNull(parsed.data.nationality),
          sex: parsed.data.sex ?? null,
          notes: parsed.data.notes ?? null,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        },
        select: {
          id: true,
        },
      })

      recordTempRef(change.after, created.id, refs)
      return { entityId: created.id }
    }

    if (!change.entityId) {
      throw new ContributionRouteError(400, 'missing_change_entity_id')
    }

    if (change.action === 'update') {
      if (!isRecord(change.after)) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      const parsed = personUpdateSchema.safeParse(change.after)
      if (!parsed.success) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      const result = await tx.person.updateMany({
        where: {
          id: change.entityId,
          treeId,
          deletedAt: null,
        },
        data: {
          firstName: parsed.data.firstName !== undefined ? parsed.data.firstName.trim() : undefined,
          lastName: parsed.data.lastName !== undefined ? parsed.data.lastName.trim() : undefined,
          birthName: parsed.data.birthName !== undefined ? toTrimmedStringOrNull(parsed.data.birthName) : undefined,
          birthDate: parsed.data.birthDate !== undefined ? toDateOrNull(parsed.data.birthDate) : undefined,
          deathDate: parsed.data.deathDate !== undefined ? toDateOrNull(parsed.data.deathDate) : undefined,
          birthPlace: parsed.data.birthPlace !== undefined ? toTrimmedStringOrNull(parsed.data.birthPlace) : undefined,
          profession: parsed.data.profession !== undefined ? toTrimmedStringOrNull(parsed.data.profession) : undefined,
          region: parsed.data.region !== undefined ? toTrimmedStringOrNull(parsed.data.region) : undefined,
          nationality: parsed.data.nationality !== undefined ? toTrimmedStringOrNull(parsed.data.nationality) : undefined,
          sex: parsed.data.sex,
          notes: parsed.data.notes,
          updatedBy: actorUserId,
        },
      })

      if (result.count === 0) {
        throw new ContributionRouteError(400, 'invalid_entity_reference')
      }

      return { entityId: change.entityId }
    }

    if (change.action === 'delete') {
      // Même cascade que la route du propriétaire : unions, liens, souvenirs et portrait partent avec la personne
      const deleted = await softDeletePersonCascade(tx, treeId, change.entityId, actorUserId)

      if (!deleted) {
        throw new ContributionRouteError(400, 'invalid_entity_reference')
      }

      filesToRemove.push(...deleted.filePaths)
      return { entityId: change.entityId }
    }

    throw new ContributionRouteError(400, 'unsupported_change_action_for_person')
  }

  if (change.entityType === 'union') {
    if (change.action === 'create') {
      if (!isRecord(change.after)) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      const parsed = unionCreateSchema.safeParse(resolveTempRefs(change.after, refs))
      if (!parsed.success) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      await assertPersonExists(tx, treeId, parsed.data.partner1PersonId)
      if (parsed.data.partner2PersonId) {
        await assertPersonExists(tx, treeId, parsed.data.partner2PersonId)
      }

      const unionValidationError = await findUnionValidationError(
        tx,
        treeId,
        parsed.data.partner1PersonId,
        parsed.data.partner2PersonId ?? null,
      )
      if (unionValidationError) {
        throw new ContributionRouteError(400, unionValidationError)
      }

      const created = await tx.union.create({
        data: {
          treeId,
          partner1PersonId: parsed.data.partner1PersonId,
          partner2PersonId: parsed.data.partner2PersonId ?? null,
          unionType: parsed.data.unionType ?? null,
          startDate: toDateOrNull(parsed.data.startDate),
          endDate: toDateOrNull(parsed.data.endDate),
          displayOrder: parsed.data.displayOrder ?? 1,
        },
        select: {
          id: true,
        },
      })

      recordTempRef(change.after, created.id, refs)
      return { entityId: created.id }
    }

    if (!change.entityId) {
      throw new ContributionRouteError(400, 'missing_change_entity_id')
    }

    if (change.action === 'update') {
      if (!isRecord(change.after)) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      const parsed = unionUpdateSchema.safeParse(change.after)
      if (!parsed.success) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      if (parsed.data.partner1PersonId) {
        await assertPersonExists(tx, treeId, parsed.data.partner1PersonId)
      }

      if (parsed.data.partner2PersonId) {
        await assertPersonExists(tx, treeId, parsed.data.partner2PersonId)
      }

      const existingUnion = await tx.union.findFirst({
        where: {
          id: change.entityId,
          treeId,
          deletedAt: null,
        },
        select: {
          partner1PersonId: true,
          partner2PersonId: true,
        },
      })
      if (!existingUnion) {
        throw new ContributionRouteError(400, 'invalid_entity_reference')
      }

      const hasPartner2Field = Object.prototype.hasOwnProperty.call(parsed.data, 'partner2PersonId')
      const finalPartner1PersonId = parsed.data.partner1PersonId ?? existingUnion.partner1PersonId
      const finalPartner2PersonId = hasPartner2Field ? parsed.data.partner2PersonId ?? null : existingUnion.partner2PersonId
      const unionValidationError = await findUnionValidationError(
        tx,
        treeId,
        finalPartner1PersonId,
        finalPartner2PersonId,
      )
      if (unionValidationError) {
        throw new ContributionRouteError(400, unionValidationError)
      }

      const result = await tx.union.updateMany({
        where: {
          id: change.entityId,
          treeId,
          deletedAt: null,
        },
        data: {
          partner1PersonId: parsed.data.partner1PersonId,
          partner2PersonId: parsed.data.partner2PersonId,
          unionType: parsed.data.unionType,
          startDate: parsed.data.startDate !== undefined ? toDateOrNull(parsed.data.startDate) : undefined,
          endDate: parsed.data.endDate !== undefined ? toDateOrNull(parsed.data.endDate) : undefined,
          displayOrder: parsed.data.displayOrder,
        },
      })

      if (result.count === 0) {
        throw new ContributionRouteError(400, 'invalid_entity_reference')
      }

      return { entityId: change.entityId }
    }

    if (change.action === 'delete') {
      // Les liens parent-enfant qui passaient par cette union partent avec elle (comme côté propriétaire)
      const deleted = await softDeleteUnionCascade(tx, treeId, change.entityId)

      if (!deleted) {
        throw new ContributionRouteError(400, 'invalid_entity_reference')
      }

      return { entityId: change.entityId }
    }

    if (change.action === 'reorder') {
      if (!isRecord(change.after)) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      const parsed = reorderSchema.safeParse(change.after)
      if (!parsed.success) {
        throw new ContributionRouteError(400, 'invalid_change_after')
      }

      const result = await tx.union.updateMany({
        where: {
          id: change.entityId,
          treeId,
          deletedAt: null,
        },
        data: {
          displayOrder: parsed.data.displayOrder,
        },
      })

      if (result.count === 0) {
        throw new ContributionRouteError(400, 'invalid_entity_reference')
      }

      return { entityId: change.entityId }
    }

    throw new ContributionRouteError(400, 'unsupported_change_action_for_union')
  }

  if (change.action === 'create') {
    if (!isRecord(change.after)) {
      throw new ContributionRouteError(400, 'invalid_change_after')
    }

    const parsed = linkCreateSchema.safeParse(resolveTempRefs(change.after, refs))
    if (!parsed.success) {
      throw new ContributionRouteError(400, 'invalid_change_after')
    }

    await Promise.all([
      assertPersonExists(tx, treeId, parsed.data.parentPersonId),
      assertPersonExists(tx, treeId, parsed.data.childPersonId),
    ])

    const resolvedViaUnion = parsed.data.viaUnionId ? await assertUnionExists(tx, treeId, parsed.data.viaUnionId) : null

    const linkValidationError = await findParentChildValidationError(
      tx,
      treeId,
      parsed.data.parentPersonId,
      parsed.data.childPersonId,
      {
        viaUnionId: parsed.data.viaUnionId ?? null,
        resolvedViaUnion,
      },
    )
    if (linkValidationError) {
      throw new ContributionRouteError(400, linkValidationError)
    }

    const created = await tx.parentChildLink.create({
      data: {
        treeId,
        parentPersonId: parsed.data.parentPersonId,
        childPersonId: parsed.data.childPersonId,
        viaUnionId: parsed.data.viaUnionId ?? null,
        parentageType: parsed.data.parentageType ?? 'biologique',
        displayOrder: parsed.data.displayOrder ?? 1,
      },
      select: {
        id: true,
      },
    })

    return { entityId: created.id }
  }

  if (!change.entityId) {
    throw new ContributionRouteError(400, 'missing_change_entity_id')
  }

  if (change.action === 'update') {
    if (!isRecord(change.after)) {
      throw new ContributionRouteError(400, 'invalid_change_after')
    }

    const parsed = linkUpdateSchema.safeParse(change.after)
    if (!parsed.success) {
      throw new ContributionRouteError(400, 'invalid_change_after')
    }

    if (parsed.data.parentPersonId) {
      await assertPersonExists(tx, treeId, parsed.data.parentPersonId)
    }

    if (parsed.data.childPersonId) {
      await assertPersonExists(tx, treeId, parsed.data.childPersonId)
    }

    let resolvedViaUnion: { id: string; partner1PersonId: string; partner2PersonId: string | null } | null = null
    if (parsed.data.viaUnionId) {
      resolvedViaUnion = await assertUnionExists(tx, treeId, parsed.data.viaUnionId)
    }

    const existingLink = await tx.parentChildLink.findFirst({
      where: {
        id: change.entityId,
        treeId,
        deletedAt: null,
      },
      select: {
        parentPersonId: true,
        childPersonId: true,
        viaUnionId: true,
      },
    })
    if (!existingLink) {
      throw new ContributionRouteError(400, 'invalid_entity_reference')
    }

    const hasViaUnionIdField = Object.prototype.hasOwnProperty.call(parsed.data, 'viaUnionId')
    const finalParentPersonId = parsed.data.parentPersonId ?? existingLink.parentPersonId
    const finalChildPersonId = parsed.data.childPersonId ?? existingLink.childPersonId
    const finalViaUnionId = hasViaUnionIdField ? parsed.data.viaUnionId ?? null : existingLink.viaUnionId
    const linkValidationError = await findParentChildValidationError(
      tx,
      treeId,
      finalParentPersonId,
      finalChildPersonId,
      {
        excludeLinkId: change.entityId,
        viaUnionId: finalViaUnionId,
        resolvedViaUnion: finalViaUnionId ? resolvedViaUnion : null,
      },
    )
    if (linkValidationError) {
      throw new ContributionRouteError(400, linkValidationError)
    }

    const result = await tx.parentChildLink.updateMany({
      where: {
        id: change.entityId,
        treeId,
        deletedAt: null,
      },
      data: {
        parentPersonId: parsed.data.parentPersonId,
        childPersonId: parsed.data.childPersonId,
        viaUnionId: parsed.data.viaUnionId,
        parentageType: parsed.data.parentageType,
        displayOrder: parsed.data.displayOrder,
      },
    })

    if (result.count === 0) {
      throw new ContributionRouteError(400, 'invalid_entity_reference')
    }

    return { entityId: change.entityId }
  }

  if (change.action === 'delete') {
    const result = await tx.parentChildLink.updateMany({
      where: {
        id: change.entityId,
        treeId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    })

    if (result.count === 0) {
      throw new ContributionRouteError(400, 'invalid_entity_reference')
    }

    return { entityId: change.entityId }
  }

  if (change.action === 'reorder') {
    if (!isRecord(change.after)) {
      throw new ContributionRouteError(400, 'invalid_change_after')
    }

    const parsed = reorderSchema.safeParse(change.after)
    if (!parsed.success) {
      throw new ContributionRouteError(400, 'invalid_change_after')
    }

    const result = await tx.parentChildLink.updateMany({
      where: {
        id: change.entityId,
        treeId,
        deletedAt: null,
      },
      data: {
        displayOrder: parsed.data.displayOrder,
      },
    })

    if (result.count === 0) {
      throw new ContributionRouteError(400, 'invalid_entity_reference')
    }

    return { entityId: change.entityId }
  }

  throw new ContributionRouteError(400, 'unsupported_change_action_for_link')
}

const SNAPSHOT_ENTITY_TYPES = new Set(['person', 'union', 'parent_child_link'])

// État actuel d'une personne, union ou lien, tel qu'on le montre à la relecture. null : introuvable dans l'arbre.
async function snapshotEntity(
  tx: TxClient,
  treeId: string,
  entityType: string,
  entityId: string,
): Promise<Record<string, unknown> | null> {
  if (entityType === 'person') {
    const current = await tx.person.findFirst({
      where: { id: entityId, treeId, deletedAt: null },
      select: {
        firstName: true,
        lastName: true,
        birthName: true,
        birthDate: true,
        deathDate: true,
        birthPlace: true,
        profession: true,
        region: true,
        nationality: true,
        sex: true,
        notes: true,
      },
    })
    if (!current) return null
    return {
      ...current,
      birthDate: current.birthDate?.toISOString().slice(0, 10) ?? null,
      deathDate: current.deathDate?.toISOString().slice(0, 10) ?? null,
    }
  }

  if (entityType === 'union') {
    const current = await tx.union.findFirst({
      where: { id: entityId, treeId, deletedAt: null },
      select: { partner1PersonId: true, partner2PersonId: true, unionType: true, startDate: true, endDate: true, displayOrder: true },
    })
    if (!current) return null
    return {
      ...current,
      startDate: current.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: current.endDate?.toISOString().slice(0, 10) ?? null,
    }
  }

  if (entityType === 'parent_child_link') {
    const current = await tx.parentChildLink.findFirst({
      where: { id: entityId, treeId, deletedAt: null },
      select: { parentPersonId: true, childPersonId: true, viaUnionId: true, parentageType: true, displayOrder: true },
    })
    return current ? { ...current } : null
  }

  return null
}

async function detectConflict(
  tx: TxClient,
  treeId: string,
  change: { entityType: string; action: string; entityId: string | null; beforeJson: unknown },
): Promise<boolean> {
  if (change.action !== 'update' || !change.entityId || !isRecord(change.beforeJson) || !SNAPSHOT_ENTITY_TYPES.has(change.entityType)) {
    return false
  }

  const before = change.beforeJson
  const snap = await snapshotEntity(tx, treeId, change.entityType, change.entityId)
  if (!snap) return true
  for (const key of Object.keys(before)) {
    if (key in snap && String(snap[key] ?? '') !== String(before[key] ?? '')) return true
  }
  return false
}

async function requireAdminMembership(app: FastifyInstance, actor: Actor, treeId: string) {
  if (!actor || actor.kind !== 'user') {
    throw new ContributionRouteError(401, 'authentication_required')
  }

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
        },
      },
    },
  })

  if (!membership || membership.tree.deletedAt || !hasAdminRight(membership.role)) {
    throw new ContributionRouteError(403, 'forbidden')
  }

  return membership
}

export async function resolveSubmissionContext(app: FastifyInstance, actor: Actor, treeId: string) {
  if (!actor) {
    throw new ContributionRouteError(401, 'authentication_required')
  }

  if (actor.kind === 'tree_access') {
    // Mot de passe unique : tout accès partagé peut proposer, y compris les jetons « visitor » d'avant
    if (actor.treeId !== treeId) {
      throw new ContributionRouteError(403, 'forbidden')
    }

    const tree = await app.prisma.tree.findFirst({
      where: {
        id: treeId,
        deletedAt: null,
      },
      select: {
        id: true,
        settings: {
          select: {
            contributorPolicy: true,
          },
        },
      },
    })

    if (!tree) {
      throw new ContributionRouteError(404, 'tree_not_found')
    }

    const policy = tree.settings?.contributorPolicy ?? 'pending'
    return {
      autoStatus: policy === 'direct' ? ('approved' as const) : ('pending' as const),
      mode: 'tree_access' as const,
      submittedByUserId: null,
      submittedByLabel: 'Contributeur',
      actorId: null,
      actorType: 'tree_access' as const,
    }
  }

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
          settings: {
            select: {
              memberContributionPolicy: true,
            },
          },
        },
      },
    },
  })

  if (membership && !membership.tree.deletedAt) {
    let autoStatus: ContributionStatus = 'pending'
    if (hasAdminRight(membership.role)) {
      autoStatus = 'approved'
    } else {
      const policy = membership.contributionModeOverride ?? membership.tree.settings?.memberContributionPolicy ?? 'pending'
      autoStatus = policy === 'direct' ? 'approved' : 'pending'
    }

    return {
      autoStatus,
      mode: 'user' as const,
      submittedByUserId: actor.userId,
      submittedByLabel: actor.email,
      actorId: actor.userId,
      actorType: 'user' as const,
    }
  }

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
          settings: {
            select: {
              contributorPolicy: true,
            },
          },
        },
      },
    },
  })

  if (!shared || shared.tree.deletedAt) {
    throw new ContributionRouteError(403, 'forbidden')
  }

  const policy = shared.tree.settings?.contributorPolicy ?? 'pending'

  return {
    autoStatus: policy === 'direct' ? ('approved' as const) : ('pending' as const),
    mode: 'tree_access' as const,
    submittedByUserId: actor.userId,
    submittedByLabel: actor.email,
    actorId: actor.userId,
    actorType: 'user' as const,
  }
}

export const contributionRoutes: FastifyPluginAsync = async (app) => {
  app.post('/trees/:id/contributions/sessions', { bodyLimit: UPLOAD_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const payload = createSessionSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    if (payload.data.changes.some((change) => change.entityType === 'media')) {
      return reply.code(400).send({ error: 'media_changes_not_allowed' })
    }

    try {
      const context = await resolveSubmissionContext(app, request.actor, params.data.id)
      const now = new Date()

      // Une famille n'a jamais des centaines de propositions en attente : au-delà, c'est un envoi en boucle
      if (context.autoStatus === 'pending') {
        const pendingCount = await app.prisma.contributionSession.count({
          where: { treeId: params.data.id, status: 'pending' },
        })
        if (pendingCount >= MAX_PENDING_SESSIONS_PER_TREE) {
          return reply.code(429).send({ error: 'too_many_pending_contributions' })
        }
      }

      const filesToRemove: string[] = []

      // Tout ou rien : une erreur au milieu n'applique rien
      const { session, createdChanges } = await app.prisma.$transaction(async (tx) => {
        const session = await tx.contributionSession.create({
          data: {
            treeId: params.data.id,
            submittedByUserId: context.submittedByUserId,
            submittedByLabel: payload.data.submittedByLabel?.trim() || context.submittedByLabel,
            comment: payload.data.comment?.trim() || null,
            mode: context.mode,
            status: context.autoStatus,
            title: payload.data.title.trim(),
            reviewedAt: context.autoStatus === 'approved' ? now : undefined,
            reviewedBy: context.autoStatus === 'approved' ? context.submittedByUserId : undefined,
          },
        })

        const refs: RefMap = new Map()
        const createdChanges = []

        for (const change of byApplicationOrder(payload.data.changes)) {
          let effectiveEntityId = change.entityId ?? null

          // L'« avant » montré au propriétaire vient de la base, jamais du contributeur : un « avant » inventé
          // faisait approuver « Suppression : Doublon Test » pour effacer en réalité la grand-mère.
          let before = change.before
          if ((change.action === 'update' || change.action === 'delete') && change.entityId && SNAPSHOT_ENTITY_TYPES.has(change.entityType)) {
            const snapshot = await snapshotEntity(tx, params.data.id, change.entityType, change.entityId)
            if (!snapshot) {
              throw new ContributionRouteError(400, 'invalid_entity_reference')
            }
            before = snapshot
          }

          if (context.autoStatus === 'approved') {
            const applied = await applyContributionChange(tx, params.data.id, change, context.submittedByUserId, refs, filesToRemove)
            effectiveEntityId = applied.entityId
          }

          const createdChange = await tx.contributionChange.create({
            data: {
              sessionId: session.id,
              entityType: change.entityType,
              entityId: effectiveEntityId,
              action: change.action,
              beforeJson: toPrismaJson(change.entityType === 'annotation' ? stripAnnotationUrl(before) : before),
              afterJson: toPrismaJson(change.entityType === 'annotation' ? stripAnnotationUrl(change.after) : change.after),
              conflictState: change.conflictState ?? 'none',
              decision: context.autoStatus === 'approved' ? 'approved' : undefined,
            },
          })

          createdChanges.push(createdChange)
        }

        await tx.auditLog.create({
          data: {
            treeId: params.data.id,
            actorType: context.actorType,
            actorId: context.actorId,
            action: 'contribution_session_submitted',
            entityType: 'contribution_session',
            entityId: session.id,
            payloadJson: {
              status: context.autoStatus,
              changesCount: createdChanges.length,
            },
          },
        })

        return { session, createdChanges }
      }, { timeout: 30_000 })

      const storageRoot = path.resolve(env.MEDIA_STORAGE_PATH)
      await Promise.all(filesToRemove.map((filePath) => removeStoredFile(storageRoot, filePath)))

      return reply.code(201).send({
        session,
        changesCount: createdChanges.length,
      })
    } catch (error) {
      if (error instanceof ContributionRouteError) {
        return reply.code(error.statusCode).send({ error: error.code })
      }

      throw error
    }
  })

  app.get('/trees/:id/contributions/sessions', async (request, reply) => {
    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const query = listSessionsQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', details: query.error.flatten() })
    }

    try {
      await requireAdminMembership(app, request.actor, params.data.id)

      const sessions = await app.prisma.contributionSession.findMany({
        where: {
          treeId: params.data.id,
          status: query.data.status ?? 'pending',
        },
        include: {
          changes: {
            select: {
              id: true,
              entityType: true,
              entityId: true,
              action: true,
              beforeJson: true,
              afterJson: true,
              conflictState: true,
              decision: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      })

      // Anciennes propositions d'annotation photo : leur `url` portait la session du contributeur
      const cleaned = sessions.map((session) => ({
        ...session,
        changes: session.changes.map((change) => change.entityType === 'annotation'
          ? { ...change, beforeJson: stripAnnotationUrl(change.beforeJson), afterJson: stripAnnotationUrl(change.afterJson) }
          : change),
      }))

      return reply.send({ sessions: cleaned })
    } catch (error) {
      if (error instanceof ContributionRouteError) {
        return reply.code(error.statusCode).send({ error: error.code })
      }

      throw error
    }
  })

  app.post('/trees/:id/contributions/sessions/:sessionId/review', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }

    const payload = reviewSessionSchema.safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: payload.error.flatten() })
    }

    try {
      const membership = await requireAdminMembership(app, request.actor, params.data.id)
      await assertTreeIsActive(app.prisma, params.data.id)

      const session = await app.prisma.contributionSession.findFirst({
        where: {
          id: params.data.sessionId,
          treeId: params.data.id,
        },
        include: {
          changes: true,
        },
      })

      if (!session) {
        throw new ContributionRouteError(404, 'contribution_session_not_found')
      }

      if (session.status !== 'pending') {
        throw new ContributionRouteError(409, 'contribution_session_already_reviewed')
      }

      const explicitDecisions = new Map<string, 'approved' | 'rejected'>()
      for (const changeDecision of payload.data.changeDecisions ?? []) {
        explicitDecisions.set(changeDecision.changeId, changeDecision.decision)
      }

      const rejectedMediaIds: string[] = []
      const filesToRemove: string[] = []
      const { updatedSession, approvedCount, rejectedCount, conflictCount, status } = await app.prisma.$transaction(async (tx) => {
        // Deux relectures simultanées : la seconde attend le verrou de la ligne, puis ne trouve plus
        // la session en attente. Sans ce verrou, les deux appliquaient les mêmes ajouts.
        const claimed = await tx.contributionSession.updateMany({
          where: { id: session.id, status: 'pending' },
          data: { reviewedBy: membership.userId },
        })
        if (claimed.count === 0) {
          throw new ContributionRouteError(409, 'contribution_session_already_reviewed')
        }

        let approvedCount = 0
        let rejectedCount = 0
        let conflictCount = 0
        const refs: RefMap = new Map()

        for (const change of byApplicationOrder(session.changes)) {
          let decision = explicitDecisions.get(change.id) ?? payload.data.decision

          const hasConflict = await detectConflict(tx, params.data.id, {
            entityType: change.entityType,
            action: change.action,
            entityId: change.entityId,
            beforeJson: change.beforeJson,
          })

          if (hasConflict && change.conflictState !== 'needs_review') {
            await tx.contributionChange.update({
              where: { id: change.id },
              data: { conflictState: 'needs_review' },
            })
            conflictCount += 1
          }

          if (decision === 'approved') {
            try {
              await applyContributionChange(
                tx,
                params.data.id,
                {
                  entityType: change.entityType,
                  action: change.action,
                  entityId: change.entityId,
                  before: change.beforeJson,
                  after: change.afterJson,
                  conflictState: change.conflictState,
                },
                membership.userId,
                refs,
                filesToRemove,
              )
              approvedCount += 1
            } catch (error) {
              // Lien vers une personne ajoutée mais refusée : le lien est écarté, pas la relecture
              if (error instanceof ContributionRouteError && error.code === 'unresolved_reference') {
                decision = 'rejected'
                rejectedCount += 1
              } else {
                throw error
              }
            }
          } else {
            if (change.entityType === 'media' && change.entityId) {
              await tx.mediaItem.updateMany({
                where: { id: change.entityId, treeId: params.data.id },
                data: { status: 'rejected', deletedAt: new Date() },
              })
              rejectedMediaIds.push(change.entityId)
            }
            rejectedCount += 1
          }

          await tx.contributionChange.update({
            where: {
              id: change.id,
            },
            data: {
              decision,
            },
          })
        }

        const status: ContributionStatus = approvedCount > 0 ? 'approved' : 'rejected'

        const updatedSession = await tx.contributionSession.update({
          where: {
            id: session.id,
          },
          data: {
            status,
            reviewedAt: new Date(),
            reviewedBy: membership.userId,
          },
        })

        await tx.auditLog.create({
          data: {
            treeId: params.data.id,
            actorType: 'user',
            actorId: membership.userId,
            action: 'contribution_session_reviewed',
            entityType: 'contribution_session',
            entityId: session.id,
            payloadJson: {
              approvedCount,
              rejectedCount,
              conflictCount,
              finalStatus: status,
            },
          },
        })

        return { updatedSession, approvedCount, rejectedCount, conflictCount, status }
      }, { timeout: 30_000 })

      // Photo refusée, ou souvenirs d'une personne supprimée = effacés du disque, une fois la relecture enregistrée
      const storageRoot = path.resolve(env.MEDIA_STORAGE_PATH)
      if (rejectedMediaIds.length > 0) {
        const rejected = await app.prisma.mediaItem.findMany({
          where: { id: { in: rejectedMediaIds }, treeId: params.data.id },
          select: { filePath: true },
        })
        await Promise.all(rejected.map((media) => removeStoredFile(storageRoot, media.filePath)))
      }
      await Promise.all(filesToRemove.map((filePath) => removeStoredFile(storageRoot, filePath)))

      return reply.send({
        session: updatedSession,
        approvedCount,
        rejectedCount,
        conflictCount,
      })
    } catch (error) {
      if (error instanceof ContributionRouteError) {
        return reply.code(error.statusCode).send({ error: error.code })
      }

      throw error
    }
  })
}
