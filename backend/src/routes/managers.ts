import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { env } from '../config/env.js'
import { isOidcEnabled } from '../lib/oidc.js'
import {
  INVITATION_TTL_MS,
  MAX_PENDING_INVITATIONS,
  acceptInvitation,
  findPendingInvitationByToken,
  hashInvitationToken,
  maskEmail,
  newInvitationToken,
  normalizeEmail,
  pendingInvitationWhere,
} from '../lib/tree-invitations.js'

// Co-gestion d'un arbre (issue #145). Un co-gestionnaire est un membre « admin » : il fait tout ce que fait le
// propriétaire, sauf inviter ou retirer un co-gestionnaire et supprimer l'arbre (DELETE /trees/:id, réservé au
// propriétaire), ni Immich, qui passe par la clé du propriétaire (routes/immich.ts). Les droits sont relus en base à
// chaque requête : un co-gestionnaire retiré perd la main aussitôt. Il a pu voir le mot de passe de partage :
// l'écran de retrait propose de le changer.

const treeIdParamSchema = z.object({ id: z.string().min(1) })
const invitationParamsSchema = z.object({ id: z.string().min(1), invitationId: z.string().min(1) })
const managerParamsSchema = z.object({ id: z.string().min(1), userId: z.string().min(1) })
const tokenParamSchema = z.object({ token: z.string().min(1).max(200) })
const inviteSchema = z.object({ email: z.string().trim().email().max(254) })

function requireUser(request: FastifyRequest, reply: FastifyReply): { userId: string } | null {
  if (!request.actor || request.actor.kind !== 'user') {
    reply.code(401).send({ error: 'authentication_required' })
    return null
  }
  return { userId: request.actor.userId }
}

async function membershipOf(app: FastifyInstance, treeId: string, userId: string) {
  const membership = await app.prisma.treeMembership.findUnique({
    where: { treeId_userId: { treeId, userId } },
    select: { role: true, tree: { select: { deletedAt: true, ownerUserId: true } } },
  })
  return membership && !membership.tree.deletedAt ? membership : null
}

function audit(app: FastifyInstance, treeId: string, actorId: string, action: string, payloadJson: Record<string, string>) {
  return app.prisma.auditLog.create({
    data: { treeId, actorType: 'user', actorId, action, entityType: 'tree', entityId: treeId, payloadJson },
  })
}

