import { apiRequest } from './client'

// Co-gestion d'un arbre (issue #145) : gestionnaires, invitations, et la page du lien d'invitation

const auth = (token) => ({ Authorization: `Bearer ${token}` })
const tree = (treeId) => `/trees/${encodeURIComponent(treeId)}`

export function listManagers(treeId, token) {
  return apiRequest(`${tree(treeId)}/managers`, { headers: auth(token) })
}

export function inviteManager(treeId, email, token) {
  return apiRequest(`${tree(treeId)}/invitations`, { method: 'POST', headers: auth(token), body: JSON.stringify({ email }) })
}

export function renewInvitationLink(treeId, invitationId, token) {
  return apiRequest(`${tree(treeId)}/invitations/${encodeURIComponent(invitationId)}/link`, { method: 'POST', headers: auth(token) })
}

export function revokeInvitation(treeId, invitationId, token) {
  return apiRequest(`${tree(treeId)}/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE', headers: auth(token) })
}

// Retirer un co-gestionnaire (le propriétaire), ou quitter la gestion (son propre identifiant)
export function removeManager(treeId, userId, token) {
  return apiRequest(`${tree(treeId)}/managers/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: auth(token) })
}

// Sous /api comme /api/arbre/:slug : nginx ne relaie à l'API que /api (préfixe retiré), /auth et /trees
export function fetchInvitation(invitationToken) {
  return apiRequest(`/api/invitations/${encodeURIComponent(invitationToken)}`)
}

export function acceptInvitation(invitationToken, token) {
  return apiRequest(`/api/invitations/${encodeURIComponent(invitationToken)}/accept`, { method: 'POST', headers: auth(token) })
}

export function invitationUrl(invitationToken) {
  return `${window.location.origin}/invitation/${invitationToken}`
}
