import { PrismaPg } from '@prisma/adapter-pg'

import { env } from '../config/env.js'
import { PrismaClient } from '../generated/prisma/client.js'

// Prisma 7 passe par le pilote pg. Délai de connexion de 5 s, comme le moteur de Prisma 6 (pg attend sans fin par défaut)
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5_000 }),
})
