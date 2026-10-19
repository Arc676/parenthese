import { computeLayout, componentOrderPerGen, chainGap } from './elkLayout'
import { PERSON_W, PERSON_H, FAMILY_CARD_W, FAMILY_CARD_H } from './constants'

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
// Jamais d'îlot (Patch, 19/10) : une famille collée trop loin garde son fil, aussi long soit-il
const DETACH_PX = Infinity
// Famille reliée deux fois : au-delà de cet écart, la seconde filiation est une pastille, pas un fil
const RENVOI_FAR_PX = 1440
// Famille de conjoint poussée plus loin que ça : ses parents reviennent juste au-dessus de leur enfant
// Famille de conjoint poussée plus loin que ça par les descendants du couple : la chaîne se décale au bord de sa rangée d'enfants
const PARENT_SHIFT_PX = 400
// Côté d'une belle-famille : le côté extérieur de la branche, sauf si l'autre côté la rapproche d'au moins ça
const SIDE_SWITCH_PX = 1440
// Carte de famille et pont (maquette A, retenue le 19/10). Une belle-famille plus large que ça ne se colle pas à
// son enfant : elle devient un cluster dessiné à part, et une carte prend sa place au-dessus du conjoint
const CLUSTER_PX = 2880

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

// Les grosses belles-familles (clusters) se rangent du côté où leur conjoint se trouve dans la lignée
// principale : gauche s'il est dans la moitié gauche, droite sinon. Ce côté ne se connaît qu'une fois la
// lignée posée, d'où une seconde passe quand un cluster s'est construit du mauvais côté. Le couple se tourne
// alors vers la famille, et la carte au-dessus du conjoint se pose de ce côté-là.
// Règle globale (Patch, 19/10) : l'arbre s'ouvre à partir de la personne de référence. Toute belle-famille,
// grosse ou petite, part du côté opposé à la référence (à droite pour un conjoint à sa droite), le couple se
// tourne vers elle. Ce côté ne se connaît qu'une fois la lignée posée, d'où une seconde passe.
export function computeBlockLayout(graphData = null, referenceId = null) {
  const forced = new Map()
  let result = layoutOnce(graphData, referenceId, forced)
  // Chaque passe fixe le côté des belles-familles d'après la passe précédente ; on s'arrête dès que plus rien
  // ne change, ou après quatre passes (les positions bougent d'une passe à l'autre)
  for (let pass = 0; pass < 4 && result._inlaws?.length; pass++) {
    const byId = new Map(result.children.map(n => [n.id, n]))
    const ref = referenceId != null ? byId.get(`p-${referenceId}`) : null
    const main = result.families?.find(f => f.id === 'main')
    const pivot = ref ? ref.x + ref.width / 2 : main ? (main.bbox.x0 + main.bbox.x1) / 2 : 0
    let changed = false
    for (const { anchorId, side } of result._inlaws) {
      const a = byId.get(anchorId)
      const want = a.x + a.width / 2 < pivot ? -1 : 1
      if (want !== side && forced.get(anchorId) !== want) { forced.set(anchorId, want); changed = true }
    }
    if (!changed) break
    result = layoutOnce(graphData, referenceId, forced)
  }
  return result
}

