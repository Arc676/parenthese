import type { PrismaClient } from '../generated/prisma/client.js'
import type { Actor, AnyJwtPayload } from './auth.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AnyJwtPayload
    user: AnyJwtPayload
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }

  interface FastifyRequest {
    actor: Actor
  }
}