export const managerRoutes: FastifyPluginAsync = async (app) => {
  // Gestionnaires et invitations en attente, pour tout gestionnaire de l'arbre. canManage : le propriétaire.
  app.get('/trees/:id/managers', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_tree_id' })

    const membership = await membershipOf(app, params.data.id, user.userId)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const [managers, invitations] = await Promise.all([
      app.prisma.treeMembership.findMany({
        where: { treeId: params.data.id, role: { in: ['owner', 'admin'] } },
        select: { role: true, createdAt: true, user: { select: { id: true, email: true, firstName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      app.prisma.treeInvitation.findMany({
        where: { treeId: params.data.id, ...pendingInvitationWhere() },
        select: { id: true, email: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    return reply.send({
      canManage: membership.role === 'owner',
      managers: managers.map((m) => ({ userId: m.user.id, email: m.user.email, firstName: m.user.firstName, role: m.role, since: m.createdAt })),
      invitations,
    })
  })

  // Inviter une adresse. Une invitation déjà en attente pour cette adresse reçoit un nouveau lien (l'ancien ne
  // sert plus). Le jeton n'est rendu qu'ici et par /link : la base n'en garde que l'empreinte.
  app.post('/trees/:id/invitations', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_tree_id' })
    const payload = inviteSchema.safeParse(request.body)
    if (!payload.success) return reply.code(400).send({ error: 'invalid_email' })

    const membership = await membershipOf(app, params.data.id, user.userId)
    if (!membership || membership.role !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    const email = normalizeEmail(payload.data.email)
    const alreadyManager = await app.prisma.treeMembership.findFirst({
      where: { treeId: params.data.id, role: { in: ['owner', 'admin'] }, user: { email } },
      select: { id: true },
    })
    if (alreadyManager) return reply.code(409).send({ error: 'already_manager' })

    const { token, tokenHash } = newInvitationToken()
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
    const existing = await app.prisma.treeInvitation.findFirst({
      where: { treeId: params.data.id, email, ...pendingInvitationWhere() },
      select: { id: true },
    })
    let invitation
    if (existing) {
      invitation = await app.prisma.treeInvitation.update({
        where: { id: existing.id },
        data: { tokenHash, expiresAt },
        select: { id: true, email: true, createdAt: true, expiresAt: true },
      })
    } else {
      const pending = await app.prisma.treeInvitation.count({ where: { treeId: params.data.id, ...pendingInvitationWhere() } })
      if (pending >= MAX_PENDING_INVITATIONS) return reply.code(429).send({ error: 'too_many_invitations' })
      invitation = await app.prisma.treeInvitation.create({
        data: { treeId: params.data.id, email, tokenHash, expiresAt, invitedByUserId: user.userId },
        select: { id: true, email: true, createdAt: true, expiresAt: true },
      })
    }
    await audit(app, params.data.id, user.userId, 'manager_invited', { invitationId: invitation.id })
    return reply.code(201).send({ invitation, token })
  })

  // « Copier le lien » : un nouveau jeton (l'ancien lien ne sert plus), la durée repart de zéro
  app.post('/trees/:id/invitations/:invitationId/link', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const params = invitationParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const membership = await membershipOf(app, params.data.id, user.userId)
    if (!membership || membership.role !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    const { token, tokenHash } = newInvitationToken()
    const updated = await app.prisma.treeInvitation.updateMany({
      where: { id: params.data.invitationId, treeId: params.data.id, ...pendingInvitationWhere() },
      data: { tokenHash, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
    })
    if (updated.count !== 1) return reply.code(404).send({ error: 'invitation_not_found' })
    return reply.send({ token })
  })

  app.delete('/trees/:id/invitations/:invitationId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const params = invitationParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const membership = await membershipOf(app, params.data.id, user.userId)
    if (!membership || membership.role !== 'owner') return reply.code(403).send({ error: 'forbidden' })

    const revoked = await app.prisma.treeInvitation.updateMany({
      where: { id: params.data.invitationId, treeId: params.data.id, ...pendingInvitationWhere() },
      data: { revokedAt: new Date() },
    })
    if (revoked.count !== 1) return reply.code(404).send({ error: 'invitation_not_found' })
    await audit(app, params.data.id, user.userId, 'manager_invitation_revoked', { invitationId: params.data.invitationId })
    return reply.send({ ok: true })
  })

  // Retirer un co-gestionnaire (le propriétaire), ou quitter la gestion (le co-gestionnaire lui-même).
  // Le propriétaire ne se retire jamais : son arbre part avec lui (suppression de l'arbre ou du compte).
  app.delete('/trees/:id/managers/:userId', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const params = managerParamsSchema.safeParse(request.params)
    if (!params.success) return reply.code(400).send({ error: 'invalid_params' })

    const membership = await membershipOf(app, params.data.id, user.userId)
    const leaving = params.data.userId === user.userId
    if (!membership || (leaving ? membership.role !== 'admin' : membership.role !== 'owner')) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    // Un accès retenu par le mot de passe de partage (user_tree_accesses) part aussi : sinon le compte retiré
    // lirait encore l'arbre
    const removed = await app.prisma.$transaction(async (tx) => {
      const deleted = await tx.treeMembership.deleteMany({
        where: { treeId: params.data.id, userId: params.data.userId, role: 'admin' },
      })
      if (deleted.count === 1) {
        await tx.userTreeAccess.deleteMany({ where: { treeId: params.data.id, userId: params.data.userId } })
      }
      return deleted
    })
    if (removed.count !== 1) return reply.code(404).send({ error: 'manager_not_found' })
    await audit(app, params.data.id, user.userId, leaving ? 'manager_left' : 'manager_removed', { userId: params.data.userId })
    return reply.send({ ok: true })
  })

  // Page du lien, sans compte : l'arbre, qui invite, l'adresse masquée, et les façons d'entrer sur ce serveur
  app.get('/invitations/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const params = tokenParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ error: 'invitation_invalid' })
    const invitation = await findPendingInvitationByToken(app.prisma, params.data.token)
    if (!invitation) {
      // Lien déjà servi ou expiré : dit tel quel, pour que la page explique quoi faire. Rien d'autre ne sort.
      const known = await app.prisma.treeInvitation.findUnique({
        where: { tokenHash: hashInvitationToken(params.data.token) },
        select: { acceptedAt: true, revokedAt: true, expiresAt: true },
      })
      const error = known?.acceptedAt ? 'invitation_used' : known && !known.revokedAt && known.expiresAt <= new Date() ? 'invitation_expired' : 'invitation_invalid'
      return reply.code(404).send({ error })
    }
    return reply.send({
      treeName: invitation.tree.name,
      treeIcon: invitation.tree.icon,
      invitedBy: invitation.tree.owner.firstName || null,
      emailHint: maskEmail(invitation.email),
      expiresAt: invitation.expiresAt,
      passwordLogin: env.PASSWORD_LOGIN,
      oidc: isOidcEnabled() ? { name: env.OIDC_PROVIDER_NAME } : null,
    })
  })

  // Accepter avec le compte connecté : il doit avoir l'adresse invitée
  app.post('/invitations/:token/accept', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const params = tokenParamSchema.safeParse(request.params)
    if (!params.success) return reply.code(404).send({ error: 'invitation_invalid' })

    const invitation = await findPendingInvitationByToken(app.prisma, params.data.token)
    if (!invitation) return reply.code(404).send({ error: 'invitation_invalid' })
    const account = await app.prisma.user.findUnique({ where: { id: user.userId }, select: { email: true } })
    if (!account) return reply.code(401).send({ error: 'authentication_required' })

    const result = await acceptInvitation(app.prisma, invitation.id, user.userId, account.email)
    if (!result.ok) {
      const code = result.error === 'invitation_invalid' ? 404 : result.error === 'already_owner' ? 409 : 403
      return reply.code(code).send({ error: result.error })
    }
    return reply.send({ treeId: result.treeId, role: 'admin' })
  })
}
