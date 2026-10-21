// Invariants d'un placement : ce qui doit valoir zéro, sinon le placement est faux (pas « moins beau », faux).
// Calculés sans écran, depuis le graphe d'entrée et le placement produit. La génération de parenté est
// recalculée ici, indépendamment du code de production, pour pouvoir le contredire.
import { PERSON_W, UNION_W } from '../../frontend/src/components/galaxy/constants.js'

const cx = (n) => n.x + n.width / 2

// Génération de parenté depuis une référence : conjoint 0, parent −1, enfant +1, en largeur.
// Renvoie gen (Map personId → entier), conflits (arêtes qui contredisent), et le nombre de familles non reliées.
export function kinshipGenerations(graph, referenceId = null) {
  const adj = new Map()
  const add = (a, b, w) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, w]) }
  const ids = new Set(graph.persons.map((p) => p.id))
  for (const u of graph.unions) if (ids.has(u.partner1Id) && ids.has(u.partner2Id)) { add(u.partner1Id, u.partner2Id, 0); add(u.partner2Id, u.partner1Id, 0) }
  const unionById = new Map(graph.unions.map((u) => [u.id, u]))
  for (const f of graph.filiations) {
    const parents = f.unionId ? [unionById.get(f.unionId)?.partner1Id, unionById.get(f.unionId)?.partner2Id] : [f.parentId]
    for (const p of parents) if (p && ids.has(p) && ids.has(f.childId)) { add(p, f.childId, 1); add(f.childId, p, -1) }
  }
  const gen = new Map()
  const conflicts = new Set()
  const component = new Map()
  let components = 0
  const visit = (start) => {
    const queue = [start]
    gen.set(start, 0)
    component.set(start, components)
    while (queue.length) {
      const cur = queue.shift()
      for (const [nxt, w] of (adj.get(cur) || [])) {
        const v = gen.get(cur) + w
        if (!gen.has(nxt)) { gen.set(nxt, v); component.set(nxt, components); queue.push(nxt) }
        else if (gen.get(nxt) !== v) conflicts.add(cur < nxt ? `${cur}|${nxt}` : `${nxt}|${cur}`)
      }
    }
    components++
  }
  if (referenceId != null && ids.has(referenceId)) visit(referenceId)
  for (const p of graph.persons) if (!gen.has(p.id)) visit(p.id)
  return { gen, conflicts: conflicts.size, components, component }
}

// Parents par le sang de la référence : tout ce qu'on atteint par des liens parent/enfant seulement
export function bloodRelatives(graph, referenceId) {
  const adj = new Map()
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b) }
  const unionById = new Map(graph.unions.map((u) => [u.id, u]))
  for (const f of graph.filiations) {
    const parents = f.unionId ? [unionById.get(f.unionId)?.partner1Id, unionById.get(f.unionId)?.partner2Id] : [f.parentId]
    for (const p of parents) if (p) { add(p, f.childId); add(f.childId, p) }
  }
  const seen = new Set()
  if (referenceId == null) return seen
  const queue = [referenceId]
  seen.add(referenceId)
  while (queue.length) { const cur = queue.shift(); for (const n of (adj.get(cur) || [])) if (!seen.has(n)) { seen.add(n); queue.push(n) } }
  return seen
}

const birthYear = (p) => { const raw = p?.birthYear ?? p?.birthDate; const y = raw != null ? parseInt(String(raw).slice(0, 4), 10) : NaN; return Number.isFinite(y) ? y : null }

