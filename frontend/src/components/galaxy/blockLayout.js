import { computeLayout, componentOrderPerGen, chainGap } from './elkLayout'

// ============================================================
// Layout par blocs familiaux (Reingold-Tilford adapté aux couples)
//
// S'appuie sur computeLayout pour tout ce qui n'est pas en cause
// (normalisation des filiations, rangées, chaînes de couples,
// coupleBarMeta, componentOrderPerGen) et ne recalcule que le X.
//
//   Un bloc = une chaîne de couples (même rangée) + les blocs de ses
//   enfants imbriqués en dessous, la chaîne centrée au-dessus. Fratries
//   contiguës et parents centrés par construction.
//
//   Un seul arbre. La famille d'un conjoint (ses parents, sa fratrie,
//   ses ancêtres) se colle à lui, au-dessus et de son côté, en poussant
//   les voisins pour faire la place : jamais posée dans un trou ailleurs.
//   Le conjoint est tourné vers l'extérieur de sa fratrie pour que sa
//   famille ne passe pas au-dessus des frères et sœurs.
//
//   Le sang de la référence gagne : les lignées de la personne de
//   référence sont dessinées d'abord, les familles des pièces rapportées
//   s'y attachent. Une famille reliée deux fois (cousins qui se marient,
//   deux grandes lignées de la référence) n'est dessinée qu'une fois :
//   l'autre filiation devient un renvoi si son fil croiserait une famille.
//
//   L'ordre ne dépend jamais des effectifs : rangée, année de naissance,
//   identifiant. Ajouter une personne ne bouge que son foyer.
//
// Banc, archétypes et témoins : tools/layout-bench/.
// ============================================================

const NODE_SPACING = 30
const FAMILY_GAP = 60
// Au-delà de cet écart entre la place idéale d'une famille de conjoint et la première place libre, on ne la colle pas
const DETACH_PX = 1440

// Le fil d'une filiation union → enfant : une personne d'une autre famille, sur la ligne de l'enfant,
// entre l'aplomb de l'union et l'enfant, est croisée. Frères et sœurs et leurs conjoint(e)s ne comptent pas
// (un petit conjoint collé à un frère faisait passer le fil en pastille).
export function filCroiseAutreFamille(nodes, childrenOfUnion, spouseKeysOf, u, c) {
  const byIdLocal = new Map(nodes.map(n => [n.id, n]))
  const kid = byIdLocal.get(c)
  const cx = (id) => byIdLocal.get(id).x + byIdLocal.get(id).width / 2
  const fratrie = [...new Set([c, ...(childrenOfUnion.get(u) || [])])]
  const excluded = new Set([...fratrie, ...fratrie.flatMap(k => [...(spouseKeysOf.get(k) || [])])])
  const lo = Math.min(cx(u), cx(c)), hi = Math.max(cx(u), cx(c))
  return nodes.some(n => n._type === 'person' && n._generation === kid._generation && !excluded.has(n.id)
    && n.x + n.width > lo && n.x < hi)
}

// Contours : par rangée, une liste d'intervalles [gauche, droite] triés et fusionnés
function addInterval(list, l, r) {
  const out = []
  let nl = l, nr = r, inserted = false
  for (const [a, b] of list) {
    if (b < nl - 1) { out.push([a, b]); continue }
    if (a > nr + 1) { if (!inserted) { out.push([nl, nr]); inserted = true } out.push([a, b]); continue }
    nl = Math.min(nl, a); nr = Math.max(nr, b)
  }
  if (!inserted) out.push([nl, nr])
  return out
}
function mergeRows(target, source, dx) {
  for (const [g, list] of source) {
    let cur = target.get(g) || []
    for (const [l, r] of list) cur = addInterval(cur, l + dx, r + dx)
    target.set(g, cur)
  }
}
const extentOf = (rows) => {
  let l = Infinity, r = -Infinity
  for (const list of rows.values()) for (const [a, b] of list) { l = Math.min(l, a); r = Math.max(r, b) }
  return [l, r]
}
const overlaps = (l, r, list, gap) => list.some(([a, b]) => l < b + gap && r > a - gap)

