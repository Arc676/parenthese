import { apiRequest } from './client'

// Sources que ce serveur interroge (SEARCH_SOURCES) : une liste d'identifiants, vide par défaut
export async function fetchSearchSources(treeId, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/search-sources`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return Array.isArray(data?.sources) ? data.sources : []
}

export async function searchSource(treeId, sourceId, query, token) {
  const data = await apiRequest(`/trees/${encodeURIComponent(treeId)}/search-sources/${encodeURIComponent(sourceId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(query),
  })
  return Array.isArray(data?.results) ? data.results : []
}
