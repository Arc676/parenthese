// Défauts comptés sur la géométrie vraiment dessinée (traceSibship dans renderers.js) : l'union descend de
// BUS_DY sous son centre jusqu'à la ligne de fratrie (décalée de 0, 4 ou 8 px selon l'union), file à
// l'horizontale, puis descend sur chaque enfant. Les renvois (pastilles) ne sont pas dessinés.
// Tenir en phase avec busY / BUS_STRAIGHT_DX de renderers.js.
import { kinshipGenerations } from './invariants.mjs'

const BUS_DY = 100
const BUS_STRAIGHT_DX = 30
const SCREEN = 1440
const cx = (n) => n.x + n.width / 2
export function busOffset(id) { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return (Math.abs(h) % 3) * 4 }

export function computeDefects(result, coupleBarMeta, graph, referenceId = null) {
  const nodes = result.children
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kidsOf = new Map()
  const renvois = []
  for (const e of result.edges) {
    if (e._renvoi) { renvois.push(e); continue }
    if (!kidsOf.has(e.sources[0])) kidsOf.set(e.sources[0], [])
    kidsOf.get(e.sources[0]).push(e.targets[0])
  }
  const siblingsOf = new Map()
  for (const [, kids] of kidsOf) for (const k of kids) siblingsOf.set(k, kids)
  const spousesOf = new Map()
  for (const c of coupleBarMeta) {
    if (!spousesOf.has(c.p1Key)) spousesOf.set(c.p1Key, new Set())
    if (!spousesOf.has(c.p2Key)) spousesOf.set(c.p2Key, new Set())
    spousesOf.get(c.p1Key).add(c.p2Key); spousesOf.get(c.p2Key).add(c.p1Key)
  }

  // Tracé : troncs, lignes de fratrie, descentes
  const H = [], V = []
  const households = []
  for (const [uid, kids] of kidsOf) {
    const u = byId.get(uid)
    const ks = kids.map((k) => byId.get(k)).filter(Boolean)
    if (!u || !ks.length) continue
    const sx = cx(u), sy = u.y + u.height / 2, by = sy + BUS_DY + (u._railLift != null ? -6 * u._railLift : busOffset(uid))
    let l = sx, r = sx
    for (const k of ks) {
      const ex = cx(k)
      if (Math.abs(ex - sx) >= BUS_STRAIGHT_DX) { l = Math.min(l, ex); r = Math.max(r, ex) }
      V.push({ u: uid, x: ex, a: by, b: k.y })
    }
    V.push({ u: uid, x: sx, a: sy, b: by })
    if (r > l) H.push({ u: uid, y: by, a: l, b: r })
    households.push({ union: uid, enfants: ks.length, etendue: Math.round(r - l), gen: u._generation, kids: new Set(kids) })
  }
  let croisements = 0
  const endroits = new Set()
  for (const v of V) for (const h of H) {
    if (h.u === v.u) continue
    if (v.x > h.a + 1 && v.x < h.b - 1 && h.y > v.a + 1 && h.y < v.b - 1) { croisements++; endroits.add(v.u < h.u ? `${v.u}|${h.u}` : `${h.u}|${v.u}`) }
  }
  let superpositions = 0
  for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) {
    const p = H[i], q = H[j]
    if (Math.abs(p.y - q.y) < 6 && Math.min(p.b, q.b) - Math.max(p.a, q.a) > 10) superpositions++
  }
  const cables_ecran = H.filter((h) => h.b - h.a > SCREEN).length

  // Ligne de fratrie au-dessus d'un portrait étranger (ni enfant, ni conjoint d'un enfant)
  let fils_sur_etranger = 0
  for (const hh of households) {
    const h = H.find((x) => x.u === hh.union)
    if (!h) continue
    // Un seul arbre : la fratrie du conjoint d'un enfant peut se trouver sous la ligne (famille collée), pas un étranger
    const ok = new Set(hh.kids)
    for (const k of hh.kids) for (const s of (spousesOf.get(k) || [])) {
      ok.add(s)
      for (const sib of (siblingsOf.get(s) || [])) { ok.add(sib); for (const ss of (spousesOf.get(sib) || [])) ok.add(ss) }
    }
    if (nodes.some((n) => n._type === 'person' && n._generation === hh.gen + 1 && !ok.has(n.id) && cx(n) > h.a && cx(n) < h.b)) fils_sur_etranger++
  }
  const foyers_larges = households.filter((h) => h.etendue > SCREEN).length

  // Renvois : combien, et à quelle distance de parenté de la référence le plus proche
  const kin = kinshipGenerations(graph, referenceId)
  const degree = kinshipDegrees(graph, referenceId)
  const renvoi_degre_min = renvois.length ? Math.min(...renvois.map((e) => degree.get(byId.get(e.targets[0])?._data?.id) ?? 99)) : null

  // Proches à deux degrés de la référence (parents, enfants, conjoint, fratrie, grands-parents, beaux-parents…)
  // visibles dans un écran autour d'elle
  const ref = nodes.find((n) => n._type === 'person' && n._data?.id === referenceId)
  let proches = 0, proches_ecran = 0
  if (ref) {
    for (const n of nodes) {
      if (n._type !== 'person' || n === ref) continue
      const d = degree.get(n._data.id)
      if (d == null || d > 2) continue
      proches++
      if (Math.abs(cx(n) - cx(ref)) <= SCREEN / 2 && Math.abs(n._generation - ref._generation) <= 2) proches_ecran++
    }
  }
  const pires_foyers = households.sort((a, b) => b.etendue - a.etendue).slice(0, 5).map(({ union, enfants, etendue }) => ({ union, enfants, etendue }))
  return {
    renvois: renvois.length, renvoi_degre_min, croisements, endroits_croises: endroits.size, superpositions, fils_sur_etranger, cables_ecran, foyers_larges,
    proches, proches_ecran, conflits: kin.conflicts, pires_foyers,
  }
}

// Degré de parenté (nombre de liens conjoint / parent / enfant) depuis la référence
export function kinshipDegrees(graph, referenceId) {
  const adj = new Map()
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b) }
  for (const u of graph.unions) if (u.partner1Id && u.partner2Id) { add(u.partner1Id, u.partner2Id); add(u.partner2Id, u.partner1Id) }
  const unionById = new Map(graph.unions.map((u) => [u.id, u]))
  for (const f of graph.filiations) {
    const parents = f.unionId ? [unionById.get(f.unionId)?.partner1Id, unionById.get(f.unionId)?.partner2Id] : [f.parentId]
    for (const p of parents) if (p) { add(p, f.childId); add(f.childId, p) }
  }
  const d = new Map()
  if (referenceId == null) return d
  d.set(referenceId, 0)
  const queue = [referenceId]
  while (queue.length) { const cur = queue.shift(); for (const n of (adj.get(cur) || [])) if (!d.has(n)) { d.set(n, d.get(cur) + 1); queue.push(n) } }
  return d
}
