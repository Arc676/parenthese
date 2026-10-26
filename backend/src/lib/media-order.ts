import type { Prisma } from '../generated/prisma/client.js'

// Renumérote les souvenirs acceptés d'une personne et met en avant les trois premiers.
// Les souvenirs en attente de relecture ne comptent pas.
export async function syncPersonMediaOrder(prisma: Prisma.TransactionClient, treeId: string, personId: string): Promise<void> {
  const media = await prisma.mediaItem.findMany({
    where: {
      treeId,
      personId,
      status: 'approved',
      deletedAt: null,
    },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
    },
  })

  for (let index = 0; index < media.length; index += 1) {
    const item = media[index]
    await prisma.mediaItem.update({
      where: {
        id: item.id,
      },
      data: {
        displayOrder: index + 1,
        isFeatured: index < 3,
      },
    })
  }
}