function layoutOnce(graphData, referenceId, forcedSide) {
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

  // La chaîne la plus haute d'une famille : on remonte de parents en parents, par le sang de la référence
  // quand un membre en est (on retombe alors sur la lignée principale, déjà en cours : rien à attacher,
  // la filiation sera un renvoi), sinon par le premier membre qui a des parents
  function topChainOf(chain) {
    let cur = chain
    const seen = new Set()
    while (!seen.has(cur)) {
      seen.add(cur)
      const m = cur.find(id => parentUnionOf.has(id) && blood.has(id)) || cur.find(id => parentUnionOf.has(id))
      if (!m) break
      cur = chainOf.get(parentUnionOf.get(m))
    }
    return cur
  }

  // Un couple « enfant + pièce rapportée » se tourne vers l'extérieur de la fratrie : la pièce rapportée
  // à gauche dans la moitié gauche, à droite dans la moitié droite, pour que sa famille se pose à côté
  // Remariage (chaîne plus longue) : si l'enfant de la lignée est à un bout, il reste du côté de sa fratrie
  // et toute la suite de conjoints (ex-époux compris) part de l'autre côté, vers la belle-famille.
  function orient(chain, kid, side) {
    if (!kid) return
    if (chain.length === 3) {
      const spouse = chain[0] === kid ? chain[2] : chain[0]
      if (chain[1] !== chain.find(id => byId.get(id)._type === 'union') || !parentUnionOf.has(spouse)) return
      if ((side < 0 && chain[0] !== spouse) || (side > 0 && chain[2] !== spouse)) chain.reverse()
      return
    }
    const i = chain.indexOf(kid)
    if (i !== 0 && i !== chain.length - 1) return
    if ((side < 0 && i === 0) || (side > 0 && i === chain.length - 1)) chain.reverse()
  }

  const pos = new Map()
  const placed = new Set()
  const externalEdges = new Set() // `${union}>${enfant}` : enfant dessiné sous une autre lignée
  const detached = [] // familles qu'on n'a pas pu coller à leur enfant (trop loin) : posées à part, renvoi
  const clusters = [] // grosses belles-familles dessinées à part : { block, anchorId, cardId, echoId, mainCardId }
  const rowStep = (() => { const ys = [...new Set(nodes.map(n => n.y))].sort((a, b) => a - b); return ys.length > 1 ? ys[1] - ys[0] : PERSON_H + 60 })()
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

  // Pose une famille de conjoint depuis sa place idéale (parents juste au-dessus de l'enfant), poussée du côté
  // demandé : sur les rangées de l'enfant et en dessous (sa fratrie, leurs descendants), au-delà de toute
  // l'étendue déjà posée, jamais sous la ligne d'une fratrie ; sur les rangées au-dessus (ses ancêtres, de
  // petits couples), au premier trou libre, à côté des autres ancêtres.
  function pushHybrid(blockRows, ideal, rows, side, anchorGen, gap) {
    let d = ideal
    for (let iter = 0; iter < 500; iter++) {
      let push = 0
      for (const [g, list] of blockRows) {
        const occ = rows.get(g)
        if (!occ?.length) continue
        if (g >= anchorGen) {
          const l = list[0][0] + d, r = list[list.length - 1][1] + d
          const ol = occ[0][0], or = occ[occ.length - 1][1]
          if (l < or + gap && r > ol - gap) push = Math.max(push, side > 0 ? or + gap - l : r - (ol - gap))
        } else {
          for (const [l0, r0] of list) for (const [ol, or] of occ) {
            const l = l0 + d, r = r0 + d
            if (l < or + gap && r > ol - gap) push = Math.max(push, side > 0 ? or + gap - l : r - (ol - gap))
          }
        }
      }
      if (push <= 0) break
      d += side * push
    }
    return d
  }

  // Place fantôme d'un enfant déjà dessiné ailleurs : il garde sa place dans l'ordre de la fratrie et
  // dans le centrage des parents, sans occuper de contour (c'est l'enfant réel qui l'occupe)
  // Pendant la reconstruction d'un cluster, la place de la carte inverse est réservée sous le fantôme du conjoint
  let cardUnder = null
  const ghostBlock = (kid) => {
    const n = byId.get(kid)
    const rows = new Map([[n._generation, [[0, n.width]]]])
    if (kid === cardUnder) rows.set(n._generation + 1, [[(n.width - FAMILY_CARD_W) / 2, (n.width + FAMILY_CARD_W) / 2]])
    return { ghost: true, withCard: kid === cardUnder, kid, rows, members: new Set(), external: [], gen: n._generation, chain: [0, n.width], rel: () => null, width: n.width, place() {} }
  }
  const CARD_SIDE_PX = 400
  const freeSpotNear = (desired, w, list, prefer = 0) => {
    if (!overlaps(desired, desired + w, list, FAMILY_GAP)) return desired
    const candidates = list.flatMap(([l, r]) => [r + FAMILY_GAP, l - FAMILY_GAP - w]).filter(c => !overlaps(c, c + w, list, FAMILY_GAP))
    if (!candidates.length) return null
    // Le côté de la famille est préféré tant qu'il ne coûte pas plus de CARD_SIDE_PX
    const cost = (c) => Math.abs(c - desired) + (prefer && Math.sign(c - desired) === -prefer ? CARD_SIDE_PX : 0)
    return candidates.reduce((best, c) => (cost(c) < cost(best) ? c : best))
  }

  // Famille attachée à un conjoint : l'enfant à coller (ancre) doit finir au bout de sa fratrie, du côté du
  // couple. Si l'ordre choisi l'en empêche, la fratrie est dessinée en miroir (du dernier au premier).
  let anchor = null // { kid, end: 'left' | 'right', path: Set<chaîne> } : la branche du conjoint longe ce bord
  const pathOf = (kid) => {
    const s = new Set([chainOf.get(kid)])
    let cur = chainOf.get(parentUnionOf.get(kid))
    while (cur && !s.has(cur)) {
      s.add(cur)
      const m = cur.find(id => parentUnionOf.has(id) && blood.has(id)) || cur.find(id => parentUnionOf.has(id))
      cur = m ? chainOf.get(parentUnionOf.get(m)) : null
    }
    return s
  }
  const inlaws = [] // { anchorId, side } : toutes les belles-familles construites, pour la seconde passe

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
    // Remariage : les enfants de chaque union restent groupés dans l'ordre des unions de la chaîne, et une
    // belle-famille va du côté de son union (gauche pour la première, droite pour la dernière), jamais au-delà
    // des demi-frères et demi-sœurs
    const unionsOfChain = chain.filter(id => byId.get(id)._type === 'union')
    const sideOfUnion = (unionId) => {
      if (unionsOfChain.length < 2) return 0
      return unionsOfChain.indexOf(unionId) < (unionsOfChain.length - 1) / 2 ? -1 : 1
    }
    kidsOfChain.forEach(({ unionId, kid }, i) => {
      const kc = chainOf.get(kid)
      if (placed.has(kc)) {
        external.push({ kid, unionId })
        externalEdges.add(`${unionId}>${kid}`)
        childBlocks.push({ ...ghostBlock(kid), unionId })
        return
      }
      const side = sideOfUnion(unionId) || outer || (i < (kidsOfChain.length - 1) / 2 ? -1 : 1)
      childBlocks.push({ ...buildBlock(kc, unionId, side), unionId, kid })
    })
    // Un enfant dont le conjoint amène sa famille va au bout de la fratrie, de son côté : sa belle-famille,
    // qui fait partie de son bloc, se retrouve au bord, sans survoler ses frères et sœurs. L'ordre de
    // naissance s'efface pour lui (choix de Patch, 19/10).
    const kids = unionsOfChain.flatMap(u => {
      const group = childBlocks.filter(b => b.unionId === u)
      return [...group.filter(b => b.attachSide < 0), ...group.filter(b => !b.attachSide), ...group.filter(b => b.attachSide > 0)]
    })
    // La branche qui mène au conjoint d'une autre famille va au bout, du côté de cette famille
    if (anchor) {
      const i = kids.findIndex(b => b.kid != null && anchor.path.has(chainOf.get(b.kid)))
      if (i >= 0) { const [b] = kids.splice(i, 1); if (anchor.end === 'right') kids.push(b); else kids.unshift(b) }
    }
    childBlocks.length = 0
    childBlocks.push(...kids)
    const packed = packBlocks(childBlocks, FAMILY_GAP)
    const rows = new Map()
    // Un fantôme ne compte pas dans le contour, sauf s'il porte la carte inverse d'un cluster (l'écho y est dessiné)
    childBlocks.forEach((b, i) => { if (!b.ghost || b.withCard) mergeRows(rows, b.rows, packed.xs[i]) })

    // Familles des conjoints de la chaîne pas encore dessinées : construites entières depuis leur ancêtre
    // le plus haut. Le couple se tourne vers cette famille (conjoint du côté où elle se pose). Une famille
    // déjà dessinée (reliée deux fois) ne l'est pas une seconde fois : la filiation reste externe, renvoi si
    // son fil croise une autre famille.
    const built = []
    // L'enfant de la lignée dans cette chaîne (celui dont les parents sont ownerUnion), s'il est seul
    const kidsHere = chain.filter(id => byId.get(id)._type === 'person' && ownerUnion && parentUnionOf.get(id) === ownerUnion)
    const kidOfChain = kidsHere.length === 1 ? kidsHere[0] : null
    for (const id of [...chain]) {
      if (byId.get(id)._type !== 'person') continue
      const pu = parentUnionOf.get(id)
      if (!pu || pu === ownerUnion) continue
      const pc = chainOf.get(pu)
      if (placed.has(pc)) continue
      const top = topChainOf(pc)
      if (placed.has(top)) continue
      const side = forcedSide.get(id) ?? (chain.length > 3 ? (chain.indexOf(id) < chain.length / 2 ? -1 : 1) : (outer || (chain.indexOf(id) < chain.length / 2 ? -1 : 1)))
      const saved = anchor
      const clustersBefore = clusters.length
      const externalBefore = new Set(externalEdges)
      anchor = { kid: id, end: side < 0 ? 'right' : 'left', path: pathOf(id) }
      let block = buildBlock(top, null, side)
      anchor = saved
      if (block.width > CLUSTER_PX) {
        // La famille devient un cluster. On la reconstruit avec, sous le fantôme du conjoint, la place réservée
        // de la carte inverse. La première construction ne laisse aucune trace : ses clusters imbriqués (et leurs
        // chaînes), les chaînes qu'elle a posées et les arêtes externes qu'elle a notées sont oubliés avec elle.
        const unplace = (members) => { for (const ch of new Set([...members].map(m => chainOf.get(m)).filter(Boolean))) placed.delete(ch) }
        for (const c of clusters.splice(clustersBefore)) { const i = nodes.findIndex(n => n.id === c.cardId); if (i >= 0) nodes.splice(i, 1); byId.delete(c.cardId); unplace(c.block.members) }
        unplace(block.members)
        for (const e of [...externalEdges]) if (!externalBefore.has(e)) externalEdges.delete(e)
        const savedCard = cardUnder
        cardUnder = id
        anchor = { kid: id, end: side < 0 ? 'right' : 'left', path: pathOf(id) }
        block = buildBlock(top, null, side)
        anchor = saved
        cardUnder = savedCard
        // Ici, une carte de famille tient la place de ses parents, juste au-dessus de lui
        const A = byId.get(id)
        const cardId = `fam-${id}`, echoId = `echo-${id}`, mainCardId = `fam-main-${id}`
        const partners = [byId.get(pu)?._data?.p1Key, byId.get(pu)?._data?.p2Key].map(k => byId.get(k)?._data).filter(Boolean)
        const label = partners.find(d => d.lastName)?.lastName || A._data?.birthName || A._data?.lastName || ''
        const people = [...block.members].map(m => byId.get(m)).filter(n => n?._type === 'person')
        const portraits = [...people.filter(n => n._data?.photo), ...people.filter(n => !n._data?.photo)].slice(0, 4).map(n => n._data)
        nodes.push({ id: cardId, _type: 'family', width: FAMILY_CARD_W, height: FAMILY_CARD_H, _generation: gen - 1, y: A.y - rowStep + (PERSON_H - FAMILY_CARD_H) / 2, _data: { label, count: people.length, portraits, targetId: echoId, stem: 'down', stemTo: id } })
        byId.set(cardId, nodes[nodes.length - 1])
        const card = { isCard: true, rows: new Map([[gen - 1, [[0, FAMILY_CARD_W]]]]), members: new Set([cardId]), external: [], gen: gen - 1, rel: (x) => (x === cardId ? 0 : null), chain: [0, FAMILY_CARD_W], width: FAMILY_CARD_W, place(x0) { pos.set(cardId, x0) } }
        clusters.push({ block, anchorId: id, pu, cardId, echoId, mainCardId, label, people, side })
        built.push({ block: card, anchorId: id, side })
        orient(chain, kidOfChain ?? (chain.length === 3 ? (chain[0] === id ? chain[2] : chain[0]) : null), side)
        continue
      }
      built.push({ block, anchorId: id, side })
      orient(chain, kidOfChain ?? (chain.length === 3 ? (chain[0] === id ? chain[2] : chain[0]) : null), side)
    }

    // Chaîne centrée sur la rangée de ses enfants directs (fantômes compris), décalée au plus près si une
    // famille de conjoint occupe déjà cette rangée
    const rowW = chainWidth(chain)
    let offsets = chainOffsets(chain)
    const kidRowL = childBlocks.length ? Math.min(...childBlocks.map((b, i) => packed.xs[i] + b.chain[0])) : 0
    const kidRowR = childBlocks.length ? Math.max(...childBlocks.map((b, i) => packed.xs[i] + b.chain[1])) : rowW
    const avoidObstacles = (x) => {
      const obstacles = rows.get(gen) || []
      if (!overlaps(x, x + rowW, obstacles, FAMILY_GAP)) return x
      const candidates = obstacles.flatMap(([l, r]) => [r + FAMILY_GAP, l - FAMILY_GAP - rowW])
        .filter(c => !overlaps(c, c + rowW, obstacles, FAMILY_GAP))
      // De préférence une place encore au-dessus de la rangée des enfants (sinon la ligne de fratrie
      // partirait de l'extérieur et croiserait les familles voisines)
      const over = candidates.filter(c => c + rowW > kidRowL && c < kidRowR)
      const pool = over.length ? over : candidates
      return pool.length ? pool.reduce((best, c) => (Math.abs(c - x) < Math.abs(best - x) ? c : best)) : x
    }
    let rowX = (kidRowL + kidRowR) / 2 - rowW / 2
    if (childBlocks.length) {
      // Remariage : chaque union au plus près au-dessus de ses propres enfants. Parmi les positions qui
      // alignent une union sur un bord ou le centre de son groupe, on garde celle où les lignes de fratrie
      // débordent le moins au-dessus des demi-frères et demi-sœurs (égalité : la plus proche du centrage).
      if (unionsOfChain.length > 1) {
        const groups = unionsOfChain.map(u => {
          const g = childBlocks.map((b, i) => (b.unionId === u ? [packed.xs[i] + b.chain[0], packed.xs[i] + b.chain[1]] : null)).filter(Boolean)
          return g.length ? [Math.min(...g.map(r => r[0])), Math.max(...g.map(r => r[1]))] : null
        })
        const at = (u) => offsets.get(u) + byId.get(u).width / 2
        const cost = (x) => unionsOfChain.reduce((s, u, i) => {
          if (!groups[i]) return s
          const c = x + at(u)
          return s + Math.max(0, c - groups[i][1]) + Math.max(0, groups[i][0] - c)
        }, 0)
        const centered = rowX
        const candidates = [centered]
        unionsOfChain.forEach((u, i) => { if (groups[i]) for (const target of [groups[i][0], (groups[i][0] + groups[i][1]) / 2, groups[i][1]]) candidates.push(target - at(u)) })
        rowX = candidates.reduce((best, x) => {
          const cb = cost(best), cx = cost(x)
          return cx < cb - 0.5 || (Math.abs(cx - cb) <= 0.5 && Math.abs(x - centered) < Math.abs(best - centered)) ? x : best
        })
      }
      rowX = avoidObstacles(rowX)
    }

    // Belles-familles de la chaîne, collées au conjoint depuis leur place idéale (ses parents juste au-dessus
    // de lui), poussées vers l'extérieur du bloc : sur la rangée du couple et en dessous, au-delà de tout le
    // bloc (jamais sous la ligne de la fratrie des enfants) ; au-dessus, au premier trou libre.
    // Elles font partie du bloc : le bloc du dessus les emporte avec l'enfant quand il l'empile au bout de
    // sa fratrie.
    const rowsBase = new Map([...rows].map(([g, l]) => [g, l.map(i => [...i])]))
    const idealOf = (p, rx) => {
      const at = p.block.rel(p.anchorId)
      const anchorX = rx + offsets.get(p.anchorId)
      return at == null ? anchorX - p.block.width / 2 : anchorX - at
    }
    // Sur un remariage où l'enfant de la lignée est à un bout, seule sa moitié est réservée : au-dessus des
    // ex-conjoints, la carte ou la famille du conjoint peut se poser.
    const parentsSpan = (rx) => {
      if (chain.length > 3 && kidOfChain) {
        const k = rx + offsets.get(kidOfChain)
        return chain.indexOf(kidOfChain) === 0 ? [rx - FAMILY_GAP, k + byId.get(kidOfChain).width + FAMILY_GAP] : [k - FAMILY_GAP, rx + rowW + FAMILY_GAP]
      }
      return [rx - FAMILY_GAP, rx + rowW + FAMILY_GAP]
    }
    const reserveParents = (r, rx) => { if (ownerUnion) mergeRows(r, new Map([[gen - 1, [parentsSpan(rx)]]]), 0) }
    // 1) Le côté de chaque famille : celui prévu (extérieur de la branche), sauf si l'autre côté la rapproche
    //    nettement. Le couple se retourne alors et l'enfant ira au bout de sa fratrie de ce côté-là.
    {
      const trial = new Map([...rowsBase].map(([g, l]) => [g, l.map(i => [...i])]))
      mergeRows(trial, new Map([[gen, [[rowX, rowX + rowW]]]]), 0)
      reserveParents(trial, rowX)
      for (const p of built) {
        if (chain.length !== 3) break
        if (p.block.isCard) continue
        const ideal = idealOf(p, rowX)
        const x = pushHybrid(p.block.rows, ideal, trial, p.side, gen, FAMILY_GAP)
        const other = -p.side
        const mirrored = (chain[0] === p.anchorId ? chain[2] : chain[0])
        const idealOther = ideal + (offsets.get(mirrored) - offsets.get(p.anchorId))
        const xOther = pushHybrid(p.block.rows, idealOther, trial, other, gen, FAMILY_GAP)
        if (Math.abs(xOther - idealOther) + SIDE_SWITCH_PX < Math.abs(x - ideal)) {
          p.side = other
          orient(chain, mirrored, other)
          offsets = chainOffsets(chain)
        }
      }
    }
    // 2) Pose. Si une famille serait poussée loin par les descendants du couple, la chaîne se décale au bord
    //    de sa rangée d'enfants, du côté de cette famille : les parents ne sont plus au centre de leurs enfants,
    //    mais la belle-famille est tout près et son fil reste court.
    // Au-dessus de la chaîne, la place de ses propres parents est réservée : les parents du conjoint se posent
    // à côté, pas dessus (sinon le couple des parents, posé après, ne trouve plus sa place au-dessus des enfants)
    const placeAll = (rx) => {
      const r = new Map([...rowsBase].map(([g, l]) => [g, l.map(i => [...i])]))
      mergeRows(r, new Map([[gen, [[rx, rx + rowW]]]]), 0)
      reserveParents(r, rx)
      const list = []
      let maxPush = 0, sideOfMax = 0
      for (const p of built) {
        const ideal = idealOf(p, rx)
        const x = p.block.isCard ? (freeSpotNear(ideal, p.block.width, r.get(gen - 1) || [], p.side) ?? pushHybrid(p.block.rows, ideal, r, p.side, gen, FAMILY_GAP)) : pushHybrid(p.block.rows, ideal, r, p.side, gen, FAMILY_GAP)
        if (!p.block.isCard && Math.abs(x - ideal) > maxPush) { maxPush = Math.abs(x - ideal); sideOfMax = p.side }
        list.push({ block: p.block, x, ideal, anchorId: p.anchorId, side: p.side })
        mergeRows(r, p.block.rows, x)
      }
      // Le contour rendu ne garde pas la réservation (elle ne sert qu'à pousser les belles-familles)
      const out = new Map([...rowsBase].map(([g, l]) => [g, l.map(i => [...i])]))
      mergeRows(out, new Map([[gen, [[rx, rx + rowW]]]]), 0)
      for (const a of list) mergeRows(out, a.block.rows, a.x)
      return { rows: out, list, maxPush, sideOfMax }
    }
    let result = placeAll(rowX)
    if (childBlocks.length && result.maxPush > PARENT_SHIFT_PX && kidRowR - kidRowL > rowW) {
      const edge = avoidObstacles(result.sideOfMax < 0 ? kidRowL : kidRowR - rowW)
      const alt = placeAll(edge)
      if (alt.maxPush < result.maxPush) { rowX = edge; result = alt }
    }
    rows.clear()
    for (const [g, l] of result.rows) rows.set(g, l)
    const attachments = result.list.map(a => ({ block: a.block, x: a.x }))
    for (const a of result.list) {
      attachedEdges.add(`${parentUnionOf.get(a.anchorId)}>${a.anchorId}`)
    }
    const attachSide = built.length ? (built.every(p => p.side < 0) ? -1 : built.every(p => p.side > 0) ? 1 : 0) : 0
    for (const p of built) inlaws.push({ anchorId: p.anchorId, side: p.side })

    const members = new Set(chain)
    for (const b of childBlocks) { for (const m of b.members) members.add(m); external.push(...b.external) }
    for (const a of attachments) { for (const m of a.block.members) members.add(m); external.push(...a.block.external) }
    const ghosts = new Map()
    childBlocks.forEach((b, i) => { if (b.ghost) ghosts.set(b.kid, packed.xs[i]) })

    // Origine du bloc au bord gauche de son contour
    const [minL] = extentOf(rows)
    for (const [g, list] of rows) rows.set(g, list.map(([l, r]) => [l - minL, r - minL]))
    rowX -= minL
    const kidXs = packed.xs.map(x => x - minL)
    for (const [k, x] of ghosts) ghosts.set(k, x - minL)
    for (const a of attachments) { a.x -= minL; if (a.parents) a.parents.x -= minL }

    const rel = (id) => {
      if (offsets.has(id)) return rowX + offsets.get(id)
      if (ghosts.has(id)) return ghosts.get(id)
      for (let i = 0; i < childBlocks.length; i++) {
        if (childBlocks[i].ghost) continue
        const r = childBlocks[i].rel(id)
        if (r != null) return kidXs[i] + r
      }
      for (const a of attachments) {
        if (a.parents?.offsets.has(id)) return a.parents.x + a.parents.offsets.get(id)
        const r = a.block.rel(id)
        if (r != null) return a.x + r
      }
      return null
    }
    return {
      rows, members, external, gen, rel, attachSide,
      chain: [rowX, rowX + rowW],
      width: extentOf(rows)[1],
      place(x0) {
        for (const id of chain) pos.set(id, x0 + rowX + offsets.get(id))
        childBlocks.forEach((b, i) => b.place(x0 + kidXs[i]))
        attachments.forEach(a => {
          a.block.place(x0 + a.x)
          if (a.parents) for (const id of a.parents.chain) pos.set(id, x0 + a.parents.x + a.parents.offsets.get(id))
        })
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
  // La plus grande lignée d'abord : construite en premier, c'est elle qui reçoit les autres en belles-familles.
  // Dans l'autre sens, une petite branche construite d'abord aspirerait toute la lignée principale comme
  // « famille du conjoint » et la pousserait loin (vu le 19/10 sur un arbre réel : 249 personnes poussées).
  const descCount = new Map()
  const countDesc = (chain, seen = new Set()) => {
    if (descCount.has(chain)) return descCount.get(chain)
    if (seen.has(chain)) return 0
    seen.add(chain)
    let n = chain.length
    for (const id of chain) for (const k of (childrenOfUnion.get(id) || [])) n += countDesc(chainOf.get(k), seen)
    descCount.set(chain, n)
    return n
  }
  const roots = chains.filter(c => !hasParents(c)).sort((a, b) => (
    (isBloodChain(b) - isBloodChain(a)) || countDesc(b) - countDesc(a) || genOf(a) - genOf(b) || birthYearOf(a) - birthYearOf(b) || String(a[0]).localeCompare(String(b[0]))
  ))
  const free = []
  for (const r of roots) if (!placed.has(r)) free.push(buildBlock(r))
  for (const c of chains) if (!placed.has(c)) free.push(buildBlock(c))
  free.push(...detached)
  // Clusters : chaque grosse belle-famille à part, sur les mêmes rangées. Le conjoint y apparaît dans sa fratrie
  // (écho de la même personne) avec, sous lui, la carte de la lignée qu'il a rejointe. Les deux cartes se répondent.
  // Les clusters se rangent du côté de leur conjoint : à gauche de la lignée si le conjoint est dans la
  // moitié gauche de sa fratrie, à droite sinon. L'orientation des gens et la place des familles se répondent.
  const ordered = [...clusters.filter(c => c.side < 0).reverse().map(c => c.block), ...free, ...clusters.filter(c => c.side >= 0).map(c => c.block)]
  const forest = packBlocks(ordered, FAMILY_GAP * 2)
  ordered.forEach((b, i) => b.place(forest.xs[i]))
  const xOfBlock = new Map(ordered.map((b, i) => [b, forest.xs[i]]))
  const referenceNode = result.referenceId != null ? byId.get(`p-${result.referenceId}`) : null
  const inCluster = new Set(clusters.flatMap(c => [...c.block.members]))
  const mainPeople = nodes.filter(n => n._type === 'person' && !inCluster.has(n.id) && !n._echo)
  clusters.forEach((c) => {
    const A = byId.get(c.anchorId)
    const ghostX = c.block.rel(c.anchorId)
    const x0 = xOfBlock.get(c.block)
    if (ghostX == null) return
    pos.set(c.echoId, x0 + ghostX)
    nodes.push({ id: c.echoId, _type: 'person', _data: A._data, width: PERSON_W, height: PERSON_H, _generation: A._generation, y: A.y, _echo: true, _echoOf: c.anchorId })
    byId.set(c.echoId, nodes[nodes.length - 1])
    const mainChain = chainOf.get(c.anchorId) || []
    const around = [...mainChain.filter(id => byId.get(id)._type === 'person' && id !== c.anchorId), ...mainChain.flatMap(id => childrenOfUnion.get(id) || [])].map(id => byId.get(id)?._data).filter(Boolean)
    const mainLabel = referenceNode?._data?.lastName || around[0]?.lastName || ''
    nodes.push({ id: c.mainCardId, _type: 'family', width: FAMILY_CARD_W, height: FAMILY_CARD_H, _generation: A._generation + 1, y: A.y + rowStep + (PERSON_H - FAMILY_CARD_H) / 2, _data: { label: mainLabel, count: mainPeople.length, portraits: around.slice(0, 4), targetId: c.anchorId, stem: 'up', stemTo: c.echoId } })
    byId.set(c.mainCardId, nodes[nodes.length - 1])
    pos.set(c.mainCardId, pos.get(c.echoId) + (PERSON_W - FAMILY_CARD_W) / 2)
    // Le fil des parents va à l'écho dans le cluster ; vers le conjoint du plan principal, c'est la carte qui parle
    for (const e of [...result.edges]) {
      if (e.targets[0] !== c.anchorId || !c.block.members.has(e.sources[0])) continue
      e._hidden = true
      result.edges.push({ ...e, id: `${e.id}#echo`, targets: [c.echoId], _hidden: false })
    }
  })

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
    if (e._hidden) continue
    if (!externalEdges.has(`${u}>${c}`) || attachedEdges.has(`${u}>${c}`)) continue
    // Famille reliée deux fois à l'arbre (dessinée sous l'autre lien) : pastille si le fil croiserait une
    // famille, ou s'il devrait traverser plus d'un écran
    const far = Math.abs((byId.get(u).x + byId.get(u).width / 2) - (byId.get(c).x + byId.get(c).width / 2)) > RENVOI_FAR_PX
    if (!far && !crossesOtherFamily(u, c)) continue
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
    if (e._renvoi || e._hidden) continue
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
    for (const r of list) byId.get(r.id)._railLift = Math.min(4, liftOf(r.id))
  }

  // Carte des familles (maquette J, 19/10) : au dézoom, chaque famille (la lignée principale, chaque cluster)
  // devient une tuile, et chaque mariage entre familles un trait. Le dessin se fait dans Galaxy / renderers.
  const familyOf = new Map()
  clusters.forEach(c => { for (const m of c.block.members) familyOf.set(m, c.cardId); familyOf.set(c.echoId, c.cardId); familyOf.set(c.mainCardId, c.cardId) })
  const bboxOf = (ids) => {
    const ps = ids.map(id => byId.get(id)).filter(n => n && n._type === 'person' && n.x != null)
    if (!ps.length) return null
    return { x0: Math.min(...ps.map(n => n.x)), y0: Math.min(...ps.map(n => n.y)), x1: Math.max(...ps.map(n => n.x + n.width)), y1: Math.max(...ps.map(n => n.y + n.height)) }
  }
  const portraitsOf = (ids) => {
    const ps = ids.map(id => byId.get(id)).filter(n => n?._type === 'person' && !n._echo)
    return [...ps.filter(n => n._data?.photo), ...ps.filter(n => !n._data?.photo)].slice(0, 6).map(n => n._data)
  }
  const mainIds = nodes.filter(n => !familyOf.has(n.id)).map(n => n.id)
  nodes.forEach(n => { n._family = familyOf.get(n.id) || 'main' })
  const partnerOf = (id) => { const ch = chainOf.get(id) || []; return ch.find(x => x !== id && byId.get(x)?._type === 'person') }
  const families = [
    { id: 'main', label: referenceNode?._data?.lastName || '', count: mainPeople.length, portraits: portraitsOf(mainIds), bbox: bboxOf(mainIds), links: [] },
    ...clusters.map(c => ({ id: c.cardId, side: c.side, anchorId: c.anchorId, label: c.label, count: c.people.length, portraits: portraitsOf([...c.block.members]), bbox: bboxOf([...c.block.members]), links: [{ to: 'main', label: [byId.get(c.anchorId)?._data?.firstName, byId.get(partnerOf(c.anchorId))?._data?.firstName].filter(Boolean).join(' et ') }] })),
  ].filter(f => f.bbox)
  families.forEach(f => { f.spread = { x: (f.bbox.x0 + f.bbox.x1) / 2, y: (f.bbox.y0 + f.bbox.y1) / 2 } })
  result.families = families
  result._inlaws = inlaws

  return result
}
