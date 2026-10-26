import path from 'node:path'

import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { z } from 'zod'

import { InvalidAnnotationContentError, sanitizeAnnotationContentForWrite } from './annotation-content.js'

// Annotations proposées par la famille (dessin, texte, sticker, photo posée sur l'arbre). Avant la 1.5.1, le
// serveur les laissait au navigateur du relecteur, qui les posait après coup : une proposition acceptée pouvait
// ne jamais apparaître (onglet fermé, erreur réseau), et rien n'apparaissait en mode « direct ». Elles sont
// maintenant posées dans la transaction qui accepte la proposition.

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

export const MAX_ANNOTATIONS_PER_TREE = 5000
// Un envoi de photo jamais proposé vit le temps d'un brouillon de la famille
export const PENDING_PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Une famille pose quelques photos à la fois ; au-delà, c'est un envoi en boucle
export const MAX_PENDING_PHOTOS_PER_TREE = 50

const MAX_STYLE_CHARS = 4000
const styleSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= MAX_STYLE_CHARS,
  { message: 'style_too_large' },
)

const annotationCreateSchema = z.object({
  type: z.enum(['drawing', 'sticker', 'text', 'photo']),
  x: z.number().finite(),
  y: z.number().finite(),
  content: z.string().min(1).max(50000),
  style: styleSchema.optional(),
  zIndex: z.number().int().optional(),
})

const annotationUpdateSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  content: z.string().min(1).max(50000).optional(),
  style: styleSchema.optional(),
  zIndex: z.number().int().optional(),
})

export class AnnotationChangeError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

type AnnotationChange = { action: string; entityId?: string | null; after?: unknown }

// Contenu vérifié comme à l'écriture directe : une photo doit être une photo de cet arbre
function cleanContent(content: string, treeId: string): string {
  try {
    return sanitizeAnnotationContentForWrite(content, treeId)
  } catch (error) {
    if (error instanceof InvalidAnnotationContentError) throw new AnnotationChangeError('invalid_annotation_photo_path')
    throw error
  }
}

// Vérifie une proposition d'annotation dès l'envoi, pour qu'une relecture n'échoue pas sur un contenu refusé
export function validateAnnotationChange(change: AnnotationChange, treeId: string): void {
  if (change.action === 'create') {
    const parsed = annotationCreateSchema.safeParse(change.after)
    if (!parsed.success) throw new AnnotationChangeError('invalid_annotation_change')
    cleanContent(parsed.data.content, treeId)
    return
  }
  if (change.action === 'update') {
    if (!change.entityId) throw new AnnotationChangeError('invalid_annotation_change')
    const parsed = annotationUpdateSchema.safeParse(change.after)
    if (!parsed.success) throw new AnnotationChangeError('invalid_annotation_change')
    if (parsed.data.content !== undefined) cleanContent(parsed.data.content, treeId)
    return
  }
  if (change.action === 'delete') {
    if (!change.entityId) throw new AnnotationChangeError('invalid_annotation_change')
    return
  }
  throw new AnnotationChangeError('unsupported_change_action_for_annotation')
}

// L'« après » d'une proposition d'annotation tel qu'il est gardé : contenu nettoyé comme à l'écriture directe
// (photoPath canonique, sans adresse), pour qu'on le relise toujours de la même façon
export function normalizedAnnotationAfter(change: AnnotationChange, treeId: string): unknown {
  const after = change.after
  if (!after || typeof after !== 'object' || Array.isArray(after)) return after
  const content = (after as { content?: unknown }).content
  if (typeof content !== 'string') return after
  return { ...(after as Record<string, unknown>), content: cleanContent(content, treeId) }
}

// Identifiant de la photo d'une annotation (contenu JSON { photoPath }), ou null
export function annotationPhotoId(after: unknown, treeId: string): string | null {
  if (!after || typeof after !== 'object' || Array.isArray(after)) return null
  const content = (after as { content?: unknown }).content
  if (typeof content !== 'string' || !content.startsWith('{')) return null
  try {
    const parsed = JSON.parse(content) as { photoPath?: unknown }
    const prefix = `/trees/${treeId}/annotation-photos/`
    if (typeof parsed.photoPath !== 'string' || !parsed.photoPath.startsWith(prefix)) return null
    const photoId = parsed.photoPath.slice(prefix.length)
    return /^[A-Za-z0-9-]+$/.test(photoId) ? photoId : null
  } catch {
    return null
  }
}

