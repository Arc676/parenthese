import { computeLayout, componentOrderPerGen, chainGap, coupleBarMeta, restoreCoupleBarMeta } from './elkLayout'
import { persons as globalPersons, unions as globalUnions, filiations as globalFiliations } from '../../data/mockData'

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
// Une belle-famille plus large que ça n'est pas dessinée dans cet arbre : elle devient un onglet (son propre
// arbre, calculé avec le conjoint comme référence) et le conjoint porte un badge vers elle.
const FAMILY_TAB_PX = 2880
// Une belle-famille poussée plus loin que ça de son enfant ne se colle pas : seuls les parents du conjoint
// restent au-dessus de lui, le reste devient un onglet
const FAMILY_FIT_PX = 480
// Une belle-famille qui grimpe au-dessus des parents du conjoint reste dessinée si elle est toute petite
const FAMILY_INLINE_MAX = 6
// En dessous, une famille sortie de l'arbre ne fait pas d'onglet : elle reste dessinée
const FAMILY_TAB_MIN = 10

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
  const un = byIdLocal.get(u)
  const parents = new Set([un?._data?.p1Key, un?._data?.p2Key].filter(Boolean))
  return nodes.some(n => n._type === 'person' && !excluded.has(n.id) && !parents.has(n.id)
    && (n._generation === kid._generation || n._generation === kid._generation - 1)
    && n.x + n.width > lo && n.x < hi)
}

// Contours : par rangée, une liste d'intervalles [gauche, droite] triés et fusionnés. Les intervalles qui se
// touchent (écart ≤ 1) sont réunis. Un seul tri par rangée : insérer les intervalles un à un recopiait la
// liste à chaque fois, quadratique sur un gros arbre.
function mergeRows(target, source, dx) {
  for (const [g, list] of source) {
    const all = (target.get(g) || []).concat(list.map(([l, r]) => [l + dx, r + dx])).sort((x, y) => x[0] - y[0])
    const out = []
    for (const [a, b] of all) {
      const last = out[out.length - 1]
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
      else out.push([a, b])
    }
    target.set(g, out)
  }
}
const extentOf = (rows) => {
  let l = Infinity, r = -Infinity
  for (const list of rows.values()) for (const [a, b] of list) { l = Math.min(l, a); r = Math.max(r, b) }
  return [l, r]
}
const overlaps = (l, r, list, gap) => list.some(([a, b]) => l < b + gap && r > a - gap)

// Règle globale (Patch, 19/10) : l'arbre s'ouvre à partir de la personne de référence. Toute belle-famille,
// grosse ou petite, part du côté opposé à la référence (à droite pour un conjoint à sa droite), le couple se
// tourne vers elle. Ce côté ne se connaît qu'une fois la lignée posée, d'où une seconde passe.
// `familyTabs` : vrai, une belle-famille trop large devient un onglet ; faux, tout l'arbre est dessiné d'un
// tenant (mode « tout l'arbre »), les grandes familles sont seulement signalées dans `families`.
export function computeBlockLayout(graphData = null, referenceId = null, { familyTabs = true } = {}) {
  const forced = new Map()
  let result = layoutOnce(graphData, referenceId, forced, familyTabs)
  // Chaque passe fixe le côté des belles-familles d'après la passe précédente ; on s'arrête dès que plus rien
  // ne change, ou après quatre passes (les positions bougent d'une passe à l'autre)
  for (let pass = 0; pass < 4 && result._inlaws?.length; pass++) {
    const byId = new Map(result.children.map(n => [n.id, n]))
    const persons = result.children.filter(n => n._type === 'person')
    // Pivot : le centre de la famille dessinée. La référence elle-même, souvent au bord (dernière génération,
    // charnière d'un onglet), enverrait toutes les belles-familles du même côté (Patch, 19/10 : « moins clair »)
    const pivot = persons.length ? (Math.min(...persons.map(n => n.x)) + Math.max(...persons.map(n => n.x + n.width))) / 2 : 0
    let changed = false
    for (const { anchorId, side } of result._inlaws) {
      const a = byId.get(anchorId)
      if (!a) continue // conjoint d'une famille devenue onglet : pas dans cet arbre
      const want = a.x + a.width / 2 < pivot ? -1 : 1
      if (want !== side && forced.get(anchorId) !== want) { forced.set(anchorId, want); changed = true }
    }
    if (!changed) break
    result = layoutOnce(graphData, referenceId, forced, familyTabs)
  }
  return result
}