export function checkInvariants(result, coupleBarMeta, graph, referenceId = null) {
  const nodes = result.children
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const persons = nodes.filter((n) => n._type === 'person')
  const byGen = new Map()
  for (const n of nodes) { if (!byGen.has(n._generation)) byGen.set(n._generation, []); byGen.get(n._generation).push(n) }

  // Chevauchements sur une rangée (les unions de largeur nulle et les petits conjoints collés sont exclus)
  let chevauchements = 0
  for (const list of byGen.values()) {
    const solid = list.filter((n) => n.width > 0 && !n._compact).sort((a, b) => a.x - b.x)
    for (let i = 1; i < solid.length; i++) if (solid[i].x < solid[i - 1].x + solid[i - 1].width - 0.5) chevauchements++
  }

  // Couples : adjacents et sur la même rangée
  let couples_separes = 0, couples_rangee = 0
  const maxAdj = PERSON_W + UNION_W + 2 * 40 + 1
  const spousesOf = new Map()
  for (const c of coupleBarMeta) {
    const p1 = byId.get(c.p1Key), p2 = byId.get(c.p2Key)
    if (!p1 || !p2) continue
    if (!spousesOf.has(p1.id)) spousesOf.set(p1.id, new Set())
    if (!spousesOf.has(p2.id)) spousesOf.set(p2.id, new Set())
    spousesOf.get(p1.id).add(p2.id); spousesOf.get(p2.id).add(p1.id)
    if (p1._generation !== p2._generation) couples_rangee++
    else if (Math.abs(p1.x - p2.x) > maxAdj) couples_separes++
  }

  // Fratries : contiguës (seuls les frères, sœurs et leurs conjoints entre le premier et le dernier) et dans l'ordre choisi
  const kidsOf = new Map()
  const siblingsOf = new Map()
  for (const e of result.edges) {
    if (e._renvoi) continue
    if (!kidsOf.has(e.sources[0])) kidsOf.set(e.sources[0], [])
    kidsOf.get(e.sources[0]).push(e)
  }
  for (const edges of kidsOf.values()) for (const e of edges) siblingsOf.set(e.targets[0], edges.map((x) => x.targets[0]))
  const parentsOf = new Set(result.edges.map((e) => e.targets[0]))
  let fratries_coupees = 0, fratries_desordre = 0
  for (const edges of kidsOf.values()) {
    const kids = edges.map((e) => byId.get(e.targets[0])).filter(Boolean)
    if (kids.length < 2) continue
    // Un seul arbre : la famille du conjoint d'un enfant (sa fratrie, leurs conjoints) se colle à lui, elle peut
    // donc se trouver entre deux frères. Seule une personne sans ce lien coupe la fratrie.
    const allowed = new Set(kids.map((k) => k.id))
    for (const k of kids) for (const s of (spousesOf.get(k.id) || [])) {
      allowed.add(s)
      for (const sib of (siblingsOf.get(s) || [])) { allowed.add(sib); for (const ss of (spousesOf.get(sib) || [])) allowed.add(ss) }
    }
    const lo = Math.min(...kids.map((k) => k.x)), hi = Math.max(...kids.map((k) => k.x))
    const gen = kids[0]._generation
    if ((byGen.get(gen) || []).some((n) => n._type !== 'union' && !allowed.has(n.id) && n.x > lo && n.x < hi)) fratries_coupees++
    // Ordre choisi, de gauche à droite, ou en miroir (famille attachée à un conjoint, retournée vers lui)
    // Un enfant dont le conjoint a ses parents dans l'arbre va au bout de la fratrie (sa belle-famille se colle à
    // lui) : l'ordre choisi ne vaut que pour les autres
    const hasInLaws = (id) => [...(spousesOf.get(id) || [])].some((s) => parentsOf.has(s))
    const byX = [...edges].filter((e) => !hasInLaws(e.targets[0])).sort((a, b) => cx(byId.get(a.targets[0])) - cx(byId.get(b.targets[0])))
    const orders = byX.map((e) => e._displayOrder).filter((o) => Number.isFinite(o))
    const ascending = orders.every((o, i) => i === 0 || o >= orders[i - 1])
    const descending = orders.every((o, i) => i === 0 || o <= orders[i - 1])
    if (!ascending && !descending) fratries_desordre++
  }

  // Rangées = génération de parenté (décalage calé par famille non reliée)
  const kin = kinshipGenerations(graph, referenceId)
  const deltas = new Map()
  for (const n of persons) {
    const k = kin.gen.get(n._data?.id)
    if (k == null) continue
    const comp = kin.component.get(n._data.id)
    if (!deltas.has(comp)) deltas.set(comp, new Map())
    const d = n._generation - k
    deltas.get(comp).set(d, (deltas.get(comp).get(d) || 0) + 1)
  }
  const offsetOf = new Map()
  for (const [comp, hist] of deltas) offsetOf.set(comp, [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0])
  let rangees_fausses = 0
  for (const n of persons) {
    const k = kin.gen.get(n._data?.id)
    if (k == null) continue
    if (n._generation - k !== offsetOf.get(kin.component.get(n._data.id))) rangees_fausses++
  }

  // Années de naissance : la médiane par rangée doit monter (rangées d'au moins 3 personnes datées)
  const years = new Map()
  for (const n of persons) { const y = birthYear(n._data); if (y == null) continue; if (!years.has(n._generation)) years.set(n._generation, []); years.get(n._generation).push(y) }
  const medians = [...years.entries()].filter(([, ys]) => ys.length >= 3).sort((a, b) => a[0] - b[0]).map(([, ys]) => { ys.sort((a, b) => a - b); return ys[Math.floor(ys.length / 2)] })
  let annees_descendantes = 0
  for (let i = 1; i < medians.length; i++) if (medians[i] < medians[i - 1]) annees_descendantes++

  // Renvois sur la ligne de sang de la référence
  const blood = bloodRelatives(graph, referenceId)
  const renvois_sang = result.edges.filter((e) => e._renvoi && blood.has(byId.get(e.targets[0])?._data?.id)).length

  return { chevauchements, couples_separes, couples_rangee, fratries_coupees, fratries_desordre, rangees_fausses, conflits: kin.conflicts, annees_descendantes, renvois_sang }
}

// Les invariants durs : ceux qui font échouer un test. Les conflits de parenté sont une propriété des données,
// les renvois sur la ligne de sang relèvent du placement en X (étape à part).
export const HARD = ['chevauchements', 'couples_separes', 'couples_rangee', 'fratries_coupees', 'fratries_desordre', 'rangees_fausses', 'annees_descendantes']
