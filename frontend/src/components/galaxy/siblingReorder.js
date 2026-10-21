// Réordonner une fratrie dans l'arbre : logique pure (sans canvas ni React), testée à part.
// Une fratrie = les enfants reliés à une même source (union `u-…` ou parent seul `vu-…`).
import { SEPARATED_PAIR_PREFIX } from './constants'

const centerOf = (node) => node.x + node.width / 2

// Toutes les fratries réordonnables d'un placement : nodeId → { source, ids } (ids triés de gauche à droite).
// Un enfant rattaché à plusieurs sources (deux familles) n'est pas réordonnable : déplacer l'un de ses liens
// pourrait le faire changer de famille dans le placement.
export function buildSiblingGroups(layout) {
  const incoming = new Map()
  const bySource = new Map()
  for (const edge of layout?.edges || []) {
    const source = edge.sources[0]
    const child = edge.targets[0]
    incoming.set(child, (incoming.get(child) || 0) + 1)
    if (!bySource.has(source)) bySource.set(source, [])
    bySource.get(source).push(child)
  }
  const byId = new Map((layout?.children || []).map((node) => [node.id, node]))
  const groups = new Map()
  for (const [source, children] of bySource) {
    if (children.length < 2) continue
    if (children.some((id) => incoming.get(id) !== 1 || !byId.has(id))) continue
    const ids = [...children].sort((a, b) => centerOf(byId.get(a)) - centerOf(byId.get(b)))
    const group = { source, ids }
    for (const id of ids) groups.set(id, group)
  }
  return groups
}

export function moveInOrder(ids, movedId, index) {
  const rest = ids.filter((id) => id !== movedId)
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, movedId)
  return rest
}

// Place visée par la personne tenue : le nombre de milieux entre places voisines qu'elle a dépassés.
// L'hystérésis évite les allers-retours quand on hésite pile sur une frontière.
export function pickSlot(slotCenters, x, currentIndex, hysteresis = 10) {
  const mids = []
  for (let i = 0; i < slotCenters.length - 1; i += 1) mids.push((slotCenters[i] + slotCenters[i + 1]) / 2)
  const forward = mids.filter((m) => m < x - hysteresis).length
  const backward = mids.filter((m) => m < x + hysteresis).length
  if (forward > currentIndex) return forward
  if (backward < currentIndex) return backward
  return currentIndex
}

// Au-delà des bords de la fratrie, la personne suit de moins en moins le pointeur (pas de mur brutal).
export function rubberBand(x, min, max, reach = 90) {
  if (x < min) return min - reach * (1 - 1 / (1 + (min - x) / reach))
  if (x > max) return max + reach * (1 - 1 / (1 + (x - max) / reach))
  return x
}

// Un pas de ressort amorti vers 0 (Euler semi-implicite) ; dt en secondes.
export function springStep(state, dt, { stiffness = 520, dampingRatio = 0.86 } = {}) {
  const damping = 2 * dampingRatio * Math.sqrt(stiffness)
  const v = state.v + (-stiffness * state.x - damping * state.v) * dt
  return { x: state.x + v * dt, v }
}

export const isSettled = (state) => Math.abs(state.x) < 0.15 && Math.abs(state.v) < 1.5

// Les filiations qui rattachent un enfant à la source d'une fratrie
function filiationsOf(filiations, unions, source, childId) {
  const sameChild = (f) => String(f.childId) === String(childId)
  if (source.startsWith('u-')) {
    const unionId = source.slice(2)
    const union = unions.find((u) => String(u.id) === unionId)
    // Couple « séparé » propre au dessin (elkLayout) : ses deux partenaires sont dans l'identifiant
    const partners = union
      ? [union.partner1Id, union.partner2Id].filter((id) => id != null).map(String)
      : unionId.startsWith(SEPARATED_PAIR_PREFIX) ? unionId.slice(SEPARATED_PAIR_PREFIX.length).split(':') : []
    const viaUnion = filiations.filter((f) => sameChild(f) && String(f.unionId) === unionId)
    // Union reconstituée par le placement : deux liens directs vers chacun des partenaires
    return viaUnion.length ? viaUnion : filiations.filter((f) => sameChild(f) && !f.unionId && partners.includes(String(f.parentId)))
  }
  const parentId = source.slice(3)
  return filiations.filter((f) => sameChild(f) && !f.unionId && String(f.parentId) === parentId)
}

const personIdOf = (nodeId) => nodeId.slice(2)

// Corps de PUT /trees/:id/links/order : chaque enfant, dans l'ordre, avec ses liens vers la source
export function buildOrderPayload(filiations, unions, source, orderedNodeIds) {
  return orderedNodeIds.map((nodeId) => {
    const childId = personIdOf(nodeId)
    return { childId, linkIds: filiationsOf(filiations, unions, source, childId).map((f) => String(f.id)) }
  })
}

// Copie des filiations avec l'ordre de la fratrie appliqué (displayOrder 1, 2, 3…)
export function filiationsWithOrder(filiations, unions, source, orderedNodeIds) {
  const orderByFiliation = new Map()
  orderedNodeIds.forEach((nodeId, index) => {
    for (const f of filiationsOf(filiations, unions, source, personIdOf(nodeId))) orderByFiliation.set(f, index + 1)
  })
  return filiations.map((f) => (orderByFiliation.has(f) ? { ...f, displayOrder: orderByFiliation.get(f) } : f))
}
