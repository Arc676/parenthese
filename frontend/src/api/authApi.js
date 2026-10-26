import { API_BASE_URL, apiRequest } from './client'

export async function loginUser(email, password) {
  const data = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  return data
}

// invitationToken : lien d'invitation à co-gérer un arbre, qui ouvre un compte même inscription fermée
export async function registerUser(firstName, email, password, invitationToken) {
  const data = await apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ firstName, email, password, ...(invitationToken ? { invitationToken } : {}) }),
  })

  return data
}

export async function logoutUser(token) {
  const data = await apiRequest('/auth/logout', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data
}

// confirmation : { password } pour un compte à mot de passe, { confirmEmail } pour un compte né d'une connexion OIDC
export async function deleteAccount(token, confirmation) {
  const data = await apiRequest('/auth/me', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(confirmation),
  })

  return data
}

// Profil du compte connecté (prénom compris), pour une session restaurée sur un autre appareil
export async function fetchAccountProfile(token) {
  const data = await apiRequest('/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data
}

export async function fetchLastOpenedTree(token) {
  const data = await apiRequest('/auth/me/last-tree', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data?.lastTree || null
}

export async function updateLastOpenedTree(token, payload) {
  const data = await apiRequest('/auth/me/last-tree', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data?.lastTree || null
}

// Options de l'instance : inscription ouverte ou fermée, connexion par mot de passe, fournisseur OIDC
export async function fetchAuthOptions() {
  return apiRequest('/auth/options', { method: 'GET' })
}

// Adresse qui part chez le fournisseur OIDC ; returnTo ramène sur l'arbre partagé ouvert (validé par l'API)
export function oidcStartUrl(returnTo = '/') {
  return `${API_BASE_URL}/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`
}

// Relier le fournisseur au compte connecté : un ticket de deux minutes, à usage unique, puis le départ OIDC qui le porte
export async function requestOidcLinkTicket(token) {
  const data = await apiRequest('/auth/oidc/link', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data?.ticket
}

export function oidcLinkUrl(ticket) {
  return `${API_BASE_URL}/auth/oidc/start?link=${encodeURIComponent(ticket)}`
}

// Jeton de passage reçu au retour du fournisseur, échangé une seule fois contre une session
export async function exchangeOidcCode(code) {
  return apiRequest('/auth/oidc/exchange', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}
