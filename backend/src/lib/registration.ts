import type { Prisma, PrismaClient } from '@prisma/client'

import { env } from '../config/env.js'

// Inscription fermée (ALLOW_REGISTRATION=false) : une instance sans aucun compte accepte quand même le premier,
// sinon personne ne pourrait jamais s'y connecter. Dès qu'un compte existe, plus aucun ne se crée.
export async function isRegistrationOpen(prisma: PrismaClient): Promise<boolean> {
  if (env.ALLOW_REGISTRATION) return true
  return (await prisma.user.count()) === 0
}

// Seul chemin de création d'un compte. Inscription fermée : le compte n'est créé que si la base n'en a aucun,
// sous un verrou de transaction pour que deux inscriptions simultanées sur une instance neuve n'en créent pas
// deux. Renvoie null quand la création est refusée.
export async function createAccountIfAllowed<T>(
  prisma: PrismaClient,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  if (env.ALLOW_REGISTRATION) return create(prisma)

  return prisma.$transaction(async (tx) => {
    // Clé arbitraire, propre à la création de compte. pg_advisory_xact_lock renvoie void : $executeRaw, pas $queryRaw.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(113001)`
    if ((await tx.user.count()) > 0) return null
    return create(tx)
  })
}
