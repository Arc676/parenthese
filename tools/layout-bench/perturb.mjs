// Stabilité : retirer une feuille (personne sans enfant) ne devrait déplacer que son foyer.
// On retire tour à tour quelques feuilles prises à des positions réparties, on recalcule, et on compte
// les nœuds qui bougent de plus de 40 px une fois la translation d'ensemble retirée.
const SEUIL = 40

export function perturbation(layoutFn, graph, referenceId = null, { picks = 5 } = {}) {
  const base = layoutFn(graph, referenceId)
  const before = new Map(base.children.map((n) => [n.id, n.x]))
  const hasKids = new Set()
  for (const e of base.edges) {
    const u = base.children.find((n) => n.id === e.sources[0])
    if (u?._data?.p1Key) { hasKids.add(u._data.p1Key); hasKids.add(u._data.p2Key) }
  }
  const leaves = base.children.filter((n) => n._type === 'person' && !n._compact && !hasKids.has(n.id))
  if (!leaves.length) return { feuilles: 0, max_bouges: 0, max_deplacement_px: 0 }
  const chosen = [...new Set(Array.from({ length: picks }, (_, i) => leaves[Math.floor((i / Math.max(1, picks - 1)) * (leaves.length - 1))]))]
  let maxMoved = 0, maxShift = 0
  for (const leaf of chosen) {
    const pid = leaf._data.id
    const g = {
      ...graph,
      persons: graph.persons.filter((p) => p.id !== pid),
      unions: graph.unions.filter((u) => u.partner1Id !== pid && u.partner2Id !== pid),
      filiations: graph.filiations.filter((f) => f.childId !== pid && f.parentId !== pid),
    }
    const after = layoutFn(g, referenceId === pid ? null : referenceId)
    const common = after.children.filter((n) => before.has(n.id))
    if (!common.length) continue
    const shift = common.reduce((s, n) => s + (n.x - before.get(n.id)), 0) / common.length
    const moved = common.filter((n) => Math.abs(n.x - before.get(n.id) - shift) > SEUIL).length
    const far = Math.max(...common.map((n) => Math.abs(n.x - before.get(n.id) - shift)))
    maxMoved = Math.max(maxMoved, moved)
    maxShift = Math.max(maxShift, far)
  }
  return { feuilles: chosen.length, max_bouges: maxMoved, max_deplacement_px: Math.round(maxShift) }
}
