import type { Prisma, PrismaClient } from '@prisma/client'

type LinkReader = Pick<PrismaClient, 'parentChildLink'> | Pick<Prisma.TransactionClient, 'parentChildLink'>

// Ordre d'un nouvel enfant : après ses frères et sœurs, pour qu'une fratrie déjà réordonnée
// ne voie pas le dernier arrivé passer devant (le placement trie les enfants sur displayOrder).
export async function nextSiblingOrder(db: LinkReader, treeId: string, parentPersonId: string): Promise<number> {
  const last = await db.parentChildLink.findFirst({
    where: { treeId, parentPersonId, deletedAt: null },
    orderBy: { displayOrder: 'desc' },
    select: { displayOrder: true },
  })
  return Number.isInteger(last?.displayOrder) ? (last!.displayOrder as number) + 1 : 1
}