function layoutOnce(graphData, referenceId, forcedSide, familyTabs = true) {
  const result = computeLayout(graphData, referenceId)
  const nodes = result.children
  const byId = new Map(nodes.map(n => [n.id, n]))
  // Nom d'une famille : celui que portent le plus ses membres (nom de naissance, sinon nom), pas celui de la seule
  // personne de référence. Ex. : 175 personnes dont 5 portent le nom de la référence. Égalité : le nom
  // de secours (celui de la référence) s'il est parmi les premiers, sinon le premier rencontré.
  const nomMajoritaire = (ids, secours = '') => {
    const n = new Map()
    for (const id of ids) {
      const d = byId.get(id)?._type === 'person' ? byId.get(id)._data : null
      const nom = (d?.birthName || d?.lastName || '').trim()
      if (nom) n.set(nom, (n.get(nom) || 0) + 1)
    }
    let best = '', max = 0
    for (const [nom, c] of n) if (c > max) { best = nom; max = c }
    return secours && n.get(secours) === max ? secours : (best || secours)
  }

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
  const tabs = [] // belles-familles trop larges pour cet arbre, devenues onglets : { anchorId, pu, label, count, members }
  const hiddenChains = new Set() // chaînes des familles devenues onglets : pas dessinées dans cet arbre
  const tabOfChain = new Map() // chaîne cachée → son onglet : un second conjoint de la même famille renvoie au même onglet
  const bigFamilies = [] // mode « tout l'arbre » : les familles qui seraient des onglets, dessinées quand même
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
  const ghostBlock = (kid) => {
    const n = byId.get(kid)
    return { ghost: true, kid, rows: new Map([[n._generation, [[0, n.width]]]]), members: new Set(), external: [], gen: n._generation, chain: [0, n.width], rel: () => null, width: n.width, place() {} }
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
  // Défaire ce qu'une construction a posé : chaînes, onglets nés pendant elle, arêtes externes notées
  const chainsOf = (members) => new Set([...members].map(m => chainOf.get(m)).filter(Boolean))
  const unplace = (members) => { for (const ch of chainsOf(members)) { placed.delete(ch); hiddenChains.delete(ch); tabOfChain.delete(ch) } }
  const forgetTabs = (from, to) => {
    const nested = new Set()
    for (const tb of tabs.splice(from, to - from)) {
      unplace(tb.members)
      for (const m of tb.members) nested.add(m)
      for (const h of tb.hinges) { byId.get(h)._familyTab = null; nested.add(h) }
      byId.get(tb.anchorId)._familyTab = null
    }
    return nested
  }
  const forgetExternal = (before, after) => { for (const e of after) if (!before.has(e)) externalEdges.delete(e) }
  const registerTab = (tab) => { tabs.push(tab); for (const ch of chainsOf(tab.members)) { hiddenChains.add(ch); tabOfChain.set(ch, tab) } }

  // `parentsOnly` : la chaîne est au milieu de sa fratrie, les belles-familles de ses conjoints se réduisent
  // aux parents au-dessus du conjoint, le reste devient un onglet
  function buildBlock(chain, ownerUnion = null, outer = 0, parentsOnly = false) {
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
      // Belle-famille en construction : une chaîne dont aucun membre du sang n'est enfant de cette union, mais
      // dont un membre du sang a ses parents ailleurs, ira sous ces parents-là (le sang de la référence gagne)
      const duSang = anchor && !kc.some(id => blood.has(id) && parentUnionOf.get(id) === unionId) && kc.some(id => blood.has(id) && byId.get(id)._type === 'person' && parentUnionOf.has(id))
      // Un enfant parti dans un onglet ne laisse pas de place vide : ses parents se centrent sur les enfants dessinés
      if (tabOfChain.has(kc)) return
      if (placed.has(kc) || duSang) {
        external.push({ kid, unionId })
        externalEdges.add(`${unionId}>${kid}`)
        childBlocks.push({ ...ghostBlock(kid), unionId })
        return
      }
      const side = sideOfUnion(unionId) || outer || (i < (kidsOfChain.length - 1) / 2 ? -1 : 1)
      const snap = { tabsBefore: tabs.length, externalBefore: new Set(externalEdges) }
      const b = buildBlock(kc, unionId, side)
      snap.tabsAfter = tabs.length; snap.externalAfter = new Set(externalEdges)
      childBlocks.push({ ...b, unionId, kid, side, snap })
    })
    // Un enfant dont le conjoint amène sa famille va au bout de la fratrie, de son côté : sa belle-famille,
    // qui fait partie de son bloc, se retrouve au bord, sans survoler ses frères et sœurs. L'ordre de
    // naissance s'efface pour lui (choix de Patch, 19/10).
    // Et un enfant dont le couple est au bord d'un large bloc de descendants va du côté où son bloc déborde
    // le moins : les couples de la fratrie restent groupés sous leurs parents, le gros bloc part au-delà
    // (Patch, 20/10 : « Antoine devrait être juste en dessous de ses parents »)
    const offCenter = (b) => (b.chain[0] + b.chain[1]) / 2 - b.width / 2
    const byOffCenter = (list) => [...list].sort((a, b) => offCenter(b) - offCenter(a))
    const kids = unionsOfChain.flatMap(u => {
      const group = childBlocks.filter(b => b.unionId === u)
      return [...byOffCenter(group.filter(b => b.attachSide < 0)), ...byOffCenter(group.filter(b => !b.attachSide)), ...byOffCenter(group.filter(b => b.attachSide > 0))]
    })
    // La branche qui mène au conjoint d'une autre famille va au bout, du côté de cette famille
    if (anchor) {
      const i = kids.findIndex(b => b.kid != null && anchor.path.has(chainOf.get(b.kid)))
      if (i >= 0) { const [b] = kids.splice(i, 1); if (anchor.end === 'right') kids.push(b); else kids.unshift(b) }
    }
    // Règle du bout (Patch, 19/10 soir) : seule une belle-famille au bout de la fratrie est dessinée entière.
    // Un enfant marié au milieu de sa fratrie est rebâti avec les seuls parents de son conjoint au-dessus de
    // lui, le reste de la belle-famille devient un onglet. Ainsi aucun fil ne passe sous une autre famille.
    const middle = kids.map((b, i) => ({ b, i })).filter(({ b, i }) => i > 0 && i < kids.length - 1 && !b.ghost && b.attachBig)
    middle.sort((x, y) => y.b.snap.tabsBefore - x.b.snap.tabsBefore)
    for (const { b, i } of middle) {
      forgetTabs(b.snap.tabsBefore, b.snap.tabsAfter)
      unplace(b.members)
      forgetExternal(b.snap.externalBefore, b.snap.externalAfter)
      const snap = { tabsBefore: tabs.length, externalBefore: new Set(externalEdges) }
      const nb = buildBlock(chainOf.get(b.kid), b.unionId, b.side, true)
      snap.tabsAfter = tabs.length; snap.externalAfter = new Set(externalEdges)
      kids[i] = { ...nb, unionId: b.unionId, kid: b.kid, side: b.side, snap }
    }
    childBlocks.length = 0
    childBlocks.push(...kids)
    const packed = packBlocks(childBlocks, FAMILY_GAP)
    const rows = new Map()
    childBlocks.forEach((b, i) => { if (!b.ghost) mergeRows(rows, b.rows, packed.xs[i]) })

    // Familles des conjoints de la chaîne pas encore dessinées : construites entières depuis leur ancêtre
    // le plus haut. Le couple se tourne vers cette famille (conjoint du côté où elle se pose). Une famille
    // déjà dessinée (reliée deux fois) ne l'est pas une seconde fois : la filiation reste externe, renvoi si
    // son fil croise une autre famille.
    const built = []
    // Réduire une belle-famille à ses seuls parents : frères, sœurs et ancêtres du conjoint deviennent un onglet
    // dont les parents sont les charnières (badge sur eux), puis les parents seuls sont rebâtis au-dessus du conjoint
    function reduceToParents(entry) {
      const { block, anchorId: id, side, pu, pc, snap } = entry
      const pcPersons = pc.filter(x => byId.get(x)._type === 'person')
      const keep = new Set(pcPersons)
      const extra = [...block.members].filter(m => byId.get(m)?._type === 'person' && !keep.has(m) && chainOf.get(m) !== pc)
      // Une famille de FAMILY_TAB_MIN personnes ou moins reste dessinée : pas d'onglet pour si peu (Patch, 20/10)
      if (extra.length <= FAMILY_TAB_MIN) return block
      const nested = forgetTabs(snap.tabsBefore, snap.tabsAfter)
      unplace(block.members)
      forgetExternal(snap.externalBefore, snap.externalAfter)
      const A = byId.get(id)
      const members = new Set([...extra, ...nested].filter(m => !keep.has(m)))
      const label = nomMajoritaire(members, A._data?.birthName || byId.get(pcPersons[0])?._data?.lastName || A._data?.lastName || '')
      registerTab({ anchorId: pcPersons[0], pu: parentUnionOf.get(pcPersons[0]) || pu, label, count: members.size, members, hinges: pcPersons.slice(1), hingeEdges: [] })
      for (const x of pcPersons) byId.get(x)._familyTab = { anchorId: pcPersons[0], label, count: members.size, tabKey: pcPersons[0].replace(/^p-/, ''), place: 'above' }
      const saved = anchor
      anchor = { kid: id, end: side < 0 ? 'right' : 'left', path: pathOf(id) }
      snap.tabsBefore = tabs.length
      snap.externalBefore = new Set(externalEdges)
      const nb = buildBlock(pc, null, side)
      snap.tabsAfter = tabs.length
      snap.externalAfter = new Set(externalEdges)
      anchor = saved
      return nb
    }
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
      const owner = tabOfChain.get(top) || tabOfChain.get(pc)
      if (owner) {
        // Sa famille est déjà un onglet (un autre conjoint l'a amenée) : même badge, même onglet
        const A = byId.get(id)
        A._familyTab = { anchorId: owner.anchorId, label: owner.label, count: owner.count, tabKey: owner.anchorId.replace(/^p-/, ''), place: 'above' }
        owner.hinges.push(id)
        owner.hingeEdges.push([pu, id])
        continue
      }
      // Le côté extérieur de la branche prime : une branche au bout de sa fratrie pose ses belles-familles au-delà,
      // jamais dans la fratrie des aînés (Patch, 20/10 : la branche de Paul à droite d'Eugénie)
      const side = (chain.length === 3 && outer) ? outer : (forcedSide.get(id) ?? (chain.length > 3 ? (chain.indexOf(id) < chain.length / 2 ? -1 : 1) : (chain.indexOf(id) < chain.length / 2 ? -1 : 1)))
      const saved = anchor
      const tabsBefore = tabs.length
      const externalBefore = new Set(externalEdges)
      anchor = { kid: id, end: side < 0 ? 'right' : 'left', path: pathOf(id) }
      let block = buildBlock(top, null, side)
      anchor = saved
      if (block.width > FAMILY_TAB_PX && !familyTabs) {
        const A = byId.get(id)
        bigFamilies.push({ anchorId: id, label: nomMajoritaire(block.members, A._data?.birthName || A._data?.lastName || ''), count: [...block.members].filter(m => byId.get(m)?._type === 'person').length })
      }
      if (block.width > FAMILY_TAB_PX && familyTabs) {
        // Trop large pour cet arbre : la famille devient un onglet et n'est pas dessinée ici. Sa construction ne
        // laisse aucune trace (onglets imbriqués, chaînes posées, arêtes externes), et le fil de ses parents
        // vers le conjoint est caché : c'est le badge du conjoint qui dit où est sa famille.
        // Les onglets nés pendant cette construction (familles emboîtées) rejoignent celle-ci : son onglet les
        // retrouvera en se dessinant, avec ses propres onglets
        const nested = forgetTabs(tabsBefore, tabs.length)
        unplace(block.members)
        forgetExternal(externalBefore, new Set(externalEdges))
        const A = byId.get(id)
        const partners = [byId.get(pu)?._data?.p1Key, byId.get(pu)?._data?.p2Key].map(k => byId.get(k)?._data).filter(Boolean)
        const members = new Set([...[...block.members].filter(m => byId.get(m)?._type === 'person'), ...nested])
        const label = nomMajoritaire(members, A._data?.birthName || partners.find(d => d.lastName)?.lastName || A._data?.lastName || '')
        registerTab({ anchorId: id, pu, label, count: members.size, members, hinges: [], hingeEdges: [[pu, id]] })
        A._familyTab = { anchorId: id, label, count: members.size, tabKey: id.replace(/^p-/, ''), place: 'above' }
        continue
      }
      const entry = { block, anchorId: id, side, pu, pc, snap: { tabsBefore, tabsAfter: tabs.length, externalBefore, externalAfter: new Set(externalEdges) } }
      // Une belle-famille collée ne déborde pas, au-dessus de la rangée des parents du conjoint, de la place de
      // ces parents : des ancêtres plus larges grimperaient dans les rangées des aînés de la lignée et s'y
      // glisseraient entre deux frères (Patch, 20/10, Marc et Sophie entre Anaïs et Germaine). Les parents
      // restent, le reste devient un onglet. Des ancêtres en colonne au-dessus des parents restent dessinés.
      // Une toute petite famille (jusqu'à FAMILY_INLINE_MAX personnes au-delà des parents) reste dessinée,
      // à condition que ce qui est au-dessus des parents tienne dans leur largeur (une colonne d'ancêtres),
      // sinon elle déborderait dans les rangées des aînés (Paul et ses frères dans la fratrie de Catherine)
      const deep = [...block.rows.keys()].some(g => g < gen - 1)
      const beyondParents = deep ? [...block.members].filter(m => byId.get(m)?._type === 'person' && chainOf.get(m) !== pc).length : 0
      // Au-dessus des parents, seuls les ancêtres en ligne directe du conjoint sont admis : des oncles ou tantes
      // élargiraient ces rangées et la famille se glisserait dans la fratrie des aînés de la lignée
      const ancestors = new Set()
      for (const stack = [id]; stack.length;) {
        const u = parentUnionOf.get(stack.pop())
        if (!u) continue
        for (const k of [byId.get(u)?._data?.p1Key, byId.get(u)?._data?.p2Key]) if (k && !ancestors.has(k)) { ancestors.add(k); stack.push(k) }
      }
      const collaterals = deep && [...block.members].some(m => { const n = byId.get(m); return n?._type === 'person' && n._generation < gen - 1 && !ancestors.has(m) })
      if (parentsOnly || (deep && (beyondParents > FAMILY_INLINE_MAX || collaterals))) entry.block = reduceToParents(entry)
      built.push(entry)
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
    // Seule la moitié de l'enfant de la lignée est réservée pour ses parents : au-dessus du conjoint, ses propres
    // parents peuvent se poser (Patch, 20/10 : « Louis et Joséphine devraient être au-dessus de Victor »)
    const parentsSpan = (rx) => {
      if (kidOfChain && (chain.indexOf(kidOfChain) === 0 || chain.indexOf(kidOfChain) === chain.length - 1)) {
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
        const x = pushHybrid(p.block.rows, ideal, r, p.side, gen, FAMILY_GAP)
        if (Math.abs(x - ideal) > maxPush) { maxPush = Math.abs(x - ideal); sideOfMax = p.side }
        list.push({ block: p.block, x, ideal, anchorId: p.anchorId, side: p.side })
        mergeRows(r, p.block.rows, x)
      }
      // Le contour rendu ne garde pas la réservation (elle ne sert qu'à pousser les belles-familles)
      const out = new Map([...rowsBase].map(([g, l]) => [g, l.map(i => [...i])]))
      mergeRows(out, new Map([[gen, [[rx, rx + rowW]]]]), 0)
      for (const a of list) mergeRows(out, a.block.rows, a.x)
      return { rows: out, list, maxPush, sideOfMax }
    }
    const placeBest = () => {
      let res = placeAll(rowX)
      if (childBlocks.length && res.maxPush > PARENT_SHIFT_PX && kidRowR - kidRowL > rowW) {
        const edge = avoidObstacles(res.sideOfMax < 0 ? kidRowL : kidRowR - rowW)
        const alt = placeAll(edge)
        if (alt.maxPush < res.maxPush) { rowX = edge; res = alt }
      }
      return res
    }
    let result = placeBest()
    // 3) Une belle-famille qui ne se colle pas à son enfant (poussée de plus de FAMILY_FIT_PX) se réduit aux
    //    parents du conjoint, le reste devient un onglet, et tout se pose à nouveau
    const tooFar = result.list.map((a, i) => ({ a, p: built[i] })).filter(({ a, p }) => Math.abs(a.x - a.ideal) > FAMILY_FIT_PX && p.block.rows.size > 1)
    if (tooFar.length) {
      for (const { p } of [...tooFar].sort((u, v) => v.p.snap.tabsBefore - u.p.snap.tabsBefore)) p.block = reduceToParents(p)
      result = placeBest()
    }
    rows.clear()
    for (const [g, l] of result.rows) rows.set(g, l)
    const attachments = result.list.map(a => ({ block: a.block, x: a.x }))
    for (const a of result.list) {
      attachedEdges.add(`${parentUnionOf.get(a.anchorId)}>${a.anchorId}`)
    }
    const attachSide = built.length ? (built.every(p => p.side < 0) ? -1 : built.every(p => p.side > 0) ? 1 : 0) : 0
    // Une belle-famille attachée qui dépasse les seuls parents (frères et sœurs ou ancêtres du conjoint)
    const attachBig = attachments.some(a => a.block.rows.size > 1)
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
      rows, members, external, gen, rel, attachSide, attachBig,
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
  for (const r of roots) if (!placed.has(r) && !hiddenChains.has(r)) free.push(buildBlock(r))
  for (const c of chains) if (!placed.has(c) && !hiddenChains.has(c)) free.push(buildBlock(c))
  free.push(...detached)
  const forest = packBlocks(free, FAMILY_GAP * 2)
  free.forEach((b, i) => b.place(forest.xs[i]))
  const referenceNode = result.referenceId != null ? byId.get(`p-${result.referenceId}`) : null
  // Le fil des parents d'un conjoint dont la famille est un onglet n'est pas dessiné : son badge dit où elle est
  for (const tb of tabs) for (const [pu, id] of tb.hingeEdges) for (const e of result.edges) if (e.sources[0] === pu && e.targets[0] === id) e._hidden = true

  // Les familles devenues onglets sortent de cet arbre : leurs nœuds et leurs arêtes ne sont pas dessinés
  if (hiddenChains.size) {
    const hidden = new Set([...hiddenChains].flatMap(ch => ch))
    for (const n of nodes) if (n._type === 'unknown' && hidden.has(n.id.replace(/^unknown-/, 'p-'))) hidden.add(n.id)
    result.children = nodes.filter(n => !hidden.has(n.id))
    // Un onglet se propose depuis le badge d'un conjoint dessiné : ceux dont le conjoint est caché avec sa famille tombent
    for (let i = tabs.length - 1; i >= 0; i--) if (hidden.has(tabs[i].anchorId)) tabs.splice(i, 1)
    for (const tb of tabs) tb.hinges = tb.hinges.filter(h => !hidden.has(h))
    result.edges = result.edges.filter(e => !hidden.has(e.sources[0]) && !hidden.has(e.targets[0]))
    nodes.length = 0
    nodes.push(...result.children)
  }
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

  // Les familles de cet arbre : la lignée dessinée, puis chaque belle-famille devenue onglet. Galaxy en fait
  // la barre d'onglets ; un onglet est le même arbre recalculé avec le conjoint comme référence.
  const drawn = nodes.filter(n => n._type === 'person')
  result.families = [
    { id: 'main', label: nomMajoritaire(drawn.map(n => n.id), referenceNode?._data?.lastName || drawn[0]?._data?.lastName || ''), count: drawn.length, referenceId: result.referenceId ?? null },
    ...tabs.map(tb => ({ id: tb.anchorId, anchorId: tb.anchorId, label: tb.label, count: tb.count, members: [...tb.members].map(m => m.replace(/^p-/, '')), hinges: [tb.anchorId, ...tb.hinges].map(m => m.replace(/^p-/, '')) })),
    ...bigFamilies.map(f => ({ id: f.anchorId, anchorId: f.anchorId, label: f.label, count: f.count, members: [], drawn: true })),
  ]
  result._inlaws = inlaws

  return result
}

