import { coupleBarMeta } from './elkLayout'
import { nameKinship, normalizeSex } from '../../utils/kinship/index.js'

// ============================================================
// BFS — chemin le plus court entre deux personnes
// Le graphe est bidirectionnel : person ↔ union (coupleBarMeta)
// et union ↔ enfant (layoutData.edges). Les unions sont des
// noeuds intermédiaires invisibles ; seuls les noeuds personne
// comptent comme "étapes".
// ============================================================
// persons : les personnes à jour (sexe modifié sans recalcul du placement) ; à défaut, celles du placement
export function findPathBFS(fromElkId, toElkId, layoutData, persons = null) {
  if (!layoutData || fromElkId === toElkId) return null

  // Construire l'adjacence
  const adj = new Map()
  const ensure = (id) => { if (!adj.has(id)) adj.set(id, []) }

  coupleBarMeta.forEach(({ elkId, p1Key, p2Key }) => {
    ensure(p1Key); ensure(p2Key); ensure(elkId)
    adj.get(p1Key).push({ neighbor: elkId, type: 'couple', id: elkId })
    adj.get(elkId).push({ neighbor: p1Key, type: 'couple', id: elkId })
    adj.get(p2Key).push({ neighbor: elkId, type: 'couple', id: elkId })
    adj.get(elkId).push({ neighbor: p2Key, type: 'couple', id: elkId })
  })

  if (layoutData.edges) {
    layoutData.edges.forEach(edge => {
      const src = edge.sources[0], tgt = edge.targets[0]
      ensure(src); ensure(tgt)
      adj.get(src).push({ neighbor: tgt, type: 'filiation', id: edge.id })
      adj.get(tgt).push({ neighbor: src, type: 'filiation', id: edge.id })
    })
  }

  // BFS
  const visited = new Set([fromElkId])
  const prev = new Map()
  const queue = [fromElkId]

  while (queue.length > 0) {
    const cur = queue.shift()
    if (cur === toElkId) break
    for (const link of (adj.get(cur) || [])) {
      if (!visited.has(link.neighbor)) {
        visited.add(link.neighbor)
        prev.set(link.neighbor, { from: cur, type: link.type, id: link.id })
        queue.push(link.neighbor)
      }
    }
  }

  if (!prev.has(toElkId)) return null

  // Reconstruire le chemin
  const nodePath = []
  const edgePath = []
  let cur = toElkId
  while (cur !== fromElkId) {
    nodePath.unshift(cur)
    const p = prev.get(cur)
    edgePath.unshift({ type: p.type, id: p.id })
    cur = p.from
  }
  nodePath.unshift(fromElkId)

  const personById = persons
    ? new Map(persons.map((person) => [`p-${person.id}`, person]))
    : new Map((layoutData.children || []).filter((node) => node._type === 'person').map((node) => [node.id, node._data]))
  const kinship = kinshipPath(edgePath, nodePath, (id) => personById.get(id))
  return { nodePath, edgePath, kinship, label: nameKinship(kinship) }
}

// ============================================================
// Chemin de parenté complet, à partir du chemin BFS
// On lit la direction à chaque union traversée :
//   filiation→couple = 'up' (enfant → parent)
//   couple→filiation = 'down' (parent → enfant)
//   filiation→filiation = 'sibling' (frère ou sœur)
//   couple→couple = 'spouse' (conjoint)
// Chaque pas garde la personne atteinte (sexe, année de naissance) :
// le nommage, langue par langue, est dans utils/kinship.
// ============================================================
const MOVES = { 'filiation>couple': 'up', 'couple>filiation': 'down', 'filiation>filiation': 'sibling', 'couple>couple': 'spouse' }

const personFacts = (data, id) => ({ id: data?.id ?? id, sex: normalizeSex(data?.sex), birthYear: data?.birthYear ?? null })

export function kinshipPath(edgePath, nodePath = [], personOf = () => null) {
  if (edgePath.length < 2) return null
  const steps = []
  for (let i = 0; i + 1 < edgePath.length; i += 2) {
    const move = MOVES[`${edgePath[i].type}>${edgePath[i + 1].type}`]
    const id = nodePath[i + 2]
    steps.push({ move, person: personFacts(personOf(id), id) })
  }
  return { from: personFacts(personOf(nodePath[0]), nodePath[0]), steps }
}

export function computeRelationshipLabel(edgePath, nodePath, personOf) {
  return nameKinship(kinshipPath(edgePath, nodePath, personOf))
}
