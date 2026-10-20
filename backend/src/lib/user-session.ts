import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'

import { env } from '../config/env.js'

// Session d'un compte, la même quelle que soit la façon de se connecter (mot de passe ou fournisseur OIDC)
export function signUserSession(app: FastifyInstance, user: { id: string; email: string }): string {
  return app.jwt.sign(
    {
      kind: 'user',
      sub: user.id,
      jti: randomUUID(),
      userId: user.id,
      email: user.email,
    },
    { expiresIn: env.JWT_EXPIRES_IN },
  )
}
