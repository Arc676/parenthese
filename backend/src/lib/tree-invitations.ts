import { createHash, randomBytes } from 'node:crypto'

import type { Prisma, PrismaClient } from '../generated/prisma/client.js'

// Co-gestion d'un arbre (issue #145). Le propriétaire invite une adresse ; Parenthèse n'envoie pas de mail, il
// donne un lien à transmettre. Seule l'empreinte du jeton est gardée en base.
//
// Qui est rattaché, et comment :
// - par le lien, avec un compte à la même adresse (mot de passe ou OIDC). L'inscription par mot de passe ne
//   vérifie pas l'adresse : le lien est la preuve, l'adresse seule ne suffit jamais ;
// - sans le lien, seulement par OIDC, quand le fournisseur dit l'email vérifié (claimInvitationsForVerifiedEmail).

export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000
export const MAX_PENDING_INVITATIONS = 20

type Db = PrismaClient | Prisma.TransactionClient

export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInvitationToken(token) }
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Invitation encore valable : ni acceptée, ni annulée, ni expirée
export function pendingInvitationWhere(now = new Date()): Prisma.TreeInvitationWhereInput {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now }, tree: { deletedAt: null } }
}

export async function findPendingInvitationByToken(db: Db, token: string) {
  if (!token || token.length > 200) return null
  return db.treeInvitation.findFirst({
    where: { tokenHash: hashInvitationToken(token), ...pendingInvitationWhere() },
    include: { tree: { select: { id: true, name: true, icon: true, ownerUserId: true, owner: { select: { firstName: true } } } } },
  })
}

export async function hasPendingInvitationForEmail(db: Db, email: string): Promise<boolean> {
  const found = await db.treeInvitation.findFirst({ where: { email: normalizeEmail(email), ...pendingInvitationWhere() }, select: { id: true } })
  return Boolean(found)
}

export type AcceptResult = { ok: true; treeId: string } | { ok: false; error: 'invitation_invalid' | 'invitation_email_mismatch' | 'already_owner' }

// Accepte une invitation pour ce compte : co-gestionnaire (admin) de l'arbre. L'invitation ne sert qu'une fois,
// même pour deux acceptations simultanées (updateMany conditionnel dans la transaction).
export async function acceptInvitation(prisma: PrismaClient, invitationId: string, userId: string, userEmail: string): Promise<AcceptResult> {
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.treeInvitation.findFirst({
      where: { id: invitationId, ...pendingInvitationWhere() },
      select: { id: true, treeId: true, email: true, tree: { select: { ownerUserId: true } } },
    })
    if (!invitation) return { ok: false, error: 'invitation_invalid' } as const
    if (normalizeEmail(userEmail) !== invitation.email) return { ok: false, error: 'invitation_email_mismatch' } as const
    if (invitation.tree.ownerUserId === userId) return { ok: false, error: 'already_owner' } as const

    const claimed = await tx.treeInvitation.updateMany({
      where: { id: invitation.id, ...pendingInvitationWhere() },
      data: { acceptedAt: new Date(), acceptedUserId: userId },
    })
    if (claimed.count !== 1) return { ok: false, error: 'invitation_invalid' } as const

    const existing = await tx.treeMembership.findUnique({
      where: { treeId_userId: { treeId: invitation.treeId, userId } },
      select: { role: true },
    })
    if (!existing) {
      await tx.treeMembership.create({ data: { treeId: invitation.treeId, userId, role: 'admin' } })
    } else if (existing.role === 'member') {
      await tx.treeMembership.update({ where: { treeId_userId: { treeId: invitation.treeId, userId } }, data: { role: 'admin' } })
    }
    // L'arbre s'ouvre à la prochaine visite
    await tx.user.update({
      where: { id: userId },
      data: { lastOpenedTreeId: invitation.treeId, lastOpenedAccessMode: 'member', lastOpenedRole: 'admin', lastOpenedAt: new Date() },
    })
    await tx.auditLog.create({
      data: {
        treeId: invitation.treeId,
        actorType: 'user',
        actorId: userId,
        action: 'manager_joined',
        entityType: 'tree',
        entityId: invitation.treeId,
        payloadJson: { invitationId: invitation.id },
      },
    })
    return { ok: true, treeId: invitation.treeId } as const
  })
}

// Connexion OIDC avec un email vérifié par le fournisseur : les invitations en attente à cette adresse sont
// acceptées sans le lien. Jamais pour un email non vérifié, jamais pour une connexion par mot de passe, et
// seulement si c'est l'adresse du compte : une identité déjà reliée dont l'email a changé chez le fournisseur
// ne prend pas les invitations faites à sa nouvelle adresse (elle passe par le lien).
export async function claimInvitationsForVerifiedEmail(prisma: PrismaClient, userId: string, verifiedEmail: string): Promise<string[]> {
  const email = normalizeEmail(verifiedEmail)
  const invitations = await prisma.treeInvitation.findMany({ where: { email, ...pendingInvitationWhere() }, select: { id: true } })
  if (!invitations.length) return []
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!account || normalizeEmail(account.email) !== email) return []
  const joined: string[] = []
  for (const invitation of invitations) {
    const result = await acceptInvitation(prisma, invitation.id, userId, email)
    if (result.ok) joined.push(result.treeId)
  }
  return joined
}

// « jacques@exemple.fr » devient « ja•••@exemple.fr » sur la page publique du lien
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '•••'
  return `${local.slice(0, Math.min(2, local.length))}•••@${domain}`
}
