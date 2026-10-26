import path from 'node:path'

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { Prisma } from '../generated/prisma/client.js'
import { z } from 'zod'
import { env, UPLOAD_BODY_LIMIT } from '../config/env.js'
import { sanitizeAnnotationContentForRead } from '../lib/annotation-content.js'
import { AnnotationChangeError, applyAnnotationChange, normalizedAnnotationAfter, releaseRejectedPhotos, validateAnnotationChange } from '../lib/annotation-changes.js'
import { softDeletePersonCascade, softDeleteUnionCascade } from '../lib/entity-deletion.js'
import { removeStoredFile } from '../lib/media-files.js'
import { canReadTree } from '../lib/tree-access.js'
import { syncPersonMediaOrder } from '../lib/media-order.js'
import { mediaPeopleSchema, normalizeMediaPeople, replaceMediaPeople } from '../lib/media-people.js'

import type { Actor, MembershipRole } from '../types/auth.js'
import { findParentChildValidationError, findUnionValidationError } from '../utils/relationship-guards.js'
import { nextSiblingOrder } from '../lib/sibling-order.js'
import { personPrecisionResets, unionPrecisionResets } from '../lib/date-precision.js'
import { hasAnyName } from '../lib/person-names.js'
import { sexOrNull, sexSchema } from '../lib/person-sex.js'

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
// Annotations proposées avant la 1.5.1 : écartées à la relecture si elles ne se posent pas
const SKIPPABLE_ANNOTATION_ERRORS = new Set(['invalid_annotation_change', 'invalid_annotation_photo_path', 'unsupported_change_action_for_annotation'])
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
  firstName: z.string().trim().max(120),
  lastName: z.string().trim().max(120),
  birthName: z.string().max(120).optional().nullable(),
  nickname: z.string().max(120).optional().nullable(),
  birthDate: z.string().regex(isoDateRegex).optional().nullable(),
  deathDate: z.string().regex(isoDateRegex).optional().nullable(),
  isDeceased: z.boolean().optional(),
  toVerify: z.boolean().optional(),
  birthPlace: z.string().max(200).optional().nullable(),
  deathPlace: z.string().max(200).optional().nullable(),
  profession: z.string().max(200).optional().nullable(),
  region: z.string().max(120).optional().nullable(),
  nationality: z.string().max(120).optional().nullable(),
  sex: sexSchema,
  notes: z.string().max(2000).optional().nullable(),
}).refine((value) => hasAnyName(value.firstName, value.lastName), { message: 'name_required', path: ['lastName'] })

