export type MembershipRole = 'owner' | 'admin' | 'member'
export type TreeAccessRole = 'visitor' | 'contributor'

export type UserJwtPayload = {
  kind: 'user'
  sub: string
  jti: string
  userId: string
  email: string
  // Posé par la signature (secondes) : sert au refus des sessions antérieures à SESSIONS_NOT_BEFORE
  iat?: number
}

export type TreeAccessJwtPayload = {
  kind: 'tree_access'
  sub: string
  treeId: string
  role: TreeAccessRole
  accessVersion: number
}

// Lecture seule des médias d'un arbre, dans l'adresse des images (voir lib/tree-access.ts)
export type MediaJwtPayload = {
  kind: 'media'
  sub: string
  treeId: string
  userId?: string
  accessVersion?: number
}

// Passage d'une connexion OIDC à l'app (60 s, à usage unique, échangé sur /auth/oidc/exchange) : jamais une session
export type OidcHandoffJwtPayload = {
  kind: 'oidc_handoff'
  sub: string
  jti: string
}

// Ticket de rattachement d'une identité OIDC au compte connecté (120 s, à usage unique, porté par /auth/oidc/start) :
// jamais une session, le décodeur de l'en-tête ne retient que les sortes user et tree_access
export type OidcLinkJwtPayload = {
  kind: 'oidc_link'
  sub: string
  jti: string
}

export type AnyJwtPayload = UserJwtPayload | TreeAccessJwtPayload | MediaJwtPayload | OidcHandoffJwtPayload | OidcLinkJwtPayload

export type UserActor = {
  kind: 'user'
  userId: string
  email: string
}

export type TreeAccessActor = {
  kind: 'tree_access'
  treeId: string
  role: TreeAccessRole
  accessVersion: number
}

export type Actor = UserActor | TreeAccessActor | null
