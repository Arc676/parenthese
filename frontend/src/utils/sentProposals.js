// Propositions envoyées par la famille depuis ce navigateur, gardées jusqu'à leur relecture pour les dessiner
// en fantôme « En attente ». Ce sont ses propres changements : rien d'autre n'est gardé. Le stockage peut manquer
// (navigation privée, quota) : on dessine alors simplement sans fantômes.

const MAX_KEPT = 30
// Au-delà, une proposition jamais relue n'est plus dessinée (le relecteur l'a peut-être oubliée, pas la famille)
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000

const keyOf = (treeId) => `parenthese-propositions-${treeId}`

export function readSentProposals(treeId, now = Date.now()) {
  if (!treeId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(keyOf(treeId)) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p) => p && typeof p.sessionId === 'string' && Array.isArray(p.changes)
      && now - (Date.parse(p.createdAt) || now) < MAX_AGE_MS)
  } catch {
    return []
  }
}

function write(treeId, list) {
  try {
    if (list.length) localStorage.setItem(keyOf(treeId), JSON.stringify(list.slice(-MAX_KEPT)))
    else localStorage.removeItem(keyOf(treeId))
  } catch {
    // Stockage indisponible : pas de fantômes « En attente », rien d'autre ne change
  }
}

// Une photo posée sur l'arbre garde dans son contenu l'adresse affichée, avec le jeton médias : seul le chemin
// est gardé, l'adresse est refaite au dessin
function withoutPhotoUrl(change) {
  if (change?.entityType !== 'annotation' || typeof change.after?.content !== 'string' || !change.after.content.startsWith('{')) return change
  try {
    const { url: _url, ...rest } = JSON.parse(change.after.content)
    return { ...change, after: { ...change.after, content: JSON.stringify(rest) } }
  } catch {
    return change
  }
}

export function rememberSentProposal(treeId, proposal) {
  if (!treeId || !proposal?.sessionId) return
  const kept = { ...proposal, changes: (proposal.changes || []).map(withoutPhotoUrl) }
  write(treeId, [...readSentProposals(treeId).filter((p) => p.sessionId !== proposal.sessionId), kept])
}

export function forgetSentProposal(treeId, sessionId) {
  if (!treeId) return
  write(treeId, readSentProposals(treeId).filter((p) => p.sessionId !== sessionId))
}
