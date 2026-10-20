import { apiRequest } from './client'

export async function loginUser(email, password) {
  const data = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  return data
}

export async function registerUser(firstName, email, password) {
  const data = await apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ firstName, email, password }),
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

export async function deleteAccount(token, password) {
  const data = await apiRequest('/auth/me', {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
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

// Options de l'instance : inscription ouverte ou fermée (ALLOW_REGISTRATION côté API)
export async function fetchAuthOptions() {
  return apiRequest('/auth/options', { method: 'GET' })
}
