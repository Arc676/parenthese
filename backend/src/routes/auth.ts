import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { env } from '../config/env.js'
import { hashPassword, verifyPassword } from '../lib/auth.js'
import { createAccountIfAllowed, isRegistrationOpen } from '../lib/registration.js'
import { revokeUserToken } from '../lib/token-revocation.js'
import { deletedAccountVisitorKey } from '../lib/tree-visits.js'
import { deleteTreeRecords, removeTreeMediaDirectories } from '../lib/tree-purge.js'
import type { AnyJwtPayload } from '../types/auth.js'

// Hash de comparaison pour une adresse inconnue, calculé une fois au premier besoin
let dummyHash: Promise<string> | null = null
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomUUID())
  return dummyHash
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
})

// Prénom du compte, facultatif : seulement à l'inscription (la connexion ne le demande pas)
const registerSchema = credentialsSchema.extend({
  firstName: z.string().max(60).optional().nullable(),
})

function trimmedFirstName(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed : null
}

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
})

const updateLastTreeSchema = z.object({
  treeId: z.string().min(1),
  accessMode: z.enum(['member', 'share']),
})

async function resolveAccessibleLastTree(
  app: FastifyInstance,
  userId: string,
  treeId: string,
  accessMode: 'member' | 'share',
): Promise<{ role: string } | null> {
  if (accessMode === 'member') {
    const membership = await app.prisma.treeMembership.findUnique({
      where: {
        treeId_userId: {
          treeId,
          userId,
        },
      },
      include: {
        tree: {
          select: {
            deletedAt: true,
          },
        },
      },
    })

    if (!membership || membership.tree.deletedAt) {
      return null
    }

    return { role: membership.role }
  }

  const shared = await app.prisma.userTreeAccess.findUnique({
    where: {
      treeId_userId: {
        treeId,
        userId,
      },
    },
    include: {
      tree: {
        select: {
          deletedAt: true,
        },
      },
    },
  })

  if (!shared || shared.tree.deletedAt) {
    return null
  }

  return { role: shared.role }
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Ce que l'écran d'accueil propose : l'app cache « Créer un compte » quand l'instance n'en accepte plus
  app.get(
    '/options',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_request, reply) => reply.send({ registration: await isRegistrationOpen(app.prisma) }),
  )

  app.post(
    '/register',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
      }

      // Inscription fermée : refusée avant toute lecture, la réponse ne dit pas si l'adresse a un compte
      if (!(await isRegistrationOpen(app.prisma))) {
        return reply.code(403).send({ error: 'registration_closed' })
      }

      const email = parsed.data.email.trim().toLowerCase()
      const existing = await app.prisma.user.findUnique({ where: { email } })
      if (existing) {
        return reply.code(409).send({ error: 'email_already_exists' })
      }

      const passwordHash = await hashPassword(parsed.data.password)
      const user = await createAccountIfAllowed(app.prisma, (tx) => tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: trimmedFirstName(parsed.data.firstName),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
        },
      }))
      // Un autre compte est né pendant le calcul du hash, sur une instance fermée
      if (!user) {
        return reply.code(403).send({ error: 'registration_closed' })
      }

      const token = app.jwt.sign(
        {
          kind: 'user',
          sub: user.id,
          jti: randomUUID(),
          userId: user.id,
          email: user.email,
        },
        { expiresIn: env.JWT_EXPIRES_IN },
      )

      return reply.code(201).send({ token, user })
    },
  )

  app.post(
    '/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const parsed = credentialsSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
      }

      const email = parsed.data.email.trim().toLowerCase()
      const user = await app.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          passwordHash: true,
        },
      })

      if (!user) {
        // Même durée qu'un mauvais mot de passe : la réponse ne dit pas si l'adresse a un compte
        await verifyPassword(parsed.data.password, await getDummyHash())
        return reply.code(401).send({ error: 'invalid_credentials' })
      }

      const isValid = await verifyPassword(parsed.data.password, user.passwordHash)
      if (!isValid) {
        return reply.code(401).send({ error: 'invalid_credentials' })
      }

      const token = app.jwt.sign(
        {
          kind: 'user',
          sub: user.id,
          jti: randomUUID(),
          userId: user.id,
          email: user.email,
        },
        { expiresIn: env.JWT_EXPIRES_IN },
      )

      return reply.send({
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
        },
      })
    },
  )

  // Profil du compte connecté (prénom compris) : la session restaurée sur un autre appareil le retrouve
  app.get('/me', async (request, reply) => {
    if (!request.actor || request.actor.kind !== 'user') {
      return reply.code(401).send({ error: 'authentication_required' })
    }

    const user = await app.prisma.user.findUnique({
      where: { id: request.actor.userId },
      select: { id: true, email: true, firstName: true },
    })
    if (!user) {
      return reply.code(401).send({ error: 'authentication_required' })
    }

    return reply.send({ user })
  })

  app.get('/me/last-tree', async (request, reply) => {
    if (!request.actor || request.actor.kind !== 'user') {
      return reply.code(401).send({ error: 'authentication_required' })
    }

    const user = await app.prisma.user.findUnique({
      where: {
        id: request.actor.userId,
      },
      select: {
        lastOpenedTreeId: true,
        lastOpenedAccessMode: true,
        lastOpenedRole: true,
        lastOpenedAt: true,
      },
    })

    if (
      !user ||
      !user.lastOpenedTreeId ||
      !user.lastOpenedAccessMode ||
      (user.lastOpenedAccessMode !== 'member' && user.lastOpenedAccessMode !== 'share')
    ) {
      return reply.send({ lastTree: null })
    }

    const access = await resolveAccessibleLastTree(
      app,
      request.actor.userId,
      user.lastOpenedTreeId,
      user.lastOpenedAccessMode,
    )

    if (!access) {
      return reply.send({ lastTree: null })
    }

    return reply.send({
      lastTree: {
        treeId: user.lastOpenedTreeId,
        accessMode: user.lastOpenedAccessMode,
        role: user.lastOpenedRole || access.role,
        lastOpenedAt: user.lastOpenedAt,
      },
    })
  })

  app.put('/me/last-tree', async (request, reply) => {
    if (!request.actor || request.actor.kind !== 'user') {
      return reply.code(401).send({ error: 'authentication_required' })
    }

    const parsed = updateLastTreeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
    }

    const access = await resolveAccessibleLastTree(
      app,
      request.actor.userId,
      parsed.data.treeId,
      parsed.data.accessMode,
    )

    if (!access) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    const now = new Date()
    await app.prisma.user.update({
      where: {
        id: request.actor.userId,
      },
      data: {
        lastOpenedTreeId: parsed.data.treeId,
        lastOpenedAccessMode: parsed.data.accessMode,
        lastOpenedRole: access.role,
        lastOpenedAt: now,
      },
    })

    if (parsed.data.accessMode === 'share') {
      await app.prisma.userTreeAccess.updateMany({
        where: {
          treeId: parsed.data.treeId,
          userId: request.actor.userId,
        },
        data: {
          updatedAt: now,
        },
      })
    }

    return reply.send({
      lastTree: {
        treeId: parsed.data.treeId,
        accessMode: parsed.data.accessMode,
        role: access.role,
        lastOpenedAt: now,
      },
    })
  })

  app.delete(
    '/me',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      if (!request.actor || request.actor.kind !== 'user') {
        return reply.code(401).send({ error: 'authentication_required' })
      }

      const parsed = deleteAccountSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_payload', details: parsed.error.flatten() })
      }

      const userId = request.actor.userId
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          passwordHash: true,
        },
      })

      if (!user) {
        return reply.code(401).send({ error: 'authentication_required' })
      }

      const isValid = await verifyPassword(parsed.data.password, user.passwordHash)
      if (!isValid) {
        return reply.code(403).send({ error: 'invalid_password' })
      }

      const payload = await request.jwtVerify<AnyJwtPayload & { exp?: number }>()

      // Arbres possédés (y compris ceux marqués supprimés) puis compte, dans une seule transaction :
      // la relation propriétaire est en Restrict, les arbres doivent partir avant l'utilisateur.
      const ownedTreeIds = await app.prisma.$transaction(async (tx) => {
        const ownedTrees = await tx.tree.findMany({
          where: { ownerUserId: userId },
          select: { id: true },
        })
        const treeIds = ownedTrees.map((tree) => tree.id)

        await deleteTreeRecords(tx, treeIds)

        // Les contributions envoyées à d'autres familles restent, sans l'adresse email de l'auteur.
        await tx.contributionSession.updateMany({
          where: { submittedByUserId: userId },
          data: { submittedByLabel: 'Contributeur' },
        })

        // Ses visites des autres arbres restent comptées, sans son identifiant
        await tx.treeVisit.updateMany({
          where: { visitorKey: `user:${userId}` },
          data: { visitorKey: deletedAccountVisitorKey(userId) },
        })

        await tx.user.delete({ where: { id: userId } })
        return treeIds
      })

      if (payload.kind === 'user' && typeof payload.exp === 'number') {
        revokeUserToken(payload.jti, payload.exp)
      }

      await removeTreeMediaDirectories(ownedTreeIds, request.log)

      return reply.send({ ok: true })
    },
  )

  app.post('/logout', async (request, reply) => {
    if (!request.actor || request.actor.kind !== 'user') {
      return reply.code(401).send({ error: 'authentication_required' })
    }

    const payload = await request.jwtVerify<AnyJwtPayload & { exp?: number }>()
    if (payload.kind !== 'user') {
      return reply.code(401).send({ error: 'invalid_token_kind' })
    }

    if (typeof payload.exp === 'number') {
      revokeUserToken(payload.jti, payload.exp)
    }

    return reply.send({ ok: true })
  })
}
