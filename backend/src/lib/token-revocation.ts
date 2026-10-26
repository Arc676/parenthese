import type { PrismaClient } from '@prisma/client'

// Sessions fermées par « Se déconnecter » ou par la suppression du compte, jusqu'à la fin de leur jeton.
// Gardées en mémoire pour ne coûter aucune requête par appel, et en base pour survivre au redémarrage de l'API :
// avant, chaque déploiement les oubliait et un jeton déconnecté redevenait valable jusqu'à 7 jours.
// L'API tourne en un seul processus (pm2 fork, un conteneur) : la mémoire suffit entre deux redémarrages.
const revokedUserTokens = new Map<string, number>()

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

type RevocationStore = Pick<PrismaClient, 'revokedSession'>

export async function revokeUserToken(store: RevocationStore, jti: string, exp: number): Promise<void> {
  revokedUserTokens.set(jti, exp)
  const expiresAt = new Date(exp * 1000)
  await store.revokedSession.upsert({ where: { jti }, create: { jti, expiresAt }, update: {} })
}

export function isUserTokenRevoked(jti: string): boolean {
  const exp = revokedUserTokens.get(jti)
  if (!exp) {
    return false
  }

  // Opportunistic cleanup of expired revocations.
  if (exp <= nowSeconds()) {
    revokedUserTokens.delete(jti)
    return false
  }

  return true
}

// Au démarrage : les déconnexions encore valables reviennent en mémoire, les expirées sont effacées. L'effacement
// n'a lieu qu'ici : la table grossit entre deux redémarrages, d'une ligne par déconnexion, ce qui reste minuscule
// avec un déploiement par jour ou presque.
export async function loadRevokedTokens(store: RevocationStore): Promise<number> {
  const now = new Date()
  await store.revokedSession.deleteMany({ where: { expiresAt: { lte: now } } })
  const rows = await store.revokedSession.findMany({ where: { expiresAt: { gt: now } }, select: { jti: true, expiresAt: true } })
  for (const row of rows) {
    revokedUserTokens.set(row.jti, Math.floor(row.expiresAt.getTime() / 1000))
  }
  return rows.length
}

// Tests : repartir d'un processus neuf, comme après un redémarrage
export function forgetRevokedTokensInMemory(): void {
  revokedUserTokens.clear()
}