// Pose une annotation acceptée. La photo d'une famille devient définitive : sa ligne d'attente disparaît.
export async function applyAnnotationChange(tx: Tx, treeId: string, change: AnnotationChange, actorUserId: string | null): Promise<{ entityId: string | null }> {
  validateAnnotationChange(change, treeId)

  if (change.action === 'create') {
    const data = annotationCreateSchema.parse(change.after)
    const count = await tx.annotation.count({ where: { treeId, deletedAt: null } })
    if (count + 1 > MAX_ANNOTATIONS_PER_TREE) throw new AnnotationChangeError('annotation_limit_reached')
    const created = await tx.annotation.create({
      data: {
        treeId,
        type: data.type,
        x: data.x,
        y: data.y,
        content: cleanContent(data.content, treeId),
        style: (data.style ?? {}) as Prisma.InputJsonValue,
        zIndex: data.zIndex ?? 0,
        createdBy: actorUserId,
      },
      select: { id: true },
    })
    const photoId = annotationPhotoId(change.after, treeId)
    if (photoId) await tx.annotationPhotoUpload.deleteMany({ where: { id: photoId, treeId } })
    return { entityId: created.id }
  }

  if (change.action === 'update') {
    const data = annotationUpdateSchema.parse(change.after)
    const patch: Prisma.AnnotationUpdateManyMutationInput = {}
    if (data.x !== undefined) patch.x = data.x
    if (data.y !== undefined) patch.y = data.y
    if (data.content !== undefined) patch.content = cleanContent(data.content, treeId)
    if (data.style !== undefined) patch.style = data.style as Prisma.InputJsonValue
    if (data.zIndex !== undefined) patch.zIndex = data.zIndex
    if (Object.keys(patch).length > 0) {
      await tx.annotation.updateMany({ where: { id: change.entityId as string, treeId, deletedAt: null }, data: patch })
    }
    const photoId = annotationPhotoId(change.after, treeId)
    if (photoId) await tx.annotationPhotoUpload.deleteMany({ where: { id: photoId, treeId } })
    return { entityId: change.entityId ?? null }
  }

  await tx.annotation.updateMany({
    where: { id: change.entityId as string, treeId, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  return { entityId: change.entityId ?? null }
}

// Photos citées par les propositions d'annotation encore en attente sur cet arbre (hors une session donnée).
// Lu dans le JSON décodé, pas dans son texte : un chemin échappé (\/trees\/…) reste reconnu. Un arbre a au plus
// quelques centaines de propositions en attente.
async function photosInPendingProposals(db: Db, treeId: string, excludeSessionId?: string): Promise<Set<string>> {
  const changes = await db.contributionChange.findMany({
    where: {
      entityType: 'annotation',
      session: { treeId, status: 'pending', ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) },
    },
    select: { afterJson: true },
  })
  const cited = new Set<string>()
  for (const change of changes) {
    const photoId = annotationPhotoId(change.afterJson, treeId)
    if (photoId) cited.add(photoId)
  }
  return cited
}

// Photos d'une famille refusées pendant une relecture : effacées si leur ligne d'attente existe encore (une
// acceptation la retire) et si aucune autre proposition en attente ne les cite. Appelé une fois, après toutes les
// décisions. Renvoie les chemins à effacer une fois la transaction validée.
export async function releaseRejectedPhotos(tx: Tx, treeId: string, rejectedAfters: unknown[], sessionId: string): Promise<string[]> {
  const candidates = new Set(rejectedAfters.map((after) => annotationPhotoId(after, treeId)).filter((id): id is string => Boolean(id)))
  if (candidates.size === 0) return []
  const cited = await photosInPendingProposals(tx, treeId, sessionId)
  const removed: string[] = []
  for (const photoId of candidates) {
    if (cited.has(photoId)) continue
    const upload = await tx.annotationPhotoUpload.findFirst({ where: { id: photoId, treeId }, select: { filePath: true } })
    if (!upload) continue
    await tx.annotationPhotoUpload.delete({ where: { id: photoId } })
    removed.push(upload.filePath)
  }
  return removed
}

// Envois de photos jamais proposés depuis 7 jours : effacés. Appelé à chaque nouvel envoi de la famille, sur
// cet arbre seulement. Renvoie les chemins à effacer.
export async function sweepStalePendingPhotos(db: Db, treeId: string, now = new Date()): Promise<string[]> {
  const stale = await db.annotationPhotoUpload.findMany({
    where: { treeId, createdAt: { lt: new Date(now.getTime() - PENDING_PHOTO_TTL_MS) } },
    select: { id: true, filePath: true },
  })
  if (stale.length === 0) return []
  const cited = await photosInPendingProposals(db, treeId)
  const removed: string[] = []
  for (const upload of stale) {
    if (cited.has(upload.id)) continue
    await db.annotationPhotoUpload.delete({ where: { id: upload.id } })
    removed.push(upload.filePath)
  }
  return removed
}

// Réserve une place d'envoi en attente sous un verrou par arbre : deux envois simultanés ne dépassent pas le
// plafond. Renvoie false si l'arbre est plein. La ligne est créée avant l'écriture du fichier ; si l'écriture
// échoue, l'appelant la retire (forgetPendingPhoto).
export async function reservePendingPhoto(prisma: PrismaClient, treeId: string, photoId: string, filePath: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'annotation-photos:' + treeId}))`
    if (await tx.annotationPhotoUpload.count({ where: { treeId } }) >= MAX_PENDING_PHOTOS_PER_TREE) return false
    await tx.annotationPhotoUpload.create({ data: { id: photoId, treeId, filePath } })
    return true
  })
}

export async function forgetPendingPhoto(db: Db, photoId: string): Promise<void> {
  await db.annotationPhotoUpload.deleteMany({ where: { id: photoId } })
}

// Chemin relatif sûr d'une photo d'annotation (sous <treeId>/annotation-photos/)
export function annotationPhotoRelativePath(treeId: string, photoId: string, extension: string): string {
  return path.posix.join(treeId, 'annotation-photos', `${photoId}${extension}`)
}
