import { apiRequest } from './client'
import { readContributorName } from '../utils/contributorName.js'

export async function resolveTreeBySlug(slug) {
  const data = await apiRequest(`/api/arbre/${encodeURIComponent(slug)}`)
  return {
    id: data?.tree?.id || '',
    slug: data?.tree?.slug || '',
    name: data?.tree?.name || '',
    description: data?.tree?.description || null,
  }
}

export async function unlockTreeAccess(treeId, password, userToken = '') {
  const headers = {}
  if (userToken) {
    headers.Authorization = `Bearer ${userToken}`
  }

  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/access/unlock`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password }),
  })

  return data
}

// Rattache à un compte un accès partagé déjà ouvert (jeton d'arbre en poche), sans redemander le mot de passe
export async function linkTreeAccess(treeId, accessToken, userToken) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/access/link`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ accessToken }),
  })

  return data
}

export async function fetchTreeGraph(treeId, token) {
  // Prénom retenu sur cet appareil : le serveur l'inscrit au journal des visites
  const visitorName = readContributorName()
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/graph?t=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(visitorName ? { 'X-Visitor-Name': encodeURIComponent(visitorName) } : {}),
    },
  })

  return {
    treeId: data?.treeId || treeId,
    rootPersonId: data?.rootPersonId || null,
    graph: data?.graph || { persons: [], unions: [], filiations: [], medias: [] },
    mediaToken: data?.mediaToken || '',
  }
}

export async function listTrees(token) {
  const data = await apiRequest('/trees', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return {
    trees: Array.isArray(data?.trees) ? data.trees : [],
    lastOpenedTree: data?.lastOpenedTree || null,
  }
}

export async function getTree(treeId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return {
    tree: data?.tree || null,
    role: data?.role || '',
  }
}

export async function createTree(payload, token) {
  const data = await apiRequest('/trees', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data.tree
}

export async function updateTree(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data.tree
}

export async function deleteTree(treeId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data
}

export async function createPerson(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/persons`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data.person
}

export async function updatePerson(treeId, personId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/persons/${encodeURIComponent(personId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data.person
}

export async function deletePerson(treeId, personId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/persons/${encodeURIComponent(personId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data
}

export async function createUnion(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/unions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data.union
}

export async function createParentChildLink(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data.link
}

export async function deleteUnion(treeId, unionId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/unions/${encodeURIComponent(unionId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data
}

export async function deleteParentChildLink(treeId, linkId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/links/${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data
}

export async function rotateTreePasswords(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/access/passwords`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data
}

export async function fetchSharePassword(treeId, token) {
  return apiRequest(`/trees/${encodeURIComponent(treeId)}/access/passwords`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function rememberSharePassword(treeId, password, token) {
  return apiRequest(`/trees/${encodeURIComponent(treeId)}/access/passwords/remember`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  })
}

export async function fetchTreeStats(treeId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/stats`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data?.stats || null
}

export async function fetchTreeSettings(treeId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/settings`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data?.settings || null
}

export async function updateTreeSettings(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/settings`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data?.settings || null
}

export async function listTreeAuditLogs(treeId, token, options = {}) {
  const queryParams = new URLSearchParams()

  if (options.limit) {
    queryParams.set('limit', String(options.limit))
  }

  if (options.offset !== undefined && options.offset !== null) {
    queryParams.set('offset', String(options.offset))
  }

  if (options.action) {
    queryParams.set('action', options.action)
  }

  const query = queryParams.toString()
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/audit${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return {
    logs: Array.isArray(data?.logs) ? data.logs : [],
    nextOffset: typeof data?.nextOffset === 'number' ? data.nextOffset : null,
  }
}

// Journal des visites (administrateurs de l'arbre)
export async function listTreeVisits(treeId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/visits`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return {
    summary: data?.summary || { last7: { visits: 0, visitors: 0 }, last30: { visits: 0, visitors: 0 } },
    recent: Array.isArray(data?.recent) ? data.recent : [],
  }
}

export async function submitContributionSession(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/contributions/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data
}

export async function listContributionSessions(treeId, token, status = 'pending') {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/contributions/sessions${query}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return Array.isArray(data?.sessions) ? data.sessions : []
}

export async function reviewContributionSession(treeId, sessionId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/contributions/sessions/${encodeURIComponent(sessionId)}/review`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data
}

export async function uploadAnnotationPhoto(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/annotation-photos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data // { photoId, photoPath }
}

export async function uploadPersonMedia(treeId, personId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/persons/${encodeURIComponent(personId)}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data.media
}

export async function reorderPersonMedia(treeId, personId, orderedMediaIds, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/persons/${encodeURIComponent(personId)}/media/reorder`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderedMediaIds }),
  })

  return data
}

export async function deletePersonMedia(treeId, personId, mediaId, token) {
  const data = await apiRequest(
    `/trees/${encodeURIComponent(treeId)}/persons/${encodeURIComponent(personId)}/media/${encodeURIComponent(mediaId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  return data
}

export async function uploadPersonAvatar(treeId, personId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/persons/${encodeURIComponent(personId)}/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data
}

export async function deletePersonAvatar(treeId, personId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/persons/${encodeURIComponent(personId)}/avatar`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  return data
}

export async function batchAnnotations(treeId, payload, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/annotations/batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  return data
}

export async function exportGedcom(treeId, token) {
  const { API_BASE_URL } = await import('./client')
  const resp = await fetch(`${API_BASE_URL}/trees/${encodeURIComponent(treeId)}/export/gedcom`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) {
    throw new Error('export_failed')
  }
  const blob = await resp.blob()
  const disposition = resp.headers.get('Content-Disposition') ?? ''
  const filenameMatch = disposition.match(/filename="([^"]+)"/)
  const filename = filenameMatch ? filenameMatch[1] : 'arbre.ged'
  return { blob, filename }
}

export async function importGedcom(treeId, fileContent, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/import/gedcom`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content: fileContent }),
  })
  return data
}