export function computeBlockLayout(graphData = null, referenceId = null) {
  const result = computeLayout(graphData, referenceId)
  const nodes = result.children
  const byId = new Map(nodes.map(n => [n.id, n]))

  // Chaînes de couples (composantes d'une rangée) telles que computeLayout les a ordonnées
  const chainOf = new Map()
  const chains = []
  for (const gen of [...componentOrderPerGen.keys()].sort((a, b) => a - b)) {
    for (const ids of componentOrderPerGen.get(gen)) {
      const chain = [...ids]
      chains.push(chain)
      for (const id of chain) chainOf.set(id, chain)
    }
  }
  const genOf = (chain) => byId.get(chain[0])._generation

  const childrenOfUnion = new Map()
  const parentUnionOf = new Map()
  for (const e of result.edges) {
    const u = e.sources[0], c = e.targets[0]
    if (!childrenOfUnion.has(u)) childrenOfUnion.set(u, [])
    childrenOfUnion.get(u).push(c)
    if (!parentUnionOf.has(c)) parentUnionOf.set(c, u)
  }
  // Fratrie dans l'ordre choisi par la famille (displayOrder) ; à ordre égal, l'ordre d'arrivée
  // est gardé (tri stable), donc un arbre jamais réordonné ne bouge pas
  const toOrder = (v) => (Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER)
  const edgeOrder = new Map(result.edges.map(e => [`${e.sources[0]}>${e.targets[0]}`, toOrder(e._displayOrder)]))
  for (const [u, kids] of childrenOfUnion) kids.sort((a, b) => edgeOrder.get(`${u}>${a}`) - edgeOrder.get(`${u}>${b}`))
  const hasParents = (chain) => chain.some(id => parentUnionOf.has(id))

  // Ligne de sang de la référence : tout ce qu'on atteint par les seuls liens parent / enfant
  const unionsOfPerson = new Map()
  for (const n of nodes) {
    if (n._type !== 'union') continue
    for (const k of [n._data?.p1Key, n._data?.p2Key]) {
      if (!k) continue
      if (!unionsOfPerson.has(k)) unionsOfPerson.set(k, [])
      unionsOfPerson.get(k).push(n.id)
    }
  }
  const blood = new Set()
  const referenceKey = result.referenceId != null ? `p-${result.referenceId}` : null
  if (referenceKey && byId.has(referenceKey)) {
    // On ne monte que depuis la référence et ses ancêtres (jamais depuis un descendant : son autre
    // parent est une pièce rapportée), puis on descend depuis chacun d'eux
    const up = [referenceKey]
    blood.add(referenceKey)
    while (up.length) {
      const pu = parentUnionOf.get(up.shift())
      if (!pu) continue
      for (const p of [byId.get(pu)?._data?.p1Key, byId.get(pu)?._data?.p2Key]) {
        if (p && byId.get(p)?._type === 'person' && !blood.has(p)) { blood.add(p); up.push(p) }
      }
    }
    const down = [...blood]
    while (down.length) {
      const id = down.shift()
      for (const u of (unionsOfPerson.get(id) || [])) for (const k of (childrenOfUnion.get(u) || [])) if (!blood.has(k)) { blood.add(k); down.push(k) }
    }
  }
  const isBloodChain = (chain) => chain.some(id => blood.has(id))

  const gapAfter = (chain, i) => chainGap(byId.get(chain[i]), byId.get(chain[i + 1]), NODE_SPACING)
  const chainWidth = (chain) => chain.reduce((s, id, i) => s + byId.get(id).width + (i < chain.length - 1 ? gapAfter(chain, i) : 0), 0)
  const chainOffsets = (chain) => {
    const offsets = new Map()
    let x = 0
    chain.forEach((id, i) => { offsets.set(id, x); x += byId.get(id).width + (i < chain.length - 1 ? gapAfter(chain, i) : 0) })
    return offsets
  }

  // La chaîne la plus haute d'une famille : on remonte de parents en parents
  function topChainOf(chain) {
    let cur = chain
    const seen = new Set()
    while (!seen.has(cur)) {
      seen.add(cur)
      const m = cur.find(id => parentUnionOf.has(id))
      if (!m) break
      cur = chainOf.get(parentUnionOf.get(m))
    }
    return cur
  }

  // Un couple « enfant + pièce rapportée » se tourne vers l'extérieur de la fratrie : la pièce rapportée
  // à gauche dans la moitié gauche, à droite dans la moitié droite, pour que sa famille se pose à côté
  function orient(chain, kid, side) {
    if (chain.length !== 3) return
    const spouse = chain[0] === kid ? chain[2] : chain[0]
    if (chain[1] !== chain.find(id => byId.get(id)._type === 'union') || !parentUnionOf.has(spouse)) return
    if ((side < 0 && chain[0] !== spouse) || (side > 0 && chain[2] !== spouse)) chain.reverse()
  }

  const pos = new Map()
  const placed = new Set()
  const externalEdges = new Set() // `${union}>${enfant}` : enfant dessiné sous une autre lignée
  const detached = [] // familles qu'on n'a pas pu coller à leur enfant (trop loin) : posées à part, renvoi
  const attachedEdges = new Set() // `${union}>${enfant}` : fil d'une famille collée à son enfant, toujours dessiné

  // Imbrique des blocs de gauche à droite, rangée par rangée
  function packBlocks(blocks, gap) {
    const acc = new Map()
    const xs = []
    for (const b of blocks) {
      let off = 0
      for (const [g, list] of b.rows) {
        const a = acc.get(g)
        if (a?.length) off = Math.max(off, a[a.length - 1][1] + gap - list[0][0])
      }
      xs.push(off)
      mergeRows(acc, b.rows, off)
    }
    return { xs, rows: acc }
  }

  // Décale un bloc depuis sa position idéale, du côté demandé, jusqu'au-delà de toute l'étendue de `rows`
  // sur les rangées partagées : la famille d'un conjoint se pose au bout de la fratrie, jamais dans un trou
  function pushOutside(blockRows, ideal, rows, side, gap) {
    let d = ideal
    for (const [g, list] of blockRows) {
      const occ = rows.get(g)
      if (!occ?.length) continue
      const l = list[0][0], r = list[list.length - 1][1]
      const ol = occ[0][0], or = occ[occ.length - 1][1]
      if (side > 0) d = Math.max(d, or + gap - l)
      else d = Math.min(d, ol - gap - r)
    }
    return d
  }

  // Place fantôme d'un enfant déjà dessiné ailleurs : il garde sa place dans l'ordre de la fratrie et
  // dans le centrage des parents, sans occuper de contour (c'est l'enfant réel qui l'occupe)
  const ghostBlock = (kid) => {
    const n = byId.get(kid)
    return { ghost: true, kid, rows: new Map([[n._generation, [[0, n.width]]]]), members: new Set(), external: [], gen: n._generation, chain: [0, n.width], rel: () => null, width: n.width, place() {} }
  }

  // Famille attachée à un conjoint : l'enfant à coller (ancre) doit finir au bout de sa fratrie, du côté du
  // couple. Si l'ordre choisi l'en empêche, la fratrie est dessinée en miroir (du dernier au premier).
  let anchor = null // { kid, end: 'left' | 'right' }

  // `outer` : côté extérieur hérité de la lignée (−1 gauche, +1 droite). Les belles-familles d'une branche vont
  // toutes du même côté, celui où la branche est au bord de l'arbre, pour ne pas se poser entre deux familles.
  function buildBlock(chain, ownerUnion = null, outer = 0) {
    placed.add(chain)
    const gen = genOf(chain)
    const childBlocks = []
    const external = []
    const kidsOfChain = []
    for (const id of chain) {
      if (byId.get(id)._type !== 'union') continue
      for (const k of (childrenOfUnion.get(id) || [])) kidsOfChain.push({ unionId: id, kid: k })
    }
    if (anchor && kidsOfChain.length > 1 && kidsOfChain.some(k => k.kid === anchor.kid)) {
      const idx = kidsOfChain.findIndex(k => k.kid === anchor.kid)
      if ((anchor.end === 'right' && idx === 0) || (anchor.end === 'left' && idx === kidsOfChain.length - 1)) kidsOfChain.reverse()
      anchor = null
    }
    kidsOfChain.forEach(({ unionId, kid }, i) => {
      const kc = chainOf.get(kid)
      if (placed.has(kc)) {
        external.push({ kid, unionId })
        externalEdges.add(`${unionId}>${kid}`)
        childBlocks.push(ghostBlock(kid))
        return
      }
      const side = outer || (i < (kidsOfChain.length - 1) / 2 ? -1 : 1)
      childBlocks.push(buildBlock(kc, unionId, side))
    })
    // Un enfant dont le conjoint amène sa famille va au bout de la fratrie, de son côté : sa belle-famille
    // se colle à lui sans survoler ses frères et sœurs. L'ordre de naissance s'efface pour lui (choix du 19/10).
    const sideOf = (b) => {
      if (b.ghost || !b.pending?.length) return 0
      const left = b.pending.some(p => p.side < 0), right = b.pending.some(p => p.side > 0)
      return left && !right ? -1 : right && !left ? 1 : 0
    }
    const ordered = [...childBlocks.filter(b => sideOf(b) < 0), ...childBlocks.filter(b => sideOf(b) === 0), ...childBlocks.filter(b => sideOf(b) > 0)]
    childBlocks.length = 0
    childBlocks.push(...ordered)
    const packed = packBlocks(childBlocks, FAMILY_GAP)
    const rows = new Map()
    childBlocks.forEach((b, i) => { if (!b.ghost) mergeRows(rows, b.rows, packed.xs[i]) })

    // Familles des conjoints des enfants (construites par chaque enfant, voir plus bas) : posées au-delà du
    // bout de la fratrie entière, du côté du conjoint, la plus proche du couple d'abord. Jamais entre deux frères.
    const attachments = []
    const pending = []
    childBlocks.forEach((b, i) => { for (const p of (b.pending || [])) pending.push({ ...p, anchorX: packed.xs[i] + b.rel(p.anchorId) }) })
    for (const side of [1, -1]) {
      const list = pending.filter(p => p.side === side).sort((a, b) => side > 0 ? b.anchorX - a.anchorX : a.anchorX - b.anchorX)
      for (const p of list) {
        const at = p.block.rel(p.anchorId)
        const ideal = at == null ? p.anchorX - p.block.width / 2 : p.anchorX - at
        const x = pushOutside(p.block.rows, ideal, rows, side, FAMILY_GAP)
        if (Math.abs(x - ideal) > DETACH_PX) { detached.push(p.block); continue }
        attachedEdges.add(`${parentUnionOf.get(p.anchorId)}>${p.anchorId}`)
        attachments.push({ block: p.block, x })
        mergeRows(rows, p.block.rows, x)
      }
    }

    // Familles des conjoints de la chaîne pas encore dessinées : construites entières depuis leur ancêtre
    // le plus haut, puis remises au bloc du dessus qui les pose au bout de la fratrie, du côté du conjoint.
    // Le couple se tourne vers cette famille (conjoint du côté où elle se pose). Une famille déjà dessinée
    // (reliée deux fois) ne l'est pas une seconde fois : la filiation reste externe, renvoi si son fil croise.
    const ownPending = []
    for (const id of [...chain]) {
      if (byId.get(id)._type !== 'person') continue
      const pu = parentUnionOf.get(id)
      if (!pu || pu === ownerUnion) continue
      const pc = chainOf.get(pu)
      if (placed.has(pc)) continue
      const top = topChainOf(pc)
      if (placed.has(top)) continue
      const side = outer || (chain.indexOf(id) < chain.length / 2 ? -1 : 1)
      const saved = anchor
      anchor = { kid: id, end: side < 0 ? 'right' : 'left' }
      const block = buildBlock(top, null, side)
      anchor = saved
      ownPending.push({ block, anchorId: id, side })
      if (chain.length === 3) orient(chain, chain[0] === id ? chain[2] : chain[0], side)
    }

    // Chaîne centrée sur la rangée de ses enfants directs (fantômes compris), décalée au plus près si une
    // famille de conjoint occupe déjà cette rangée
    const rowW = chainWidth(chain)
    const offsets = chainOffsets(chain)
    let rowX = 0
    if (childBlocks.length) {
      const kidRowL = Math.min(...childBlocks.map((b, i) => packed.xs[i] + b.chain[0]))
      const kidRowR = Math.max(...childBlocks.map((b, i) => packed.xs[i] + b.chain[1]))
      rowX = (kidRowL + kidRowR) / 2 - rowW / 2
      const obstacles = rows.get(gen) || []
      if (overlaps(rowX, rowX + rowW, obstacles, FAMILY_GAP)) {
        const candidates = obstacles.flatMap(([l, r]) => [r + FAMILY_GAP, l - FAMILY_GAP - rowW])
          .filter(x => !overlaps(x, x + rowW, obstacles, FAMILY_GAP))
        if (candidates.length) rowX = candidates.reduce((best, x) => (Math.abs(x - rowX) < Math.abs(best - rowX) ? x : best))
      }
    }
    mergeRows(rows, new Map([[gen, [[rowX, rowX + rowW]]]]), 0)
    const members = new Set(chain)
    for (const b of childBlocks) { for (const m of b.members) members.add(m); external.push(...b.external) }
    for (const a of attachments) { for (const m of a.block.members) members.add(m); external.push(...a.block.external) }
    const ghosts = new Map()
    childBlocks.forEach((b, i) => { if (b.ghost) ghosts.set(b.kid, packed.xs[i]) })

    // Une chaîne sans bloc au-dessus (racine) pose elle-même ses familles de conjoints, au bout de sa propre étendue
    if (ownerUnion == null) {
      for (const p of ownPending) {
        const at = p.block.rel(p.anchorId)
        const anchorX = rowX + offsets.get(p.anchorId)
        const ideal = at == null ? anchorX - p.block.width / 2 : anchorX - at
        const x = pushOutside(p.block.rows, ideal, rows, p.side, FAMILY_GAP)
        attachedEdges.add(`${parentUnionOf.get(p.anchorId)}>${p.anchorId}`)
        attachments.push({ block: p.block, x })
        mergeRows(rows, p.block.rows, x)
        for (const m of p.block.members) members.add(m)
        external.push(...p.block.external)
      }
      ownPending.length = 0
    }

    // Origine du bloc au bord gauche de son contour
    const [minL] = extentOf(rows)
    for (const [g, list] of rows) rows.set(g, list.map(([l, r]) => [l - minL, r - minL]))
    rowX -= minL
    const kidXs = packed.xs.map(x => x - minL)
    for (const [k, x] of ghosts) ghosts.set(k, x - minL)
    for (const a of attachments) a.x -= minL

    const rel = (id) => {
      if (offsets.has(id)) return rowX + offsets.get(id)
      if (ghosts.has(id)) return ghosts.get(id)
      for (let i = 0; i < childBlocks.length; i++) {
        if (childBlocks[i].ghost) continue
        const r = childBlocks[i].rel(id)
        if (r != null) return kidXs[i] + r
      }
      for (const a of attachments) { const r = a.block.rel(id); if (r != null) return a.x + r }
      return null
    }
    return {
      rows, members, external, gen, rel, pending: ownPending,
      chain: [rowX, rowX + rowW],
      get width() { return extentOf(rows)[1] },
      place(x0) {
        for (const id of chain) pos.set(id, x0 + rowX + offsets.get(id))
        childBlocks.forEach((b, i) => b.place(x0 + kidXs[i]))
        attachments.forEach(a => a.block.place(x0 + a.x))
      },
    }
  }

  // Racines : chaînes sans parents, le sang de la référence d'abord, puis par rangée, année de naissance, identifiant.
  // Jamais par effectifs : ajouter une personne ne change pas l'ordre des lignées.
  const birthYearOf = (chain) => Math.min(...chain.map(id => {
    const d = byId.get(id)._data
    const raw = d?.birthYear ?? d?.birthDate
    const y = raw != null ? parseInt(String(raw).slice(0, 4), 10) : NaN
    return Number.isFinite(y) ? y : 9999
  }))
  const roots = chains.filter(c => !hasParents(c)).sort((a, b) => (
    (isBloodChain(b) - isBloodChain(a)) || genOf(a) - genOf(b) || birthYearOf(a) - birthYearOf(b) || String(a[0]).localeCompare(String(b[0]))
  ))
  const free = []
  for (const r of roots) if (!placed.has(r)) free.push(buildBlock(r))
  for (const c of chains) if (!placed.has(c)) free.push(buildBlock(c))
  free.push(...detached)
  const forest = packBlocks(free, FAMILY_GAP * 2)
  free.forEach((b, i) => b.place(forest.xs[i]))

  // Réinjecter le X, normalisé à 0 ; Y inchangé (rangées)
  let minX = Infinity
  for (const n of nodes) if (pos.has(n.id)) minX = Math.min(minX, pos.get(n.id))
  for (const n of nodes) if (pos.has(n.id)) n.x = pos.get(n.id) - minX

  // Arête vers un enfant dessiné sous l'autre lignée : renvoi (voir drawFiliations) seulement si le fil
  // croise une autre famille. Plusieurs renvois sous la même union : pastilles empilées (_renvoiIndex)
  // Le fil descend de l'union puis file sur la ligne de la fratrie jusqu'à l'enfant (traceSibship) :
  // il ne traverse une autre famille que si une personne de cette famille se trouve sur cette ligne,
  // entre l'aplomb de l'union et l'enfant. Frères et sœurs et conjoint(e)s de l'enfant ne comptent pas.
  const spouseKeysOf = new Map()
  for (const n of nodes) {
    if (n._type !== 'union' || !n._data?.p1Key || !n._data?.p2Key) continue
    const { p1Key, p2Key } = n._data
    if (!spouseKeysOf.has(p1Key)) spouseKeysOf.set(p1Key, new Set())
    if (!spouseKeysOf.has(p2Key)) spouseKeysOf.set(p2Key, new Set())
    spouseKeysOf.get(p1Key).add(p2Key)
    spouseKeysOf.get(p2Key).add(p1Key)
  }
  const crossesOtherFamily = (u, c) => filCroiseAutreFamille(nodes, childrenOfUnion, spouseKeysOf, u, c)
  const renvoisByUnion = new Map()
  for (const e of result.edges) {
    const u = e.sources[0], c = e.targets[0]
    if (!externalEdges.has(`${u}>${c}`) || attachedEdges.has(`${u}>${c}`) || !crossesOtherFamily(u, c)) continue
    e._renvoi = true
    e._renvoiIndex = renvoisByUnion.get(u) || 0
    renvoisByUnion.set(u, e._renvoiIndex + 1)
  }

  // Lignes de fratrie emboîtées, par rangée. Une ligne qui en contient une autre passe au-dessus d'elle.
  // Deux lignes qui se chevauchent sans s'emboîter : celle dont l'union est en dehors de l'autre passe
  // au-dessus (son fil n'entre dans l'autre famille qu'une fois, à l'enfant collé), sinon la plus longue.
  // _railLift plus grand = plus haut ; 0 = la ligne la plus proche des enfants.
  const rails = new Map()
  for (const e of result.edges) {
    if (e._renvoi) continue
    const u = byId.get(e.sources[0]), k = byId.get(e.targets[0])
    if (!u || !k) continue
    const ux = u.x + u.width / 2
    const r = rails.get(u.id) || { id: u.id, gen: u._generation, ux, l: ux, r: ux }
    r.l = Math.min(r.l, k.x + k.width / 2); r.r = Math.max(r.r, k.x + k.width / 2)
    rails.set(u.id, r)
  }
  const byRow = new Map()
  for (const r of rails.values()) { if (!byRow.has(r.gen)) byRow.set(r.gen, []); byRow.get(r.gen).push(r) }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.l - b.l)
    const below = new Map(list.map(r => [r.id, []]))
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      if (b.l >= a.r) break
      const aIn = a.l <= b.l && a.r >= b.r, bIn = b.l <= a.l && b.r >= a.r
      let upper
      if (aIn && !bIn) upper = a
      else if (bIn && !aIn) upper = b
      else {
        const aOut = a.ux < b.l || a.ux > b.r, bOut = b.ux < a.l || b.ux > a.r
        upper = aOut && !bOut ? a : bOut && !aOut ? b : (a.r - a.l >= b.r - b.l ? a : b)
      }
      below.get(upper.id).push(upper === a ? b.id : a.id)
    }
    const lift = new Map()
    const visiting = new Set()
    const liftOf = (id) => {
      if (lift.has(id)) return lift.get(id)
      if (visiting.has(id)) return 0
      visiting.add(id)
      const v = below.get(id).reduce((m, o) => Math.max(m, liftOf(o) + 1), 0)
      visiting.delete(id)
      lift.set(id, v)
      return v
    }
    for (const r of list) byId.get(r.id)._railLift = Math.min(3, liftOf(r.id))
  }

  return result
}
