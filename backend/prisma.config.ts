import { config } from 'dotenv'
import type { PrismaConfig } from 'prisma/config'

// Configuration du CLI Prisma (generate, migrate). Depuis Prisma 7, le CLI ne lit plus .env tout seul. Seul un import
// de type vient de prisma/config : dans les images, le CLI est installé à part (/opt/prisma) et ce fichier doit se
// charger sans lui. Sans DATABASE_URL (generate pendant un build), l'adresse reste vide.
config({ quiet: true })

export default {
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
} satisfies PrismaConfig
