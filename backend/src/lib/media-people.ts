import type { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'

type Db = PrismaClient | Prisma.TransactionClient

// Personnes identifiées sur un souvenir. La liste envoyée remplace la précédente : retirer quelqu'un, c'est
// renvoyer la liste sans lui. Le point (x, y) est facultatif, en proportion de l'image (0 à 1), et va par paire.
export const MAX_PEOPLE_PER_MEDIA = 50

const coordinate = z.number().min(0).max(1).nullable().optional()

export const mediaPersonSchema = z
  .object({
    personId: z.string().min(1).max(64),
    x: coordinate,
    y: coordinate,
  })
  .refine((value) => (value.x == null) === (value.y == null), { message: 'point_requires_x_and_y' })

export const mediaPeopleSchema = z
  .array(mediaPersonSchema)
  .max(MAX_PEOPLE_PER_MEDIA)
  .refine((people) => new Set(people.map((person) => person.personId)).size === people.length, { message: 'duplicate_person' })

export type MediaPerson = { personId: string; x: number | null; y: number | null }

export function normalizeMediaPeople(people: z.infer<typeof mediaPeopleSchema>): MediaPerson[] {
  return people.map((person) => ({ personId: person.personId, x: person.x ?? null, y: person.y ?? null }))
}

export async function readMediaPeople(db: Db, treeId: string, mediaId: string): Promise<MediaPerson[]> {
  const tags = await db.mediaPersonTag.findMany({
    where: { treeId, mediaId },
    select: { personId: true, x: true, y: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return tags
}

// Remplace les personnes d'un souvenir. Une personne supprimée entre l'envoi et la relecture est écartée
// sans faire échouer le reste. Renvoie la liste réellement enregistrée.
export async function replaceMediaPeople(
  db: Db,
  treeId: string,
  mediaId: string,
  people: MediaPerson[],
  actorUserId: string | null,
): Promise<MediaPerson[]> {
  const ids = people.map((person) => person.personId)
  const existing = ids.length
    ? await db.person.findMany({ where: { treeId, id: { in: ids }, deletedAt: null }, select: { id: true } })
    : []
  const alive = new Set(existing.map((person) => person.id))
  const kept = people.filter((person) => alive.has(person.personId))

  await db.mediaPersonTag.deleteMany({ where: { treeId, mediaId } })
  if (kept.length) {
    // Une date par rang : l'ordre d'affichage suit celui de la liste envoyée
    const base = Date.now()
    await db.mediaPersonTag.createMany({
      data: kept.map((person, index) => ({
        treeId,
        mediaId,
        personId: person.personId,
        x: person.x,
        y: person.y,
        createdBy: actorUserId,
        createdAt: new Date(base + index),
      })),
    })
  }
  return kept
}