// ============================================================
// Onglets de familles
// ============================================================
// Le sous-graphe d'un ensemble de personnes : leurs unions entre elles et leurs filiations entre elles.
export function subgraphOf(personIds, graphData = null) {
  const keep = new Set([...personIds].map(String))
  const persons = (graphData?.persons || globalPersons).filter(p => keep.has(String(p.id)))
  const unions = (graphData?.unions || globalUnions).filter(u => keep.has(String(u.partner1Id)) && keep.has(String(u.partner2Id)))
  const unionIds = new Set(unions.map(u => String(u.id)))
  const filiations = (graphData?.filiations || globalFiliations).filter(f => keep.has(String(f.childId)) && (f.unionId ? unionIds.has(String(f.unionId)) : keep.has(String(f.parentId))))
  return { persons, unions, filiations }
}

// La ligne directe d'une personne vers une famille (Patch, 21/10 : « je veux me voir tout le temps ») : le plus
// court chemin de parenté (parents, enfants, conjoints) de `selfId` jusqu'au premier membre de `memberIds`,
// sans fratries autour. Chaque pas d'un enfant à un parent garde ses deux parents (le fil part de leur union,
// et sans l'autre parent le placement dessine un conjoint « Inconnu »).
// Rend les personnes à ajouter (ni `selfId` déjà membre, ni chemin : ensemble vide).
export function lineToFamily(selfId, memberIds, graphData = null) {
  const members = new Set([...memberIds].map(String))
  const self = selfId != null ? String(selfId) : null
  if (self == null || members.has(self)) return new Set()
  const persons = graphData?.persons || globalPersons
  if (!persons.some(p => String(p.id) === self)) return new Set()
  const unions = graphData?.unions || globalUnions
  const filiations = graphData?.filiations || globalFiliations
  const unionById = new Map(unions.map(u => [String(u.id), u]))
  // Voisins : [voisin, personnes que ce pas fait dessiner en plus]
  const next = new Map()
  const link = (a, b, extra = []) => { if (!next.has(a)) next.set(a, []); next.get(a).push([b, extra]) }
  for (const u of unions) {
    const a = String(u.partner1Id), b = String(u.partner2Id)
    link(a, b); link(b, a)
  }
  const parentsOf = new Map()
  for (const f of filiations) {
    const child = String(f.childId)
    const u = f.unionId ? unionById.get(String(f.unionId)) : null
    const parents = u ? [String(u.partner1Id), String(u.partner2Id)] : f.parentId != null ? [String(f.parentId)] : []
    if (!parentsOf.has(child)) parentsOf.set(child, new Set())
    for (const p of parents) parentsOf.get(child).add(p)
  }
  for (const [child, parents] of parentsOf) {
    for (const p of parents) {
      const couple = [...parents].filter(q => q !== p)
      link(child, p, couple); link(p, child, couple)
    }
  }
  const from = new Map([[self, null]])
  const queue = [self]
  let hit = null
  for (let i = 0; i < queue.length && hit == null; i++) {
    for (const [nb, extra] of next.get(queue[i]) || []) {
      if (from.has(nb)) continue
      from.set(nb, { prev: queue[i], extra })
      if (members.has(nb)) { hit = nb; break }
      queue.push(nb)
    }
  }
  const line = new Set()
  for (let id = hit; id != null && from.get(id); id = from.get(id).prev) {
    for (const e of from.get(id).extra) if (!members.has(e)) line.add(e)
    const prev = from.get(id).prev
    if (!members.has(prev)) line.add(prev)
  }
  return line
}

