import bcrypt from 'bcryptjs'

import { env } from '../config/env.js'

const HASH_ROUNDS = 12

export async function hashPassword(value: string): Promise<string> {
  return bcrypt.hash(value, HASH_ROUNDS)
}

export async function verifyPassword(value: string, hash: string): Promise<boolean> {
  return bcrypt.compare(value, hash)
}

// Un compte à mot de passe se confirme avec son mot de passe seulement si la connexion par mot de passe est ouverte.
// Avec PASSWORD_LOGIN=false, un compte relié à un fournisseur OIDC (et qui avait un mot de passe) ne peut plus le
// redonner : il se confirme par son email, comme un compte né du fournisseur, après une connexion récente.
export function confirmsWithPassword(passwordHash: string | null | undefined): boolean {
  return Boolean(passwordHash) && env.PASSWORD_LOGIN
}
