import { rm } from 'node:fs/promises'
import path from 'node:path'

import type { Prisma, PrismaClient } from '../generated/prisma/client.js'

import { env } from '../config/env.js'

export type PurgeLogger = {
  warn: (details: Record<string, unknown>, message: string) => void
  error: (details: Record<string, unknown>, message: string) => void
}

export function getMediaStorageRoot(): string {
  return path.resolve(env.MEDIA_STORAGE_PATH)
}

/**
 * Dossier des médias d'un arbre : `<racine>/<treeId>`.
 * Renvoie null si l'identifiant désigne autre chose qu'un dossier situé directement sous la racine.
 */
export function resolveTreeMediaDirectory(treeId: string, storageRoot = getMediaStorageRoot()): string | null {
  if (!treeId || treeId.includes('/') || treeId.includes('\\')) {
    return null
  }

  const root = path.resolve(storageRoot)
  const directory = path.resolve(root, treeId)
  if (directory === root || path.dirname(directory) !== root) {
    return null
  }

  return directory
}

/**
 * Supprime définitivement des arbres, dans la transaction fournie.
 * Personnes, liens, médias, annotations, contributions et journal d'audit partent en cascade.
 */
export async function deleteTreeRecords(tx: Prisma.TransactionClient, treeIds: string[]): Promise<number> {
  if (treeIds.length === 0) {
    return 0
  }

  await tx.user.updateMany({
    where: {
      lastOpenedTreeId: { in: treeIds },
    },
    data: {
      lastOpenedTreeId: null,
      lastOpenedAccessMode: null,
      lastOpenedRole: null,
      lastOpenedAt: null,
    },
  })

  const deleted = await tx.tree.deleteMany({
    where: {
      id: { in: treeIds },
    },
  })

  return deleted.count
}

/**
 * Supprime les dossiers médias des arbres. À appeler une fois la transaction validée :
 * un échec est journalisé sans être propagé, la base restant la source de vérité.
 */
export async function removeTreeMediaDirectories(
  treeIds: string[],
  logger: PurgeLogger,
  storageRoot = getMediaStorageRoot(),
): Promise<void> {
  for (const treeId of treeIds) {
    const directory = resolveTreeMediaDirectory(treeId, storageRoot)
    if (!directory) {
      logger.warn({ treeId }, 'Refused media directory path for tree purge')
      continue
    }

    try {
      await rm(directory, { recursive: true, force: true })
    } catch (error) {
      logger.error({ err: error, treeId }, 'Failed to remove tree media directory')
    }
  }
}

/** Suppression définitive d'arbres : base dans une transaction, puis fichiers. */
export async function purgeTrees(prisma: PrismaClient, treeIds: string[], logger: PurgeLogger): Promise<number> {
  const uniqueIds = [...new Set(treeIds)]
  if (uniqueIds.length === 0) {
    return 0
  }

  const count = await prisma.$transaction((tx) => deleteTreeRecords(tx, uniqueIds))
  await removeTreeMediaDirectories(uniqueIds, logger)
  return count
}
