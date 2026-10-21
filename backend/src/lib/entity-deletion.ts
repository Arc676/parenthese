import { Prisma, type PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

// Suppression d'une personne ou d'une union, avec tout ce qui en dépend. Un seul chemin pour la route du
// propriétaire et pour une contribution approuvée : la voie contribution ne marquait que la personne, et ses
// photos, unions et liens restaient servis à toute la famille.
//
// Les fichiers ne sont pas effacés ici (on est souvent dans une transaction qui peut encore échouer) : la
// fonction renvoie leurs chemins, à passer à removeStoredFile une fois la transaction validée. Les garder sur
// le disque laissait aussi contourner le quota, qui ne compte que les médias non supprimés.

export type DeletionResult = {
  unions: number
  links: number
  medias: number
  filePaths: string[]
}

export async function softDeletePersonCascade(
  db: Db,
  treeId: string,
  personId: string,
  actorUserId: string | null,
  now = new Date(),
): Promise<DeletionResult | null> {
  const person = await db.person.findFirst({
    where: { id: personId, treeId, deletedAt: null },
    select: { avatarPath: true },
  })
  if (!person) return null

  await db.person.updateMany({
    where: { id: personId, treeId, deletedAt: null },
    data: { deletedAt: now, updatedBy: actorUserId, avatarPath: null, avatarMimeType: null, avatarCrop: Prisma.DbNull, immichPersonId: null },
  })

  const unions = await db.union.findMany({
    where: {
      treeId,
      deletedAt: null,
      OR: [{ partner1PersonId: personId }, { partner2PersonId: personId }],
    },
    select: { id: true },
  })
  const unionIds = unions.map((union) => union.id)

  const medias = await db.mediaItem.findMany({
    where: { treeId, personId, deletedAt: null },
    select: { id: true, filePath: true, thumbPath: true },
  })

  // Identifications : la personne disparaît des photos des autres, et ses souvenirs n'ont plus personne
  await db.mediaPersonTag.deleteMany({
    where: {
      treeId,
      OR: [{ personId }, ...(medias.length > 0 ? [{ mediaId: { in: medias.map((media) => media.id) } }] : [])],
    },
  })

  const [deletedUnions, deletedLinks, deletedMedia] = await Promise.all([
    db.union.updateMany({
      where: { treeId, id: { in: unionIds }, deletedAt: null },
      data: { deletedAt: now },
    }),
    // Liens de la personne, et liens qui passaient par une de ses unions
    db.parentChildLink.updateMany({
      where: {
        treeId,
        deletedAt: null,
        OR: [
          { parentPersonId: personId },
          { childPersonId: personId },
          ...(unionIds.length > 0 ? [{ viaUnionId: { in: unionIds } }] : []),
        ],
      },
      data: { deletedAt: now },
    }),
    db.mediaItem.updateMany({
      where: { treeId, personId, deletedAt: null },
      data: { deletedAt: now },
    }),
    // Événements de vie de la personne et de ses unions
    db.lifeEvent.updateMany({
      where: {
        treeId,
        deletedAt: null,
        OR: [{ personId }, ...(unionIds.length > 0 ? [{ unionId: { in: unionIds } }] : [])],
      },
      data: { deletedAt: now },
    }),
  ])

  // Racine de l'arbre supprimée : le graphe repart sans racine plutôt que sur une personne effacée
  await db.tree.updateMany({
    where: { id: treeId, rootPersonId: personId },
    data: { rootPersonId: null },
  })

  const filePaths = [
    person.avatarPath,
    ...medias.flatMap((media) => [media.filePath, media.thumbPath]),
  ].filter((value): value is string => Boolean(value) && !/^https?:\/\//.test(value as string))

  return {
    unions: deletedUnions.count,
    links: deletedLinks.count,
    medias: deletedMedia.count,
    filePaths,
  }
}

export async function softDeleteUnionCascade(
  db: Db,
  treeId: string,
  unionId: string,
  now = new Date(),
): Promise<{ links: number } | null> {
  const deletedUnion = await db.union.updateMany({
    where: { id: unionId, treeId, deletedAt: null },
    data: { deletedAt: now },
  })
  if (deletedUnion.count === 0) return null

  const deletedLinks = await db.parentChildLink.updateMany({
    where: { treeId, viaUnionId: unionId, deletedAt: null },
    data: { deletedAt: now },
  })

  return { links: deletedLinks.count }
}