const personUpdateSchema = z
  .object({
    firstName: z.string().trim().max(120).optional(),
    lastName: z.string().trim().max(120).optional(),
    birthName: z.string().max(120).optional().nullable(),
    nickname: z.string().max(120).optional().nullable(),
    birthDate: z.string().regex(isoDateRegex).optional().nullable(),
    deathDate: z.string().regex(isoDateRegex).optional().nullable(),
    isDeceased: z.boolean().optional(),
    toVerify: z.boolean().optional(),
    birthPlace: z.string().max(200).optional().nullable(),
  deathPlace: z.string().max(200).optional().nullable(),
    profession: z.string().max(200).optional().nullable(),
    region: z.string().max(120).optional().nullable(),
    nationality: z.string().max(120).optional().nullable(),
    sex: sexSchema,
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

// Les souvenirs, les moments et les personnes d'un souvenir arrivent par leurs propres routes, jamais par une
// session envoyée en bloc
type ParsedChange = Omit<z.infer<typeof contributionChangeSchema>, 'entityType'> & {
  entityType: z.infer<typeof contributionChangeSchema>['entityType'] | 'life_event' | 'media_people'
}

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
const ENTITY_ORDER: Record<string, number> = { person: 0, union: 1, parent_child_link: 2, media: 3, annotation: 4, media_people: 5 }
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
): Prisma.InputJsonValue | typeof Prisma.DbNull | typeof Prisma.JsonNull | undefined {
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
  // Annotation (dessin, texte, sticker, photo posée sur l'arbre) : posée ici, dans la transaction qui accepte
  // la proposition. Avant la 1.5.1, le navigateur du relecteur la posait après coup, et pouvait la perdre.
  if (change.entityType === 'annotation') {
    try {
      return await applyAnnotationChange(tx, treeId, { action: change.action, entityId: change.entityId, after: change.after }, actorUserId)
    } catch (error) {
      if (error instanceof AnnotationChangeError) throw new ContributionRouteError(400, error.code)
      throw error
    }
  }

  // Moment proposé par la famille : il existe déjà, on le rend visible
  if (change.entityType === 'life_event') {
    if (change.action !== 'create' || !change.entityId) {
      throw new ContributionRouteError(400, 'unsupported_change_action_for_life_event')
    }
    const updated = await tx.lifeEvent.updateMany({
      where: { id: change.entityId, treeId, deletedAt: null },
      data: { status: 'approved' },
    })
    if (updated.count === 0) {
      throw new ContributionRouteError(400, 'invalid_entity_reference')
    }
    return { entityId: change.entityId }
  }

  // Personnes identifiées sur un souvenir : la liste proposée remplace l'actuelle. Souvenir supprimé entre
  // l'envoi et la relecture : rien à faire, la relecture continue.
  if (change.entityType === 'media_people') {
    if (change.action !== 'update' || !change.entityId) {
      throw new ContributionRouteError(400, 'unsupported_change_action_for_media_people')
    }
    const people = mediaPeopleSchema.safeParse(isRecord(change.after) ? change.after.people : undefined)
    if (!people.success) {
      throw new ContributionRouteError(400, 'invalid_media_people')
    }
    const media = await tx.mediaItem.findFirst({
      where: { id: change.entityId, treeId, status: 'approved', deletedAt: null },
      select: { id: true },
    })
    if (media) {
      await replaceMediaPeople(tx, treeId, change.entityId, normalizeMediaPeople(people.data), actorUserId)
    }
    return { entityId: change.entityId }
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
          nickname: toTrimmedStringOrNull(parsed.data.nickname),
          birthDate: toDateOrNull(parsed.data.birthDate),
          deathDate: toDateOrNull(parsed.data.deathDate),
          isDeceased: !parsed.data.deathDate && Boolean(parsed.data.isDeceased),
          toVerify: Boolean(parsed.data.toVerify),
          birthPlace: toTrimmedStringOrNull(parsed.data.birthPlace),
          deathPlace: toTrimmedStringOrNull(parsed.data.deathPlace),
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

      const nextDates = {
        birthDate: parsed.data.birthDate !== undefined ? toDateOrNull(parsed.data.birthDate) : undefined,
        deathDate: parsed.data.deathDate !== undefined ? toDateOrNull(parsed.data.deathDate) : undefined,
      }
      const currentDates = nextDates.birthDate !== undefined || nextDates.deathDate !== undefined
        ? await tx.person.findFirst({
          where: { id: change.entityId, treeId, deletedAt: null },
          select: { birthDate: true, deathDate: true },
        })
        : null

      if (parsed.data.firstName !== undefined || parsed.data.lastName !== undefined) {
        const before = await tx.person.findFirst({
          where: { id: change.entityId, treeId, deletedAt: null },
          select: { firstName: true, lastName: true },
        })
        if (before && !hasAnyName(parsed.data.firstName ?? before.firstName, parsed.data.lastName ?? before.lastName)) {
          throw new ContributionRouteError(400, 'invalid_change_after')
        }
      }

      const result = await tx.person.updateMany({
        where: {
          id: change.entityId,
          treeId,
          deletedAt: null,
        },
        data: {
          ...personPrecisionResets(currentDates, nextDates),
          firstName: parsed.data.firstName !== undefined ? parsed.data.firstName.trim() : undefined,
          lastName: parsed.data.lastName !== undefined ? parsed.data.lastName.trim() : undefined,
          birthName: parsed.data.birthName !== undefined ? toTrimmedStringOrNull(parsed.data.birthName) : undefined,
          nickname: parsed.data.nickname !== undefined ? toTrimmedStringOrNull(parsed.data.nickname) : undefined,
          birthDate: nextDates.birthDate,
          deathDate: nextDates.deathDate,
          isDeceased: nextDates.deathDate ? false : parsed.data.isDeceased,
          toVerify: parsed.data.toVerify,
          birthPlace: parsed.data.birthPlace !== undefined ? toTrimmedStringOrNull(parsed.data.birthPlace) : undefined,
          deathPlace: parsed.data.deathPlace !== undefined ? toTrimmedStringOrNull(parsed.data.deathPlace) : undefined,
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
          startDate: true,
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
          ...unionPrecisionResets(existingUnion, {
            startDate: parsed.data.startDate !== undefined ? toDateOrNull(parsed.data.startDate) : undefined,
          }),
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
        displayOrder: parsed.data.displayOrder ?? await nextSiblingOrder(tx, treeId, parsed.data.parentPersonId),
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
        nickname: true,
        birthDate: true,
        deathDate: true,
        isDeceased: true,
        toVerify: true,
        birthPlace: true,
        deathPlace: true,
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
      sex: sexOrNull(current.sex),
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
  // Personnes identifiées sur un souvenir. Administrateur : enregistré tout de suite. Famille (membre, lien
  // de partage) : une proposition, appliquée à la relecture, ou tout de suite si l'arbre l'autorise.
  app.put('/trees/:id/media/:mediaId/people', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1), mediaId: z.string().min(1) }).safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params' })
    }
    const payload = z.object({
      people: mediaPeopleSchema,
      submittedByLabel: z.string().trim().min(1).max(120).optional(),
    }).safeParse(request.body)
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload' })
    }
    const treeId = params.data.id
    const mediaId = params.data.mediaId

    try {
      const context = await resolveSubmissionContext(app, request.actor, treeId)
      const actor = request.actor
      const membership = actor?.kind === 'user'
        ? await app.prisma.treeMembership.findUnique({ where: { treeId_userId: { treeId, userId: actor.userId } }, select: { role: true } })
        : null
      const isAdmin = Boolean(membership && hasAdminRight(membership.role))

      const media = await app.prisma.mediaItem.findFirst({
        where: { id: mediaId, treeId, status: 'approved', deletedAt: null },
        select: { id: true, personId: true },
      })
      if (!media) {
        return reply.code(404).send({ error: 'media_not_found' })
      }

      const people = normalizeMediaPeople(payload.data.people)
      const known = people.length
        ? await app.prisma.person.count({ where: { treeId, id: { in: people.map((person) => person.personId) }, deletedAt: null } })
        : 0
      if (known !== people.length) {
        return reply.code(400).send({ error: 'invalid_person_reference' })
      }

      if (context.autoStatus === 'pending') {
        const pendingCount = await app.prisma.contributionSession.count({ where: { treeId, status: 'pending' } })
        if (pendingCount >= MAX_PENDING_SESSIONS_PER_TREE) {
          return reply.code(429).send({ error: 'too_many_pending_contributions' })
        }
      }

      const now = new Date()
      const saved = await app.prisma.$transaction(async (tx) => {
        const before = await tx.mediaPersonTag.findMany({
          where: { treeId, mediaId },
          select: { personId: true, x: true, y: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
        const applied = context.autoStatus === 'approved'
          ? await replaceMediaPeople(tx, treeId, mediaId, people, context.submittedByUserId)
          : null

        // L'administrateur n'a rien à relire : pas de session, comme pour ses propres souvenirs
        if (!isAdmin) {
          const session = await tx.contributionSession.create({
            data: {
              treeId,
              submittedByUserId: context.submittedByUserId,
              submittedByLabel: payload.data.submittedByLabel?.trim() || context.submittedByLabel,
              mode: context.mode,
              status: context.autoStatus,
              title: 'Personnes sur un souvenir',
              reviewedAt: context.autoStatus === 'approved' ? now : undefined,
              reviewedBy: context.autoStatus === 'approved' ? context.submittedByUserId : undefined,
            },
          })
          await tx.contributionChange.create({
            data: {
              sessionId: session.id,
              entityType: 'media_people',
              entityId: mediaId,
              action: 'update',
              beforeJson: toPrismaJson({ mediaId, ownerPersonId: media.personId, people: before }),
              afterJson: toPrismaJson({ mediaId, ownerPersonId: media.personId, people }),
              decision: context.autoStatus === 'approved' ? 'approved' : undefined,
            },
          })
        }

        await tx.auditLog.create({
          data: {
            treeId,
            actorType: context.actorType,
            actorId: context.actorId,
            action: 'media_people_updated',
            entityType: 'media_item',
            entityId: mediaId,
            payloadJson: { status: context.autoStatus, count: people.length },
          },
        })
        return applied
      })

      return reply.send({ status: context.autoStatus, people: saved ?? people })
    } catch (error) {
      if (error instanceof ContributionRouteError) {
        return reply.code(error.statusCode).send({ error: error.code })
      }
      throw error
    }
  })

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

    // Une annotation refusée à l'écriture le serait aussi à la relecture : on le dit tout de suite
    for (const change of payload.data.changes) {
      if (change.entityType !== 'annotation') continue
      try {
        validateAnnotationChange(change, params.data.id)
      } catch (error) {
        if (error instanceof AnnotationChangeError) return reply.code(400).send({ error: error.code })
        throw error
      }
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
              // Annotation : gardée nettoyée (photoPath canonique), pour être relue sans ambiguïté à la relecture
              afterJson: toPrismaJson(change.entityType === 'annotation' ? stripAnnotationUrl(normalizedAnnotationAfter(change, params.data.id)) : change.after),
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

  // État d'une proposition, pour la personne qui l'a envoyée : ses fantômes « en attente » s'effacent quand elle
  // est relue. Seulement le statut, à qui lit l'arbre et connaît l'identifiant (rendu à l'envoi).
  app.get('/trees/:id/contributions/sessions/:sessionId/status', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })
    if (!request.actor) return reply.code(401).send({ error: 'authentication_required' })
    if (!(await canReadTree(app, params.data.id, request.actor))) return reply.code(403).send({ error: 'forbidden' })
    const session = await app.prisma.contributionSession.findFirst({
      where: { id: params.data.sessionId, treeId: params.data.id },
      select: { status: true },
    })
    if (!session) return reply.code(404).send({ error: 'contribution_session_not_found' })
    return reply.send({ status: session.status })
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
        // Photos posées sur l'arbre par la famille : celles des annotations refusées sont libérées après toutes les
        // décisions. Une annotation acceptée dans cette même relecture a déjà retiré la ligne d'attente de sa photo,
        // qui n'est donc plus effacée (avant, la libération dans la boucle effaçait une photo acceptée plus loin).
        const rejectedAnnotationAfters: unknown[] = []

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
              // Lien vers une personne ajoutée mais refusée, ou annotation d'avant la 1.5.1 que le serveur ne
              // peut pas poser (contenu incomplet) : la proposition est écartée, pas la relecture
              if (error instanceof ContributionRouteError && (error.code === 'unresolved_reference' || SKIPPABLE_ANNOTATION_ERRORS.has(error.code))) {
                decision = 'rejected'
                rejectedCount += 1
                if (change.entityType === 'annotation') rejectedAnnotationAfters.push(change.afterJson)
              } else {
                throw error
              }
            }
          } else {
            if (change.entityType === 'life_event' && change.entityId) {
              await tx.lifeEvent.updateMany({
                where: { id: change.entityId, treeId: params.data.id },
                data: { status: 'rejected', deletedAt: new Date() },
              })
            }
            if (change.entityType === 'annotation') rejectedAnnotationAfters.push(change.afterJson)
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

        filesToRemove.push(...await releaseRejectedPhotos(tx, params.data.id, rejectedAnnotationAfters, session.id))

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
