import type { Prisma, PrismaClient } from '../generated/prisma/client.js'

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
// invited : l'appelant a vérifié une invitation à co-gérer un arbre pour cette adresse (issue #145) ; le
// propriétaire de l'arbre a été admis par l'admin du serveur, son invitation ouvre un compte.
export async function createAccountIfAllowed<T>(
  prisma: PrismaClient,
  create: (tx: Prisma.TransactionClient) => Promise<T>,
  { invited = false }: { invited?: boolean } = {},
): Promise<T | null> {
  if (env.ALLOW_REGISTRATION || invited) return create(prisma)

  return prisma.$transaction(async (tx) => {
    // Clé arbitraire, propre à la création de compte. pg_advisory_xact_lock renvoie void : $executeRaw, pas $queryRaw.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(113001)`
    if ((await tx.user.count()) > 0) return null
    return create(tx)
  })
}