// Toutes les familles d'un arbre, de proche en proche : l'arbre de la personne de départ, puis chaque grande
// belle-famille qu'il cache (un onglet = ce bloc caché plus le conjoint charnière, posé avec lui comme
// référence), puis celles que ces onglets cachent à leur tour. Chaque personne est dans un seul onglet, sauf
// la charnière qui est des deux côtés. Ordre : celui de la découverte, la famille de départ en premier.
export function familyTabsOf(graphData = null, referenceId = null) {
  const root = { key: referenceId != null ? String(referenceId) : 'root', referenceId, parentKey: null, personIds: null, label: '', count: 0 }
  const tabs = [root]
  const seen = new Set([root.key])
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i]
    const graph = tab.personIds ? subgraphOf(tab.personIds, graphData) : graphData
    const result = computeBlockLayout(graph, tab.referenceId, { familyTabs: true })
    const fams = result.families || []
    if (fams[0]) { tab.label = fams[0].label; tab.count = fams[0].count }
    // La personne de départ réellement retenue (l'arbre sans personne de départ en choisit une)
    if (tab === root) root.resolvedRef = result.referenceId != null ? String(result.referenceId).replace(/^p-/, '') : null
    // Le placement de la famille de départ est celui que l'arbre affiche ensuite : gardé pour takeRootLayout,
    // il n'est pas recalculé (plusieurs secondes sur un arbre de quelques milliers de personnes)
    if (tab === root && !graphData) Object.defineProperty(tabs, 'rootLayout', { value: { result, coupleBarMeta, referenceId }, writable: true })
    for (const f of fams.slice(1)) {
      if (f.drawn) continue
      const key = String(f.anchorId).replace(/^p-/, '')
      if (seen.has(key)) continue
      seen.add(key)
      tabs.push({ key, referenceId: key, parentKey: tab.key, personIds: new Set([...f.members, ...f.hinges]), hinges: f.hinges, label: f.label, count: f.count })
    }
  }
  // Deux onglets au même nom (homonymes, ou une branche sortie de sa propre lignée) : sauf le plus grand, chacun
  // prend les prénoms de sa charnière, ceux que porte la pastille qui y mène (Patch, 20/10 : « plusieurs fois
  // les mêmes familles »)
  // 28/10 (Patch : « ptet le Joseph et Marie ») : l'onglet le plus petit prend d'abord le nom suivant le plus
  // porté chez lui et pas encore pris par un autre onglet ; les prénoms de la charnière ne servent qu'en dernier recours.
  const persons = graphData?.persons || globalPersons
  const firstName = new Map(persons.map(p => [String(p.id), p.firstName]))
  const familyName = new Map(persons.map(p => [String(p.id), (p.birthName || p.lastName || '').trim()]))
  const namesByCount = (tb) => {
    const n = new Map()
    for (const id of tb.personIds || []) { const nom = familyName.get(String(id).replace(/^p-/, '')); if (nom) n.set(nom, (n.get(nom) || 0) + 1) }
    return [...n].sort((x, y) => y[1] - x[1]).map(([nom]) => nom)
  }
  const byLabel = new Map()
  for (const tb of tabs) { if (!byLabel.has(tb.label)) byLabel.set(tb.label, []); byLabel.get(tb.label).push(tb) }
  const taken = new Set(tabs.map(tb => tb.label))
  for (const group of byLabel.values()) {
    if (group.length < 2) continue
    const biggest = group.reduce((a, b) => (b.count > a.count ? b : a))
    for (const tb of [...group].sort((a, b) => b.count - a.count)) {
      if (tb === biggest) continue
      const next = namesByCount(tb).find(nom => !taken.has(nom))
      if (next) { tb.label = next; taken.add(next); continue }
      const names = [...new Set((tb.hinges || [tb.referenceId]).map(id => firstName.get(String(id))).filter(Boolean))].slice(0, 2)
      if (names.length) tb.label = `${tb.label} · ${names.join(' et ')}`
    }
  }
  return tabs
}

// Le placement de la famille de départ calculé par familyTabsOf (arbre du module, onglets allumés), rendu une
// seule fois : l'arbre affiché le modifie ensuite (pastilles, ligne directe, réordonnancement)
export function takeRootLayout(tabs, referenceId) {
  const kept = tabs?.rootLayout
  if (!kept) return null
  tabs.rootLayout = null
  if (String(kept.referenceId ?? '') !== String(referenceId ?? '')) return null
  restoreCoupleBarMeta(kept.coupleBarMeta)
  return kept.result
}
