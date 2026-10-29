/**
 * Parents à rattacher à un nouveau frère ou une nouvelle sœur de `personId`.
 * Un lien passant par une union compte pour ses deux partenaires, avec l'identifiant de l'union.
 *
 * @param {string} personId - Personne dont on ajoute un frère ou une sœur
 * @param {Array} filiations - Liens parent-enfant du graphe courant ({ childId, parentId, unionId })
 * @param {Array} unions - Unions du graphe courant ({ id, partner1Id, partner2Id })
 * @returns {Array<{ parentId: string, unionId: string|null }>}
 */
export function getSiblingParentLinks(personId, filiations, unions) {
  const childKey = String(personId)
  const links = []
  const seenParentIds = new Set()

  const addParent = (parentId, unionId) => {
    if (parentId === null || parentId === undefined || parentId === '') return
    const key = String(parentId)
    if (seenParentIds.has(key)) return
    seenParentIds.add(key)
    links.push({ parentId: key, unionId: unionId ? String(unionId) : null })
  }

  for (const filiation of filiations || []) {
    if (String(filiation.childId) !== childKey) continue

    if (filiation.unionId) {
      const union = (unions || []).find((candidate) => String(candidate.id) === String(filiation.unionId))
      if (union) {
        addParent(union.partner1Id, union.id)
        addParent(union.partner2Id, union.id)
      }
    } else {
      addParent(filiation.parentId, null)
    }
  }

  return links
}

/**
 * Parents à rattacher à un nouvel enfant de `parentId` : quand cette personne n'a qu'une union,
 * l'enfant est celui du couple (les deux partenaires, avec l'identifiant de l'union).
 * Aucune union, ou plusieurs (on ne devine pas l'autre parent) : liste vide, l'enfant reste au seul parent.
 *
 * @param {string} parentId - Personne à qui l'on ajoute un enfant
 * @param {Array} unions - Unions du graphe courant ({ id, partner1Id, partner2Id })
 * @returns {Array<{ parentId: string, unionId: string }>}
 */
export function getCoupleParentLinks(parentId, unions) {
  const key = String(parentId)
  const own = (unions || []).filter((union) => String(union.partner1Id) === key || String(union.partner2Id) === key)
  if (own.length !== 1 || !own[0].partner1Id || !own[0].partner2Id) return []
  const unionId = String(own[0].id)
  return [{ parentId: String(own[0].partner1Id), unionId }, { parentId: String(own[0].partner2Id), unionId }]
}
