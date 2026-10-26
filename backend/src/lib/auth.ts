// bcrypt natif (binaire précompilé) : le calcul passe sur les fils de libuv, la boucle de l'API garde la main.
// bcryptjs calculait en JavaScript : 8 vérifications simultanées retardaient chaque requête de 0,7 s en moyenne.
// Mêmes empreintes $2a$/$2b$ : les mots de passe enregistrés restent valables.
import { hash, verify } from '@node-rs/bcrypt'

import { env } from '../config/env.js'

const HASH_ROUNDS = 12

export async function hashPassword(value: string): Promise<string> {
  return hash(value, HASH_ROUNDS)
}

export async function verifyPassword(value: string, storedHash: string): Promise<boolean> {
  return verify(value, storedHash)
}

// Un compte à mot de passe se confirme avec son mot de passe seulement si la connexion par mot de passe est ouverte.
// Avec PASSWORD_LOGIN=false, un compte relié à un fournisseur OIDC (et qui avait un mot de passe) ne peut plus le
// redonner : il se confirme par son email, comme un compte né du fournisseur, après une connexion récente.
export function confirmsWithPassword(passwordHash: string | null | undefined): boolean {
  return Boolean(passwordHash) && env.PASSWORD_LOGIN
}
