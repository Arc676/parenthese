import { memo, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react'
import { getPersonMedias, getParents, getChildren, getPersonUnions, persons as graphPersons, unions as graphUnions, filiations as graphFiliations } from '../data/mockData'
import { PERSON_R, FLOAT_SPEED, FLOAT_AMPLITUDE, REPULSION_RADIUS, REPULSION_STRENGTH, MAX_ORBIT_MEDIAS, ENTRANCE_NODE_DURATION, ENTRANCE_CAMERA_DURATION, ENTRANCE_CAMERA_FROM_SCALE, ENTRANCE_REDUCED_DURATION, ENTRANCE_LINE_DELAY, ENTRANCE_LINE_DURATION, ENTRANCE_ORBIT_DELAY, ENTRANCE_ORBIT_DURATION, ENTRANCE_ORBIT_STAGGER } from './galaxy/constants'
import { easeOutCubic } from './galaxy/utils'
import { computeLayout, generateNodeRandomData, coupleBarMeta, restoreCoupleBarMeta } from './galaxy/elkLayout'
import { computeBlockLayout, familyTabsOf, lineToFamily, subgraphOf, takeRootLayout } from './galaxy/blockLayout'
import { hasGhosts, withGhosts } from '../utils/ghosts'

// Placement par blocs familiaux par défaut (mesures : tools/layout-bench). ?layout=sugiyama = placement Sugiyama.
const USE_BLOCK_LAYOUT = typeof window === 'undefined' || new URLSearchParams(window.location.search).get('layout') !== 'sugiyama'
import { findPathBFS } from './galaxy/pathfinding'
import { drawBackground, drawCoupleLinks, drawFiliations, drawAnnotations, drawPathHighlight, drawNodes, drawRenvoiPills, nodeRadius } from './galaxy/renderers'
import { buildSiblingGroups, moveInOrder, pickSlot, rubberBand, springStep, isSettled, buildOrderPayload, filiationsWithOrder } from './galaxy/siblingReorder'
import { annotations as annotationData, updateAnnotation as updateAnnotationInStore } from '../data/mockData'
import { anchorLegacy, layoutCenters, placeAnnotations, readAnchor } from './annotations/anchor'
import { useImageCache } from './galaxy/useImageCache'
import { useGalaxyInteractions } from './galaxy/useGalaxyInteractions'
import { t as tr } from '../i18n/index.js'
import './Galaxy.css'

// Assez bas pour cadrer un grand arbre entier à l'ouverture
// (le rendu à petite échelle reste bon marché grâce au niveau de détail selon le zoom)
const MIN_SCALE = 0.12

// Lissage exponentiel avec convergence exacte : renvoie la cible dès qu'on en est à moins de eps,
// sinon les états lissés n'atteignent jamais leur cible et la scène se redessine sans fin.
function approach(prev, target, k, eps = 1e-3) {
  const next = prev + (target - prev) * k
  return Math.abs(target - next) < eps ? target : next
}
const MAX_SCALE = 3.2
// Carte des familles : l'arbre s'efface entre ces deux échelles, les tuiles de familles apparaissent
// Ouverture sur la personne de départ quand l'arbre entier serait illisible
const FOCUS_MIN_READABLE_SCALE = 0.5
// Prénoms à 12 px (13 px à l'échelle 1) : en dessous, ils restent dessinés mais ne se lisent plus
const FOCUS_SCALE = 0.95
// Sous 768 px, la réglette de zoom reste ouverte en bas à gauche (ZoomControl.css) : la personne de départ se
// centre dans la largeur qu'elle laisse libre
const PHONE_SLIDER_BAND = 64

// Réordonner une fratrie : seuil avant de soulever à la souris, appui long au doigt
const REORDER_MOUSE_THRESHOLD = 4
const REORDER_TOUCH_SLOP = 8
const REORDER_LONG_PRESS_MS = 320
// Les frères et sœurs s'écartent sans rebond ; la personne lâchée se pose avec un léger rebond
const SHIFT_SPRING = { stiffness: 560, dampingRatio: 0.92 }
const DROP_SPRING = { stiffness: 480, dampingRatio: 0.72 }
const centerX = (node) => node.x + node.width / 2
// Recul de la caméra à l'ouverture : départ immédiat, long freinage (ease-out quint)
const easeOutQuint = (t) => 1 - (1 - t) ** 5
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Barre des familles rangée comme l'arbre (Patch, 28/10, planche A variante 2 « le trait d'union ») : chaque
// famille juste après celle par laquelle on y entre, la famille de départ en tête. Les onglets d'une même branche
// (sous-arbre d'un enfant direct de la famille de départ) se serrent à 10 px, 16 px entre les branches ; un trait
// relie deux voisins quand le second part du premier (jamais vers la famille de départ, sa place en tête suffit).
// Le trait qui mène à l'onglet ouvert est terracotta, les autres couleur fil.
function barTabs(tabs, activeKey) {
  if (!tabs.length) return []
  const root = tabs[0]
  const kids = new Map()
  for (const tb of tabs.slice(1)) { const pk = tabs.some((x) => x.key === tb.parentKey) ? tb.parentKey : root.key; if (!kids.has(pk)) kids.set(pk, []); kids.get(pk).push(tb) }
  const order = []
  const visit = (tb) => { order.push(tb); for (const c of kids.get(tb.key) || []) visit(c) }
  visit(root)
  for (const tb of tabs) if (!order.includes(tb)) order.push(tb)
  const byKey = new Map(tabs.map((tb) => [tb.key, tb]))
  const pathTo = (tb) => { const out = []; for (let t = tb; t; t = byKey.get(t.parentKey)) out.unshift(t.key); return out }
  const branchOf = (tb) => { const p = pathTo(tb); return p[1] || p[0] }
  const active = byKey.get(activeKey) || root
  const lit = new Set(pathTo(active))
  return order.map((tb, i) => {
    const prev = order[i - 1]
    const gap = i === 0 ? 0 : (prev !== root && branchOf(tb) === branchOf(prev) ? 10 : 16)
    const trait = i > 0 && prev !== root && tb.parentKey === prev.key ? (lit.has(tb.key) ? 'on' : 'off') : null
    return { tb, gap, trait }
  })
}

const Galaxy = ({ onPersonSelect, onMediaSelect, selectedPersonId, searchHighlightIds = [], graphRevision = 0, annotationHandlers = null, transformReadRef = null, zoomApiRef = null, focusPersonId = null, assetRevision = 0, reorderEnabled = false, onReorderSiblings = null, familyTabs = true, fullNames = false, annotationViewRef = null, onAnnotationsAnchored = null, selfPersonId = null, ghosts = null, initialFamilyKey = null, onFamilyChange = null }) => {
  const canvasRef = useRef(null)
  const layoutDataRef = useRef(null)
  // Onglets de familles (réglage `familyTabs`) : la liste des familles de l'arbre, calculée une fois par
  // version du graphe et par personne de départ, et l'onglet ouvert. Un onglet est le sous-arbre d'une
  // grande belle-famille, posé avec le conjoint charnière comme référence.
  const [tabs, setTabs] = useState([])
  const [activeKey, setActiveKey] = useState(focusPersonId != null ? String(focusPersonId) : null)
  const tabsCacheRef = useRef({ rev: -1, start: undefined, tabs: [] })
  // Liste des onglets calculée dans un worker (galaxy/familyTabsWorker.js) quand l'arbre affiché est celui de la
  // famille de départ : il ne dépend pas de cette liste, il s'affiche tout de suite et la barre suit. Une demande
  // en cours est abandonnée (worker arrêté) dès qu'une autre part ou qu'on calcule la liste sur place.
  const tabsRequestRef = useRef(null) // { rev, start, worker }
  const cancelTabsRequest = useCallback(() => {
    tabsRequestRef.current?.worker.terminate()
    tabsRequestRef.current = null
  }, [])
  useEffect(() => cancelTabsRequest, [cancelTabsRequest])
  const pendingFocusRef = useRef(null) // personne cherchée dans un autre onglet, visée après le changement
  // Lien d'un onglet (?famille=<charnière>) : ouvert dès que l'arbre et ses onglets sont connus, et de nouveau si
  // la personne de départ arrive après (visiteur), tant qu'on n'a pas soi-même changé d'onglet
  const linkFamilyRef = useRef(initialFamilyKey != null ? String(initialFamilyKey) : null)
  const pendingFamilyRef = useRef(initialFamilyKey != null ? String(initialFamilyKey) : null)
  // Famille du lien sans onglet dans ce navigateur (onglets coupés) : l'arbre entier s'ouvre sur sa charnière
  const frameOnRef = useRef(null)
  const onFamilyChangeRef = useRef(onFamilyChange)
  useEffect(() => { onFamilyChangeRef.current = onFamilyChange }, [onFamilyChange])
  const activeTabRef = useRef(null)
  const familyTabsRef = useRef(familyTabs)
  useEffect(() => { familyTabsRef.current = familyTabs }, [familyTabs])
  // Propositions pas encore relues (utils/ghosts.js) : placées et dessinées en transparence, jamais dans les données
  const ghostsRef = useRef(ghosts)
  const fullNamesRef = useRef(fullNames)
  useEffect(() => { fullNamesRef.current = fullNames; needsRedrawRef.current = true }, [fullNames])
  useEffect(() => { ghostsRef.current = ghosts; needsRedrawRef.current = true }, [ghosts])
  const onAnnotationsAnchoredRef = useRef(onAnnotationsAnchored)
  useEffect(() => { onAnnotationsAnchoredRef.current = onAnnotationsAnchored }, [onAnnotationsAnchored])
  const startRefRef = useRef(focusPersonId)
  useEffect(() => {
    startRefRef.current = focusPersonId
    if (linkFamilyRef.current != null) pendingFamilyRef.current = linkFamilyRef.current
    setActiveKey(focusPersonId != null ? String(focusPersonId) : null)
  }, [focusPersonId])
  // Onglet choisi par la personne (barre, badge, recherche) : le lien d'arrivée ne s'impose plus
  // Repère du changement d'onglet (Patch, 28/10 : « on perd un peu rapidement le fil ») : la personne qui relie
  // les deux familles garde sa place et son zoom à l'écran, seules les familles autour changent
  const anchorRef = useRef(null)
  const linkPeople = (key) => {
    const list = tabsCacheRef.current.tabs
    const target = list.find((tb) => tb.key === String(key)), cur = activeTabRef.current || list[0]
    return [target?.referenceId, ...(target?.hinges || []), cur?.referenceId, ...(cur?.hinges || [])].filter((x) => x != null).map(String)
  }
  const rememberAnchor = (key) => {
    const layout = layoutDataRef.current, t = transformRef.current
    if (!layout || !t) return
    const ids = linkPeople(key)
    const node = layout.children.find((n) => n._type === 'person' && ids.includes(String(n._data?.id)))
    anchorRef.current = node ? { id: String(node._data.id), sx: (node.x + node.width / 2) * t.scale + t.x, sy: (node.y + node.height / 2) * t.scale + t.y, scale: t.scale } : null
  }
  const chooseTab = useCallback((key) => { rememberAnchor(key); linkFamilyRef.current = null; pendingFamilyRef.current = null; frameOnRef.current = null; setActiveKey(key) }, [])
  // Survol d'un onglet : la personne par qui l'on y passe s'allume dans l'arbre affiché, sans texte (Patch : « que ça les suggère »)
  const hoverTab = (key) => {
    const layout = layoutDataRef.current
    if (!layout) return
    const present = new Set(layout.children.filter((n) => n._type === 'person').map((n) => String(n._data?.id)))
    const ids = linkPeople(key).filter((id) => present.has(id))
    searchHighlightSetRef.current = new Set([...searchHighlightIdsRef.current.map((id) => `p-${id}`), ...ids.map((id) => `p-${id}`)])
    needsRedrawRef.current = true
  }
  const leaveTab = () => { searchHighlightSetRef.current = new Set(searchHighlightIdsRef.current.map((id) => `p-${id}`)); needsRedrawRef.current = true }
  // Lu au calcul du cadrage et par le réordonnancement : la référence de l'arbre affiché
  const focusPersonIdRef = useRef(focusPersonId)
  // La barre défile quand les onglets débordent : l'onglet ouvert se met en vue (sans animation) et les bords
  // coupés se signalent par un fondu
  const tabsBarRef = useRef(null)
  const [tabsEdges, setTabsEdges] = useState('')
  const updateTabsEdges = useCallback(() => {
    const el = tabsBarRef.current
    if (!el) return
    const left = el.scrollLeft > 12, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 12
    setTabsEdges(`${left ? ' has-left' : ''}${right ? ' has-right' : ''}`)
  }, [])
  useEffect(() => {
    document.querySelector('.family-tab.is-active')?.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' })
    updateTabsEdges()
    window.addEventListener('resize', updateTabsEdges)
    return () => window.removeEventListener('resize', updateTabsEdges)
  }, [activeKey, tabs, updateTabsEdges])
  // Clic sur un badge : l'onglet de cette famille (ou, depuis un onglet, celui d'où l'on vient)
  const openFamily = useCallback((tabKey) => { if (tabKey != null) chooseTab(String(tabKey)) }, [chooseTab])
  // Propriétaire : un portrait vide survolé montre « + photo »
  const [layoutReady, setLayoutReady] = useState(false)
  const transformRef = useRef({ x: 0, y: 0, scale: 1 })

  // Expose transformRef to parent so it can compute world coords (e.g. for photo placement)
  if (transformReadRef) transformReadRef.current = transformRef
  const targetTransformRef = useRef({ x: 0, y: 0, scale: 1 })
  const initialTransformRef = useRef(null)
  const mouseWorldPos = useRef({ x: -9999, y: -9999 })
  const dprRef = useRef(1)
  const pinchRef = useRef(null) // { dist, center }
  const nodeRandomDataRef = useRef(new Map())
  const hoveredNodeId = useRef(null)
  const hoveredMediaKey = useRef(null)
  const hoverScales = useRef(new Map())
  const mediaHoverState = useRef(new Map())
  const dragLiftProgress = useRef(0)
  const entranceRef = useRef(null)
  // Arbre déjà ouvert dans cette page (sa première personne) : l'entrée ne se joue qu'à la première ouverture,
  // un arbre modifié ou un autre onglet s'affiche net
  const openedTreeRef = useRef(null)
  const selectedPersonIdRef = useRef(null)
  const selectedGlowScales = useRef(new Map())
  const searchGlowScales = useRef(new Map())
  const searchHighlightSetRef = useRef(new Set())
  const immediateRelativesRef = useRef(new Set())
  const pathEdgesRef = useRef([])
  const pathNodesRef = useRef([])
  const pathLabelRef = useRef('')
  const pathProgressRef = useRef(new Map())
  const pathLabelAlpha = useRef(0)
  const pathStartTime = useRef(-1)
  const lastPathInputRef = useRef({ selected: null, hovered: null })
  const [displayLabel, setDisplayLabel] = useState('')
  const displayLabelRef = useRef('')

  // Réordonner une fratrie (mode édition, administrateurs) : décalage animé de chaque nœud vers sa place
  // dans le placement affiché, état du geste en cours, soulèvement de la personne tenue
  const offsetsRef = useRef(new Map())
  const reorderRef = useRef(null)
  const liftScalesRef = useRef(new Map())
  const groupsCacheRef = useRef({ layout: null, groups: new Map() })
  const lastFrameRef = useRef(0)
  const reorderEnabledRef = useRef(reorderEnabled)
  const onReorderRef = useRef(onReorderSiblings)
  useEffect(() => { reorderEnabledRef.current = reorderEnabled }, [reorderEnabled])
  useEffect(() => { onReorderRef.current = onReorderSiblings }, [onReorderSiblings])

  // Rendu à la demande : la boucle rAF tourne mais ne redessine que si quelque chose a changé
  // (transform, états lissés, entrée, souris, annotations, image chargée, rendu React, resize).
  const needsRedrawRef = useRef(true)
  const lastAnnotationDataRef = useRef(null)
  const markDirty = useCallback(() => { needsRedrawRef.current = true }, [])
  useEffect(() => { needsRedrawRef.current = true })

  const imageCache = useImageCache(`${graphRevision}:${assetRevision}`, markDirty)

  // Position animée d'un nœud
  const getAnimatedPos = useCallback((node, time) => {
    const baseCx = node.x + node.width / 2 + (offsetsRef.current.get(node.id)?.x || 0)
    const baseCy = node.y + node.height / 2
    const rd = nodeRandomDataRef.current.get(node.id)
    if (!rd) return { cx: baseCx, cy: baseCy }

    let cx = baseCx + rd.offsetX
    let cy = baseCy + rd.offsetY

    cx += Math.sin(time * rd.floatSpeedX + rd.floatPhaseX) * rd.floatAmpX
    cy += Math.sin(time * rd.floatSpeedY + rd.floatPhaseY) * rd.floatAmpY

    if ((node._type === 'person' || node._type === 'unknown') && reorderRef.current?.phase !== 'dragging') {
      const mouse = mouseWorldPos.current
      const dx = cx - mouse.x
      const dy = cy - mouse.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < REPULSION_RADIUS && dist > 1) {
        const force = (1 - dist / REPULSION_RADIUS) * REPULSION_STRENGTH
        cx += (dx / dist) * force
        cy += (dy / dist) * force
      }
    }

    return { cx, cy }
  }, [])

  const {
    isDragging, isZooming, zoomTimeoutRef, hasDragged,
    handleMouseDown, handleMouseMove, handleMouseUp,
    handleMouseLeave, handleWheel, handleClick,
  } = useGalaxyInteractions({
    canvasRef, transformRef, targetTransformRef,
    layoutDataRef, nodeRandomDataRef, entranceRef,
    hoveredNodeIdRef: hoveredNodeId, hoveredMediaKeyRef: hoveredMediaKey, mouseWorldPosRef: mouseWorldPos,
    getAnimatedPos, onPersonSelect, onMediaSelect, onOpenFamily: openFamily,
    annotationHandlers,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
  })

  // ---------- Réordonner une fratrie ----------
  // Le glisser ne déplace une personne qu'à l'horizontale, parmi ses frères et sœurs. Pour chaque place visée,
  // le vrai placement est recalculé : l'arbre se réarrange pendant le geste et rien ne saute au lâcher.
  const getSiblingGroups = useCallback(() => {
    const layout = layoutDataRef.current
    if (groupsCacheRef.current.layout !== layout) groupsCacheRef.current = { layout, groups: buildSiblingGroups(layout) }
    return groupsCacheRef.current.groups
  }, [])

  const canReorderNow = useCallback(() => (
    reorderEnabledRef.current && USE_BLOCK_LAYOUT && Boolean(layoutDataRef.current) && Boolean(entranceRef.current?.finished)
  ), [])

  const worldX = useCallback((clientX) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const t = transformRef.current
    return rect ? (clientX - rect.left - t.x) / t.scale : 0
  }, [])

  // Personne réordonnable sous le pointeur
  const reorderTargetAt = useCallback((clientX, clientY) => {
    if (!canReorderNow()) return null
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    const t = transformRef.current
    const wx = (clientX - rect.left - t.x) / t.scale
    const wy = (clientY - rect.top - t.y) / t.scale
    const groups = getSiblingGroups()
    const now = performance.now()
    for (const node of layoutDataRef.current.children) {
      if (node._type !== 'person' || !groups.has(node.id)) continue
      const pos = getAnimatedPos(node, now)
      if (Math.hypot(pos.cx - wx, pos.cy - wy) < nodeRadius(node)) return node
    }
    return null
  }, [canReorderNow, getSiblingGroups, getAnimatedPos])

  // Placement complet pour un ordre de la fratrie, recalé sur la source (les parents ne bougent pas)
  const layoutForOrder = useCallback((group, order, base) => {
    const tab = activeTabRef.current
    const tabSrc = tab?.personIds ? subgraphOf(tab.personIds) : null
    const src = withGhosts(tabSrc || { persons: graphPersons, unions: graphUnions, filiations: graphFiliations }, ghostsRef.current, !tabSrc)
    const graph = {
      persons: src.persons,
      unions: src.unions,
      filiations: filiationsWithOrder(src.filiations, src.unions, group.source, order),
    }
    const result = computeBlockLayout(graph, focusPersonIdRef.current, { familyTabs: familyTabsRef.current })
    const baseSource = base.children.find((n) => n.id === group.source)
    const source = result.children.find((n) => n.id === group.source)
    const shift = baseSource && source ? baseSource.x - source.x : 0
    if (shift) result.children.forEach((n) => { n.x += shift })
    return result
  }, [])

  // Remplace le placement affiché : chaque nœud garde sa position à l'écran puis glisse vers sa nouvelle place
  const swapLayout = useCallback((next, frontId = null) => {
    const prev = layoutDataRef.current
    if (!prev || !next) return
    const prevById = new Map(prev.children.map((n) => [n.id, n]))
    const offsets = offsetsRef.current
    const reduce = prefersReducedMotion()
    for (const node of next.children) {
      const old = prevById.get(node.id)
      if (!old) continue
      const current = offsets.get(node.id)
      const delta = old.x + (current?.x || 0) - node.x
      if (reduce && node.id !== frontId) { offsets.delete(node.id); continue }
      if (Math.abs(delta) > 0.01 || current) offsets.set(node.id, { x: delta, v: current?.v || 0, spring: current?.spring || SHIFT_SPRING })
    }
    if (frontId) {
      const i = next.children.findIndex((n) => n.id === frontId)
      if (i >= 0) next.children.push(...next.children.splice(i, 1))
    }
    layoutDataRef.current = next
    needsRedrawRef.current = true
  }, [])

  // Envoie l'ordre ; en cas d'échec, l'arbre revient en glissant à l'ordre précédent
  const commitOrder = useCallback((group, order, base) => {
    const payload = buildOrderPayload(graphFiliations, graphUnions, group.source, order)
    const result = onReorderRef.current?.(payload)
    if (result && typeof result.catch === 'function') {
      result.catch(() => { if (!reorderRef.current) swapLayout(base) })
    }
  }, [swapLayout])

  const reorderWindowListeners = useRef(null)

  const endReorder = useCallback((commit) => {
    const drag = reorderRef.current
    if (reorderWindowListeners.current) {
      window.removeEventListener('mousemove', reorderWindowListeners.current.move)
      window.removeEventListener('mouseup', reorderWindowListeners.current.up)
      reorderWindowListeners.current = null
    }
    if (!drag) return
    clearTimeout(drag.timer)
    reorderRef.current = null
    if (drag.phase !== 'dragging') return
    const offset = offsetsRef.current.get(drag.nodeId)
    if (offset) offsetsRef.current.set(drag.nodeId, { ...offset, v: 0, spring: DROP_SPRING })
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
    if (!commit) {
      swapLayout(drag.base, drag.nodeId)
    } else if (drag.index !== drag.originalIndex) {
      commitOrder(drag.group, moveInOrder(drag.group.ids, drag.nodeId, drag.index), drag.base)
    }
    needsRedrawRef.current = true
  }, [swapLayout, commitOrder])

  const updateReorder = useCallback((clientX) => {
    const drag = reorderRef.current
    if (drag?.phase !== 'dragging') return
    const slots = drag.slots
    drag.targetCenter = rubberBand(worldX(clientX) - drag.grab, slots[0], slots[slots.length - 1])
    const index = pickSlot(slots, drag.targetCenter, drag.index)
    if (index !== drag.index) {
      drag.index = index
      if (!drag.layouts.has(index)) drag.layouts.set(index, layoutForOrder(drag.group, moveInOrder(drag.group.ids, drag.nodeId, index), drag.base))
      swapLayout(drag.layouts.get(index), drag.nodeId)
    }
    needsRedrawRef.current = true
  }, [worldX, layoutForOrder, swapLayout])

  const startReorder = useCallback((clientX) => {
    const press = reorderRef.current
    const base = layoutDataRef.current
    const group = press && getSiblingGroups().get(press.nodeId)
    const node = group && base.children.find((n) => n.id === press.nodeId)
    if (!node) { reorderRef.current = null; return }
    clearTimeout(press.timer)
    const byId = new Map(base.children.map((n) => [n.id, n]))
    const index = group.ids.indexOf(press.nodeId)
    const visualCenter = centerX(node) + (offsetsRef.current.get(node.id)?.x || 0)
    reorderRef.current = {
      phase: 'dragging',
      nodeId: press.nodeId,
      group,
      base,
      slots: group.ids.map((id) => centerX(byId.get(id))),
      index,
      originalIndex: index,
      layouts: new Map([[index, base]]),
      grab: worldX(clientX) - visualCenter,
      targetCenter: visualCenter,
      pointer: press.pointer,
    }
    swapLayout(base, press.nodeId)
    // Le geste n'est ni un panoramique ni un clic
    isDragging.current = false
    hasDragged.current = true
    hoveredNodeId.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
    if (press.pointer === 'touch') navigator.vibrate?.(8)
    if (press.pointer === 'mouse') {
      const move = (e) => updateReorder(e.clientX)
      const up = () => endReorder(true)
      reorderWindowListeners.current = { move, up }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
  }, [getSiblingGroups, worldX, swapLayout, updateReorder, endReorder, isDragging, hasDragged])

  // Appui sur une personne réordonnable : la souris attend quelques pixels, le doigt un appui long
  const beginReorderPress = useCallback((clientX, clientY, pointer) => {
    const node = reorderTargetAt(clientX, clientY)
    if (!node) return false
    const press = { phase: 'pressing', nodeId: node.id, pointer, startX: clientX, startY: clientY, lastX: clientX, timer: null }
    if (pointer === 'touch') press.timer = setTimeout(() => { if (reorderRef.current === press) startReorder(press.lastX) }, REORDER_LONG_PRESS_MS)
    reorderRef.current = press
    return true
  }, [reorderTargetAt, startReorder])

  // Flèches de la fiche : même animation, une place à gauche ou à droite
  const moveSibling = useCallback((personId, delta) => {
    if (reorderRef.current || !canReorderNow()) return false
    const nodeId = `p-${personId}`
    const group = getSiblingGroups().get(nodeId)
    if (!group) return false
    const index = group.ids.indexOf(nodeId)
    const target = index + delta
    if (target < 0 || target >= group.ids.length) return false
    const base = layoutDataRef.current
    const order = moveInOrder(group.ids, nodeId, target)
    swapLayout(layoutForOrder(group, order, base), nodeId)
    commitOrder(group, order, base)
    return true
  }, [canReorderNow, getSiblingGroups, swapLayout, layoutForOrder, commitOrder])

  const getSiblingPlace = useCallback((personId) => {
    if (!USE_BLOCK_LAYOUT || !layoutDataRef.current) return null
    const group = getSiblingGroups().get(`p-${personId}`)
    return group ? { index: group.ids.indexOf(`p-${personId}`), count: group.ids.length } : null
  }, [getSiblingGroups])

  // Échap annule le glisser en cours
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && reorderRef.current?.phase === 'dragging') endReorder(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [endReorder])

  // Sortie du mode édition pendant un geste : on annule
  useEffect(() => { if (!reorderEnabled && reorderRef.current) endReorder(false) }, [reorderEnabled, endReorder])

  // Expose zoom API to parent (ZoomControl component), posée au commit et non pendant le rendu
  useImperativeHandle(zoomApiRef, () => ({
    zoomTo: (newScale) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const cx = rect.width / 2
      const cy = rect.height / 2
      const base = targetTransformRef.current
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale))
      const ratio = clamped / base.scale
      targetTransformRef.current = {
        scale: clamped,
        x: cx - ratio * (cx - base.x),
        y: cy - ratio * (cy - base.y),
      }
    },
    resetZoom: () => {
      if (initialTransformRef.current) {
        targetTransformRef.current = { ...initialTransformRef.current }
      }
    },
    // Recherche : glisse jusqu'à la personne, dans la partie de l'écran que la fiche ne couvre pas
    // (fiche à gauche sur ordinateur, 408 px ; par le bas sur téléphone)
    focusPerson: (personId) => {
      const canvas = canvasRef.current
      const node = layoutDataRef.current?.children.find(n => n.id === `p-${personId}`)
      // Rangée dans un autre onglet : on ouvre cet onglet, la personne est visée une fois l'arbre posé
      if (!node && familyTabsRef.current) {
        const id = String(personId)
        const all = tabsCacheRef.current.tabs
        const home = all.find((tb) => tb.personIds?.has(id) && !(tb.hinges || []).map(String).includes(id)) || all.find((tb) => tb.personIds?.has(id)) || all[0]
        if (home && home.key !== activeTabRef.current?.key) { pendingFocusRef.current = id; chooseTab(home.key) }
        return
      }
      if (!canvas || !node) return
      const rect = canvas.getBoundingClientRect()
      const pos = getAnimatedPos(node, performance.now())
      const scale = Math.min(MAX_SCALE, Math.max(targetTransformRef.current.scale, 1))
      const phone = rect.width <= 768
      const screenX = phone ? rect.width / 2 : (408 + rect.width) / 2
      const screenY = phone ? rect.height * 0.22 : rect.height / 2
      targetTransformRef.current = { scale, x: screenX - pos.cx * scale, y: screenY - pos.cy * scale }
    },
    getScale: () => transformRef.current.scale,
    moveSibling,
    getSiblingPlace,
    MIN_SCALE,
    MAX_SCALE,
  }), [getAnimatedPos, moveSibling, getSiblingPlace])

  // Zoom util (used by pinch)
  const zoomAt = useCallback((factor, center) => {
    const base = targetTransformRef.current
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, base.scale * factor))
    const ratio = newScale / base.scale
    isZooming.current = true
    if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current)
    zoomTimeoutRef.current = setTimeout(() => { isZooming.current = false }, 220)
    targetTransformRef.current = {
      scale: newScale,
      x: center.x - ratio * (center.x - base.x),
      y: center.y - ratio * (center.y - base.y),
    }
  }, [isZooming, targetTransformRef, zoomTimeoutRef])

  // Resize canvas to device pixel ratio. Le CSS donne au canvas toute la page (.galaxy-canvas) ; on lit sa taille
  // réelle. Avec window.innerHeight, Safari sur iPad gardait une hauteur prise clavier ou barre ouverte, sans
  // événement resize ensuite : l'arbre s'arrêtait net au-dessus du bas de l'écran.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const resize = () => {
      const cssW = canvas.clientWidth || window.innerWidth
      const cssH = canvas.clientHeight || window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.floor(cssW * dpr), h = Math.floor(cssH * dpr)
      if (canvas.width === w && canvas.height === h && dprRef.current === dpr) return
      dprRef.current = dpr
      canvas.width = w
      canvas.height = h
      needsRedrawRef.current = true
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    window.addEventListener('resize', resize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  // Liste arrivée : l'arbre affiché (famille de départ) ne change pas, ses pastilles prennent le nom et le compte de
  // l'onglet où elles mènent
  const applyTabs = useCallback((req, list) => {
    if (tabsRequestRef.current !== req) return
    tabsRequestRef.current = null
    tabsCacheRef.current = { rev: req.rev, start: req.start, tabs: list }
    setTabs(list)
    for (const n of layoutDataRef.current?.children || []) {
      const target = n._familyTab && list.find((tb) => tb.key === n._familyTab.tabKey)
      if (target) n._familyTab = { ...n._familyTab, label: target.label, count: target.count }
    }
    needsRedrawRef.current = true
  }, [])

  // Lance le calcul de la liste dans un worker ; faux si le navigateur ne le permet pas (on calcule alors sur place)
  const requestTabs = useCallback((rev, start, referenceId) => {
    cancelTabsRequest()
    if (typeof Worker === 'undefined') return false
    let worker
    try {
      worker = new Worker(new URL('./galaxy/familyTabsWorker.js', import.meta.url), { type: 'module' })
      worker.postMessage({ graph: { persons: graphPersons, unions: graphUnions, filiations: graphFiliations }, referenceId })
    } catch {
      worker?.terminate()
      return false
    }
    const req = { rev, start, worker }
    tabsRequestRef.current = req
    // Échec du worker : la liste est calculée sur place, sans toucher aux couples de l'arbre affiché
    const fallback = () => {
      if (tabsRequestRef.current !== req) return
      const meta = coupleBarMeta
      const list = familyTabsOf(null, referenceId)
      restoreCoupleBarMeta(meta)
      applyTabs(req, list)
    }
    worker.onmessage = ({ data }) => {
      worker.terminate()
      if (data.error) fallback()
      else applyTabs(req, data.tabs)
    }
    worker.onerror = () => { worker.terminate(); fallback() }
    return true
  }, [cancelTabsRequest, applyTabs])

  // Layout
  useEffect(() => {
    // Onglets : la liste des familles, une fois par version du graphe et par personne de départ. Calculée
    // avant l'arbre affiché, parce que chaque calcul de placement remplit les couples du module (coupleBarMeta)
    const start = startRefRef.current != null ? String(startRefRef.current) : null
    const cache = tabsCacheRef.current
    let freshTabs = null
    // Liste en attente du worker : l'arbre affiché est celui de la famille de départ
    let tabsPending = false
    if (USE_BLOCK_LAYOUT && familyTabs && (cache.rev !== graphRevision || cache.start !== start)) {
      const pending = tabsRequestRef.current
      // Dans un onglet d'une autre famille, ou à l'arrivée par le lien d'un onglet, l'arbre affiché dépend de la
      // liste : elle est calculée sur place
      const inOtherTab = Boolean(cache.tabs.find((tb) => tb.key === activeKey)?.personIds)
      if (!inOtherTab && pendingFamilyRef.current == null) {
        tabsPending = (pending && pending.rev === graphRevision && pending.start === start) || requestTabs(graphRevision, start, startRefRef.current)
      }
      if (!tabsPending) {
        cancelTabsRequest()
        freshTabs = familyTabsOf(null, startRefRef.current)
        tabsCacheRef.current = { rev: graphRevision, start, tabs: freshTabs }
        setTabs(freshTabs)
      }
    }
    if (!familyTabs) {
      cancelTabsRequest()
      if (tabsCacheRef.current.tabs.length) { tabsCacheRef.current = { rev: -1, start: undefined, tabs: [] }; setTabs([]) }
    }
    // La famille du lien : son onglet s'il existe dans ce navigateur, sinon l'arbre entier ouvert sur sa charnière
    if (pendingFamilyRef.current != null && graphPersons.length) {
      const key = pendingFamilyRef.current
      pendingFamilyRef.current = null
      if (familyTabs && tabsCacheRef.current.tabs.some((tb) => tb.key === key)) {
        frameOnRef.current = null
        if (key !== activeKey) { setActiveKey(key); return }
      } else frameOnRef.current = key
    }
    const tab = familyTabs && !tabsPending ? (tabsCacheRef.current.tabs.find((tb) => tb.key === activeKey) || tabsCacheRef.current.tabs[0] || null) : null
    activeTabRef.current = tab
    // La personne de départ (ou la charnière de l'onglet) sert de référence aux rangées
    focusPersonIdRef.current = tab ? tab.referenceId : startRefRef.current
    // Dans l'onglet d'une autre famille, la personne commune (« C'est moi », sinon la personne de départ) reste
    // là, reliée par sa ligne directe (Patch, 21/10 : « je veux me voir tout le temps »)
    const line = tab?.personIds ? lineToFamily(selfPersonId ?? startRefRef.current ?? tabsCacheRef.current.tabs[0]?.resolvedRef, tab.personIds) : new Set()
    const tabGraph = tab?.personIds ? subgraphOf(new Set([...tab.personIds, ...line])) : null
    const graph = hasGhosts(ghosts)
      ? withGhosts(tabGraph || { persons: graphPersons, unions: graphUnions, filiations: graphFiliations }, ghosts, !tabGraph)
      : tabGraph
    // Annotations d'avant l'ancrage (x, y seuls) : rattachées une fois à la personne la plus proche dans le
    // placement de l'onglet de départ, puis enregistrées. Calculé avant l'arbre affiché (coupleBarMeta, voir plus haut)
    const legacy = annotationData.some((a) => !readAnchor(a))
    const departure = legacy && USE_BLOCK_LAYOUT && graph ? computeBlockLayout(null, startRefRef.current, { familyTabs }) : null
    // Famille de départ sans propositions : son placement vient d'être calculé avec la liste des onglets
    const kept = USE_BLOCK_LAYOUT && !graph && tab === freshTabs?.[0] ? takeRootLayout(freshTabs, focusPersonIdRef.current) : null
    const result = kept || (USE_BLOCK_LAYOUT ? computeBlockLayout(graph, focusPersonIdRef.current, { familyTabs }) : computeLayout(null, focusPersonIdRef.current))
    if (legacy) {
      const anchored = anchorLegacy(annotationData, layoutCenters(departure || result))
      for (const ann of anchored) updateAnnotationInStore(ann.id, { style: ann.style })
      if (anchored.length) onAnnotationsAnchoredRef.current?.(anchored)
    }
    // Les pastilles portent le nom de l'onglet où elles mènent (prénoms ajoutés aux homonymes)
    for (const n of result.children) {
      const target = n._familyTab && tabsCacheRef.current.tabs.find((tb) => tb.key === n._familyTab.tabKey)
      if (target) n._familyTab = { ...n._familyTab, label: target.label, count: target.count }
    }
    for (const n of result.children) if (n._type === 'person' && line.has(n.id.replace(/^p-/, ''))) n._line = true
    // Dans l'onglet d'une belle-famille, chaque charnière (conjoint marié dans la famille d'où l'on vient)
    // porte le badge de retour
    if (tab?.parentKey) {
      const parent = tabsCacheRef.current.tabs.find((tb) => tb.key === tab.parentKey)
      for (const h of (tab.hinges || [tab.referenceId])) {
        const node = result.children.find((n) => n.id === `p-${h}`)
        if (parent && node) node._familyTab = { anchorId: node.id, label: parent.label, count: parent.count, tabKey: parent.key, place: 'above', back: true }
      }
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const cssW = canvas.clientWidth || window.innerWidth
    const cssH = canvas.clientHeight || window.innerHeight

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    result.children.forEach(n => {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.width)
      maxY = Math.max(maxY, n.y + n.height)
    })
    const graphW = maxX - minX
    const graphH = maxY - minY
    const maxInitScale = 1.2
    const padding = 80
    const fitScale = Math.min(
      (cssW - padding * 2) / Math.max(graphW, 1),
      (cssH - padding * 2) / Math.max(graphH, 1),
      maxInitScale,
    )
    let scale = Math.max(MIN_SCALE, fitScale)
    let offsetX = (cssW - graphW * scale) / 2 - minX * scale
    let offsetY = (cssH - graphH * scale) / 2 - minY * scale

    // Grand arbre : vu en entier, les portraits deviennent des pastilles illisibles.
    // On ouvre sur la personne de départ, à une taille où l'on reconnaît les visages.
    const focusId = frameOnRef.current ?? focusPersonIdRef.current
    const personNodes = result.children.filter((n) => n._type === 'person')
    let focusNode = focusId != null
      ? personNodes.find((n) => String(n._data?.id) === String(focusId))
      : null
    // Sans personne de départ : la personne avec un portrait la plus proche du centre de la famille
    if (!focusNode && personNodes.length > 0) {
      const cx = personNodes.reduce((sum, n) => sum + n.x + n.width / 2, 0) / personNodes.length
      const cy = personNodes.reduce((sum, n) => sum + n.y + n.height / 2, 0) / personNodes.length
      const candidates = personNodes.some((n) => n._data?.photo) ? personNodes.filter((n) => n._data?.photo) : personNodes
      focusNode = candidates.reduce((best, n) => {
        const d = (n.x + n.width / 2 - cx) ** 2 + (n.y + n.height / 2 - cy) ** 2
        return !best || d < best.d ? { n, d } : best
      }, null)?.n || null
    }
    if (focusNode && fitScale < FOCUS_MIN_READABLE_SCALE) {
      scale = FOCUS_SCALE
      offsetX = (cssW < 768 ? (PHONE_SLIDER_BAND + cssW) / 2 : cssW / 2) - (focusNode.x + focusNode.width / 2) * scale
      // Sur un écran étroit, la barre des familles couvre le haut : la personne de départ un peu plus bas. Plus de
      // fiche ouverte à l'arrivée sur téléphone (#188) : 0,4 et non plus 0,56, sinon le haut de l'écran reste vide
      offsetY = cssH * (cssW < 768 ? 0.4 : 0.42) - (focusNode.y + focusNode.height / 2) * scale
    }

    const anc = anchorRef.current
    anchorRef.current = null
    const ancNode = anc && personNodes.find((n) => String(n._data?.id) === anc.id)
    if (ancNode) {
      scale = anc.scale
      offsetX = anc.sx - (ancNode.x + ancNode.width / 2) * scale
      offsetY = anc.sy - (ancNode.y + ancNode.height / 2) * scale
    }

    const init = { x: offsetX, y: offsetY, scale }
    initialTransformRef.current = init
    transformRef.current = init
    targetTransformRef.current = init
    nodeRandomDataRef.current = generateNodeRandomData(result.children, result.edges)

    // Entrée, à la première ouverture de l'arbre seulement. La caméra part serrée sur la personne de départ et
    // recule jusqu'à la vue d'arrivée ; chaque personne apparaît quand elle entre dans le champ, la personne de
    // départ dès la première image. On reprend la main à tout moment (le recul s'arrête au premier geste).
    // Mouvements réduits : pas de recul, un fondu court. Ensuite (modification, autre onglet) : rien ne s'anime.
    const nodeSchedule = new Map()
    const coupleSchedule = new Map()
    const edgeSchedule = new Map()
    const orbitSchedule = new Map()
    let maxEndMs = 0
    let camera = null
    const treeKey = String(graphPersons[0]?.id ?? '')
    const firstOpen = treeKey !== '' && openedTreeRef.current !== treeKey
    if (treeKey) openedTreeRef.current = treeKey
    if (!firstOpen) {
      for (const n of result.children) nodeSchedule.set(n.id, { startMs: -Infinity, duration: 1 })
    } else if (prefersReducedMotion() || !focusNode) {
      for (const n of result.children) nodeSchedule.set(n.id, { startMs: 0, duration: ENTRANCE_REDUCED_DURATION })
      maxEndMs = ENTRANCE_REDUCED_DURATION
    } else {
      const fx = focusNode.x + focusNode.width / 2, fy = focusNode.y + focusNode.height / 2
      const sx = fx * init.scale + init.x, sy = fy * init.scale + init.y
      const at = (sc) => ({ scale: sc, x: sx - fx * sc, y: sy - fy * sc })
      camera = { from: at(Math.min(MAX_SCALE, Math.max(ENTRANCE_CAMERA_FROM_SCALE, init.scale * 1.6))), to: init, durationMs: ENTRANCE_CAMERA_DURATION }
      camera.last = camera.from
      // Instant où le recul fait entrer la personne dans le champ (marge de 40 px), ou null si elle reste dehors
      const entersAt = (n) => {
        const nx = n.x + n.width / 2 - fx, ny = n.y + n.height / 2 - fy
        for (let i = 0; i <= 60; i++) {
          const sc = camera.from.scale + (init.scale - camera.from.scale) * easeOutQuint(i / 60)
          const px = sx + nx * sc, py = sy + ny * sc
          if (px > -40 && px < cssW + 40 && py > -40 && py < cssH + 40) return (i / 60) * camera.durationMs
        }
        return null
      }
      for (const n of result.children) {
        const t = n === focusNode ? 0 : entersAt(n)
        if (t == null) { nodeSchedule.set(n.id, { startMs: -Infinity, duration: 1 }); continue }
        const startMs = t === 0 ? 0 : Math.max(0, t - 120) + Math.random() * 40
        nodeSchedule.set(n.id, { startMs, duration: ENTRANCE_NODE_DURATION })
        maxEndMs = Math.max(maxEndMs, startMs + ENTRANCE_NODE_DURATION)
      }
      transformRef.current = camera.from
      targetTransformRef.current = camera.from
    }

    coupleBarMeta.forEach(({ elkId, p1Key, p2Key }) => {
      const s1 = nodeSchedule.get(p1Key)
      const s2 = nodeSchedule.get(p2Key)
      if (s1 && s2) {
        const startMs = Math.max(s1.startMs, s2.startMs) + ENTRANCE_NODE_DURATION * 0.5 + ENTRANCE_LINE_DELAY * 0.3
        coupleSchedule.set(elkId, { startMs, duration: ENTRANCE_LINE_DURATION })
        maxEndMs = Math.max(maxEndMs, startMs + ENTRANCE_LINE_DURATION)
      }
    })

    if (result.edges) {
      result.edges.forEach(edge => {
        const sourceId = edge.sources[0]
        const sSource = nodeSchedule.get(sourceId)
        if (sSource) {
          const startMs = sSource.startMs + ENTRANCE_LINE_DELAY
          edgeSchedule.set(edge.id, { startMs, duration: ENTRANCE_LINE_DURATION })
          maxEndMs = Math.max(maxEndMs, startMs + ENTRANCE_LINE_DURATION)
        }
      })
    }

    result.children.forEach(node => {
      if (node._type !== 'person') return
      const sNode = nodeSchedule.get(node.id)
      if (!sNode) return
      const pMedias = getPersonMedias(node._data.id)
      const count = Math.min(pMedias.length, MAX_ORBIT_MEDIAS)
      for (let i = 0; i < count; i++) {
        const startMs = sNode.startMs + sNode.duration + ENTRANCE_ORBIT_DELAY + i * ENTRANCE_ORBIT_STAGGER
        orbitSchedule.set(`${node.id}:${i}`, { startMs, duration: ENTRANCE_ORBIT_DURATION })
        maxEndMs = Math.max(maxEndMs, startMs + ENTRANCE_ORBIT_DURATION)
      }
    })

    entranceRef.current = {
      camera,
      startTime: -1,
      nodeSchedule, coupleSchedule, edgeSchedule, orbitSchedule,
      totalDurationMs: maxEndMs,
      finished: false,
    }

    offsetsRef.current = new Map()
    reorderRef.current = null
    layoutDataRef.current = result
    needsRedrawRef.current = true
    setLayoutReady(true)
    if (pendingFocusRef.current) {
      const id = pendingFocusRef.current
      pendingFocusRef.current = null
      requestAnimationFrame(() => zoomApiRef?.current?.focusPerson?.(id))
    }
  }, [graphRevision, activeKey, familyTabs, selfPersonId, ghosts, requestTabs, cancelTabsRequest])

  // Onglet ouvert, remonté pour l'adresse de la page et le lien de partage ; null pour la famille de départ
  useEffect(() => {
    if (pendingFamilyRef.current != null) return
    const open = familyTabs && tabs.length > 1 ? tabs.find((tb) => tb.key === activeKey) : null
    onFamilyChangeRef.current?.(open && open !== tabs[0] ? { key: open.key, label: open.label } : null)
  }, [activeKey, tabs, familyTabs])

  // Sync selectedPersonId
  useEffect(() => {
    selectedPersonIdRef.current = selectedPersonId
  }, [selectedPersonId])

  // Sync searchHighlightIds
  const searchHighlightIdsRef = useRef(searchHighlightIds)
  useEffect(() => {
    searchHighlightIdsRef.current = searchHighlightIds
    searchHighlightSetRef.current = new Set(searchHighlightIds.map(id => `p-${id}`))
  }, [searchHighlightIds])

  // Recalculer les proches immédiats
  useEffect(() => {
    const relatives = new Set()
    if (selectedPersonId != null) {
      getParents(selectedPersonId).forEach(p => relatives.add(`p-${p.id}`))
      getChildren(selectedPersonId).forEach(c => relatives.add(`p-${c.id}`))
      getPersonUnions(selectedPersonId).forEach(u => {
        const spouseId = u.partner1Id === selectedPersonId ? u.partner2Id : u.partner1Id
        relatives.add(`p-${spouseId}`)
      })
    }
    immediateRelativesRef.current = relatives
  }, [selectedPersonId])

  // Boucle d'animation + rendu canvas
  useEffect(() => {
    if (!layoutReady) return

    let rafId

    const animate = (timestamp) => {
      let dirty = needsRedrawRef.current
      needsRedrawRef.current = false

      const entrance = entranceRef.current
      if (entrance && entrance.startTime < 0) entrance.startTime = timestamp
      const elapsed = entrance ? timestamp - entrance.startTime : Infinity
      const entranceActive = entrance && !entrance.finished
      if (entranceActive && elapsed > entrance.totalDurationMs + 100) entrance.finished = true
      // Pendant l'entrée et le fondu des annotations qui la suit, on redessine chaque frame
      if (entrance && elapsed < entrance.totalDurationMs + 500) dirty = true

      // Recul de la caméra à l'ouverture, abandonné dès qu'on déplace ou zoome soi-même l'arbre
      const cam = entrance?.camera
      if (cam) {
        if (targetTransformRef.current !== cam.last) entrance.camera = null
        else {
          const k = easeOutQuint(Math.min(1, Math.max(0, elapsed / cam.durationMs)))
          const t = {
            scale: cam.from.scale + (cam.to.scale - cam.from.scale) * k,
            x: cam.from.x + (cam.to.x - cam.from.x) * k,
            y: cam.from.y + (cam.to.y - cam.from.y) * k,
          }
          transformRef.current = t
          targetTransformRef.current = t
          cam.last = t
          dirty = true
          if (k >= 1) entrance.camera = null
        }
      }
      // Lissage du transform
      const target = targetTransformRef.current
      const prev = transformRef.current
      const easing = isDragging.current ? 0.24 : isZooming.current ? 0.08 : 0.14
      const next = {
        x: approach(prev.x, target.x, easing, 0.05),
        y: approach(prev.y, target.y, easing, 0.05),
        scale: approach(prev.scale, target.scale, easing, 1e-4),
      }
      if (next.x !== prev.x || next.y !== prev.y || next.scale !== prev.scale) dirty = true
      transformRef.current = next

      // Réordonnancement : la personne tenue suit le pointeur, les autres glissent vers leur place
      const dt = lastFrameRef.current ? Math.min(0.034, (timestamp - lastFrameRef.current) / 1000) : 1 / 60
      lastFrameRef.current = timestamp
      const drag = reorderRef.current?.phase === 'dragging' ? reorderRef.current : null
      if (offsetsRef.current.size > 0) {
        for (const [id, state] of offsetsRef.current) {
          if (drag && id === drag.nodeId) continue
          const next = springStep(state, dt, state.spring)
          if (isSettled(next)) offsetsRef.current.delete(id)
          else offsetsRef.current.set(id, { ...next, spring: state.spring })
        }
        dirty = true
      }
      if (drag && layoutDataRef.current) {
        const held = layoutDataRef.current.children.find((n) => n.id === drag.nodeId)
        if (held) offsetsRef.current.set(drag.nodeId, { x: drag.targetCenter - centerX(held), v: 0, spring: DROP_SPRING })
        dirty = true
      }
      for (const [id, value] of liftScalesRef.current) {
        const target = drag && id === drag.nodeId ? 1 : 0
        const next = approach(value, target, 0.28, 0.002)
        if (next === 0 && target === 0) liftScalesRef.current.delete(id)
        else liftScalesRef.current.set(id, next)
        if (next !== value) dirty = true
      }
      if (drag && !liftScalesRef.current.has(drag.nodeId)) { liftScalesRef.current.set(drag.nodeId, 0); dirty = true }

      const layoutData = layoutDataRef.current
      const canvas = canvasRef.current
      if (!layoutData || !canvas) { rafId = requestAnimationFrame(animate); return }
      const { x, y, scale } = transformRef.current

      // Lissage hover states
      const hoverEasing = 0.12
      layoutData.children.forEach(node => {
        if (node._type !== 'person') return
        const targetScale = hoveredNodeId.current === node.id ? 1 : 0
        const prevScale = hoverScales.current.get(node.id) || 0
        const newScale = approach(prevScale, targetScale, hoverEasing)
        if (newScale !== prevScale) { dirty = true; hoverScales.current.set(node.id, newScale) }
        const rd = nodeRandomDataRef.current.get(node.id)
        const pMedias = getPersonMedias(node._data.id)
        const orbitSlots = rd?.orbitSlots || []
        const orbitCount = Math.min(pMedias.length, MAX_ORBIT_MEDIAS)
        for (let i = 0; i < orbitCount; i++) {
          const key = `${node.id}:${i}`
          const slot = orbitSlots[i]
          if (!slot) continue
          const isHovered = hoveredMediaKey.current === key
          const prevMh = mediaHoverState.current.get(key) || { scale: 0, dx: 0, dy: 0 }
          const dirX = Math.cos(slot.angle)
          const dirY = Math.sin(slot.angle)
          const targetS = isHovered ? 1 : 0
          const targetDx = isHovered ? dirX * 6 : 0
          const targetDy = isHovered ? dirY * 6 : 0
          const nextMh = {
            scale: approach(prevMh.scale, targetS, hoverEasing),
            dx: approach(prevMh.dx, targetDx, hoverEasing),
            dy: approach(prevMh.dy, targetDy, hoverEasing),
          }
          if (nextMh.scale !== prevMh.scale || nextMh.dx !== prevMh.dx || nextMh.dy !== prevMh.dy) {
            dirty = true
            mediaHoverState.current.set(key, nextMh)
          }
        }
      })

      // Lerp annotation drag lift (0 → 1)
      const dragTarget = annotationHandlers?.isDragging ? 1 : 0
      const prevLift = dragLiftProgress.current
      dragLiftProgress.current = approach(prevLift, dragTarget, 0.15, 0.005)
      if (dragLiftProgress.current !== prevLift) dirty = true
      // Outil d'annotation actif : l'aperçu suit la souris, on redessine
      if (annotationHandlers?.activeTool || annotationHandlers?.isDragging) dirty = true
      if (annotationData !== lastAnnotationDataRef.current) { lastAnnotationDataRef.current = annotationData; dirty = true }

      // Lissage glow sélection
      const selectedElkId = selectedPersonIdRef.current != null ? `p-${selectedPersonIdRef.current}` : null
      const selectionEasing = 0.08
      layoutData.children.forEach(node => {
        if (node._type !== 'person') return
        let targetGlow = 0
        if (selectedElkId) {
          if (node.id === selectedElkId) targetGlow = 1.0
          else if (immediateRelativesRef.current.has(node.id)) targetGlow = 0.6
        }
        const prevGlow = selectedGlowScales.current.get(node.id) || 0
        const nextGlow = approach(prevGlow, targetGlow, selectionEasing)
        if (nextGlow !== prevGlow) { dirty = true; selectedGlowScales.current.set(node.id, nextGlow) }
      })

      // Animation search highlight glow
      const searchEasing = 0.12
      const searchHighlightSet = searchHighlightSetRef.current
      layoutData.children.forEach(node => {
        if (node._type !== 'person') return
        const targetSearchGlow = searchHighlightSet.has(node.id) ? 1.2 : 0
        const prevSearchGlow = searchGlowScales.current.get(node.id) || 0
        const nextSearchGlow = approach(prevSearchGlow, targetSearchGlow, searchEasing)
        if (nextSearchGlow !== prevSearchGlow) { dirty = true; searchGlowScales.current.set(node.id, nextSearchGlow) }
      })

      // Chemin BFS
      const currentHovered = hoveredNodeId.current
      const pathInputChanged = lastPathInputRef.current.selected !== selectedElkId ||
                                lastPathInputRef.current.hovered !== currentHovered
      if (pathInputChanged) {
        dirty = true
        lastPathInputRef.current = { selected: selectedElkId, hovered: currentHovered }
        if (selectedElkId && currentHovered && currentHovered !== selectedElkId && currentHovered.startsWith('p-')) {
          const result = findPathBFS(selectedElkId, currentHovered, layoutData, graphPersons)
          pathNodesRef.current = result ? result.nodePath : []
          pathEdgesRef.current = result ? result.edgePath : []
          pathLabelRef.current = result ? result.label : ''
          pathStartTime.current = timestamp
        } else {
          pathNodesRef.current = []
          pathEdgesRef.current = []
          pathLabelRef.current = ''
          pathStartTime.current = -1
        }
      }

      // Lissage highlight chemin
      const PATH_EDGE_STAGGER = 120
      const PATH_EDGE_DURATION = 300
      const pathElapsed = pathStartTime.current > 0 ? timestamp - pathStartTime.current : -1
      const pathEasing = 0.12

      for (let i = 0; i < pathEdgesRef.current.length; i++) {
        const e = pathEdgesRef.current[i]
        const staggeredTarget = pathElapsed >= 0
          ? easeOutCubic(Math.min(1, Math.max(0, (pathElapsed - i * PATH_EDGE_STAGGER) / PATH_EDGE_DURATION)))
          : 0
        if (pathProgressRef.current.get(e.id) !== staggeredTarget) { dirty = true; pathProgressRef.current.set(e.id, staggeredTarget) }
      }
      for (let i = 0; i < pathNodesRef.current.length; i++) {
        const n = pathNodesRef.current[i]
        const edgeIdx = Math.max(0, i - 1)
        const staggeredTarget = pathElapsed >= 0
          ? easeOutCubic(Math.min(1, Math.max(0, (pathElapsed - edgeIdx * PATH_EDGE_STAGGER) / PATH_EDGE_DURATION)))
          : 0
        if (pathProgressRef.current.get(n) !== staggeredTarget) { dirty = true; pathProgressRef.current.set(n, staggeredTarget) }
      }

      // Au repos, rien à éteindre : pas d'ensembles reconstruits à chaque frame
      if (pathProgressRef.current.size > 0) {
        const activePathEdges = new Set(pathEdgesRef.current.map(e => e.id))
        const activePathNodes = new Set(pathNodesRef.current)
        for (const [key, val] of pathProgressRef.current) {
          if (!activePathEdges.has(key) && !activePathNodes.has(key)) {
            dirty = true
            const next = val + (0 - val) * pathEasing
            if (Math.abs(next) < 0.001) pathProgressRef.current.delete(key)
            else pathProgressRef.current.set(key, next)
          }
        }
      }

      const lastEdgeStart = (pathEdgesRef.current.length - 1) * PATH_EDGE_STAGGER
      const targetLabelAlpha = pathElapsed >= 0 && pathElapsed > lastEdgeStart ? 1 : 0
      const prevLabelAlpha = pathLabelAlpha.current
      pathLabelAlpha.current = approach(prevLabelAlpha, targetLabelAlpha, pathEasing)
      if (pathLabelAlpha.current !== prevLabelAlpha) dirty = true

      // Mise à jour de l'overlay HTML (seulement quand la valeur change)
      const newDisplayLabel = pathLabelAlpha.current > 0.05 ? pathLabelRef.current : ''
      if (newDisplayLabel !== displayLabelRef.current) {
        displayLabelRef.current = newDisplayLabel
        setDisplayLabel(newDisplayLabel)
      }

      // Rien n'a changé : on ne redessine pas
      if (!dirty) { rafId = requestAnimationFrame(animate); return }

      // Positions animées, calculées seulement quand on redessine
      const posMap = new Map()
      layoutData.children.forEach(node => {
        posMap.set(node.id, getAnimatedPos(node, timestamp))
      })

      const nodeMap = new Map()
      layoutData.children.forEach(n => nodeMap.set(n.id, n))

      // === RENDU ===
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0)
      drawBackground(ctx, canvas)
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(scale, scale)

      // Fenêtre visible en coordonnées monde (culling + niveau de détail dans les renderers)
      const cssW = canvas.width / dprRef.current
      const cssH = canvas.height / dprRef.current
      const view = { x0: -x / scale, y0: -y / scale, x1: (cssW - x) / scale, y1: (cssH - y) / scale, scale }
      drawCoupleLinks(ctx, coupleBarMeta, posMap, nodeMap, nodeRandomDataRef.current, entrance, entranceActive, elapsed, view)
      drawFiliations(ctx, layoutData.edges, posMap, nodeMap, nodeRandomDataRef.current, entrance, entranceActive, elapsed, view)
      drawPathHighlight(ctx, {
        pathEdgesRef: pathEdgesRef.current,
        pathNodesRef: pathNodesRef.current,
        pathLabelAlpha: pathLabelAlpha.current,
        pathProgressRef: pathProgressRef.current,
        selectedElkId,
        hoveredNodeId: hoveredNodeId.current,
        coupleBarMeta,
        posMap, nodeMap,
        nodeRandomData: nodeRandomDataRef.current,
        layoutData,
      })
      drawNodes(ctx, layoutData, posMap, entrance, entranceActive, elapsed, {
        nodeRandomData: nodeRandomDataRef.current,
        imageCache: imageCache.current,
        hoverScales: hoverScales.current,
        selectedGlowScales: selectedGlowScales.current,
        searchGlowScales: searchGlowScales.current,
        mediaHoverState: mediaHoverState.current,
        entrance, entranceActive, elapsed,
        view,
        liftScales: liftScalesRef.current,
        ghostPatches: ghostsRef.current?.patches || null,
        fullNames: fullNamesRef.current,
      })
      drawRenvoiPills(ctx)
      // Annotations dessinées APRES les noeuds pour que stickers/texte soient au-dessus.
      // Chacune suit le portrait de sa personne dans le placement affiché, absente si la personne n'y est pas.
      // Les centres et les positions servent aussi à poser, toucher et déplacer (useAnnotations)
      // Un texte rouvert pour être modifié n'est pas dessiné sous sa saisie (editingId, posé par useAnnotations)
      const annotationCenters = layoutCenters(layoutData, offsetsRef.current)
      const editingId = annotationViewRef?.current?.editingId ?? null
      const anchoredAnnotations = placeAnnotations(annotationData, annotationCenters)
      if (annotationViewRef) annotationViewRef.current = { editingId, centers: annotationCenters, shown: anchoredAnnotations }

      // Afficher les annotations en dernier, après l'animation d'entrée
      const stickerPreview = annotationHandlers?.activeTool === 'sticker' && annotationHandlers?.selectedSticker
        ? { emoji: annotationHandlers.selectedSticker, x: mouseWorldPos.current.x, y: mouseWorldPos.current.y, fontSize: 40 }
        : null
      const draggingAnnotationId = annotationHandlers?.isDragging ? annotationHandlers.selectedAnnotationId : null
      const entranceAlpha = !entranceActive ? 1 : Math.min(1, Math.max(0, (elapsed - entrance.totalDurationMs) / 300))
      if (entranceAlpha > 0) {
        drawAnnotations(
          ctx,
          [
            ...(editingId ? anchoredAnnotations.filter((a) => a.id !== editingId) : anchoredAnnotations),
            // Annotations proposées : dessinées, jamais touchables (hors de `shown`)
            ...placeAnnotations(ghostsRef.current?.annotations || [], annotationCenters),
          ],
          annotationHandlers?.selectedAnnotationId ?? null,
          annotationHandlers?.drawingPathRef?.current ?? null,
          stickerPreview,
          draggingAnnotationId,
          dragLiftProgress.current,
          entranceAlpha,
          imageCache.current,
        )
      }
      ctx.restore()

      rafId = requestAnimationFrame(animate)
    }

    rafId = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(rafId)
      if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current)
    }
  }, [layoutReady, getAnimatedPos, isDragging, isZooming, zoomTimeoutRef, imageCache])

  // Prevent default wheel
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const prevent = (e) => e.preventDefault()
    canvas.addEventListener('wheel', prevent, { passive: false })
    return () => canvas.removeEventListener('wheel', prevent)
  }, [])

  return (
    <>
    <canvas
      ref={canvasRef}
      className="galaxy-canvas"
      style={{ touchAction: 'none' }}
      onMouseDown={(e) => {
        if (e.button === 0 && beginReorderPress(e.clientX, e.clientY, 'mouse')) { hasDragged.current = false; return }
        handleMouseDown(e)
      }}
      onMouseMove={(e) => {
        needsRedrawRef.current = true
        const press = reorderRef.current
        if (press?.phase === 'dragging') return
        if (press?.phase === 'pressing' && press.pointer === 'mouse') {
          if (Math.abs(e.clientX - press.startX) > REORDER_MOUSE_THRESHOLD || Math.abs(e.clientY - press.startY) > REORDER_MOUSE_THRESHOLD) {
            startReorder(press.startX)
            updateReorder(e.clientX)
          }
          return
        }
        handleMouseMove(e)
        // En mode édition, une personne réordonnable se saisit
        if (canvasRef.current && hoveredNodeId.current && reorderEnabledRef.current && getSiblingGroups().has(hoveredNodeId.current)) {
          canvasRef.current.style.cursor = 'grab'
        }
      }}
      onMouseUp={(e) => {
        const press = reorderRef.current
        if (press?.phase === 'pressing') reorderRef.current = null
        if (press?.phase === 'dragging') return
        handleMouseUp(e)
      }}
      onMouseLeave={(e) => { needsRedrawRef.current = true; if (reorderRef.current?.phase !== 'dragging') handleMouseLeave(e) }}
      onWheel={handleWheel}
      onTouchStart={(e) => {
        if (e.touches.length === 1) {
          const t = e.touches[0]
          // Appui long sur une personne réordonnable ; d'ici là, le doigt fait défiler l'arbre comme d'habitude
          beginReorderPress(t.clientX, t.clientY, 'touch')
          handleMouseDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() })
        } else if (e.touches.length === 2) {
          e.preventDefault()
          // Un deuxième doigt annule le glisser d'une personne (retour à sa place, rien n'est enregistré)
          if (reorderRef.current) endReorder(false)
          // Stop any ongoing single-finger pan before starting pinch
          handleMouseUp()
          const [a, b] = e.touches
          const dx = a.clientX - b.clientX
          const dy = a.clientY - b.clientY
          const dist = Math.hypot(dx, dy)
          const center = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
          pinchRef.current = { dist, center }
        }
      }}
      onTouchMove={(e) => {
        needsRedrawRef.current = true
        if (e.touches.length === 1) {
          const t = e.touches[0]
          const press = reorderRef.current
          if (press?.phase === 'dragging') { updateReorder(t.clientX); return }
          if (press?.phase === 'pressing') {
            press.lastX = t.clientX
            if (Math.hypot(t.clientX - press.startX, t.clientY - press.startY) > REORDER_TOUCH_SLOP) endReorder(false)
          }
          handleMouseMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() })
        } else if (e.touches.length === 2) {
          e.preventDefault()
          const [a, b] = e.touches
          const dx = a.clientX - b.clientX
          const dy = a.clientY - b.clientY
          const dist = Math.hypot(dx, dy)
          const center = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
          if (pinchRef.current) {
            const factor = dist / pinchRef.current.dist
            zoomAt(factor, center)
            pinchRef.current = { dist, center }
          } else {
            pinchRef.current = { dist, center }
          }
        }
      }}
      onTouchEnd={(e) => {
        if (reorderRef.current && e.touches.length === 0) {
          const wasDragging = reorderRef.current.phase === 'dragging'
          endReorder(true)
          if (wasDragging) { handleMouseUp(); return }
        }
        pinchRef.current = null
        if (e.touches.length === 1) {
          // One finger remains after pinch: restart single-finger pan with it
          // and mark hasDragged=true so the lift doesn't fire an accidental click
          const t = e.touches[0]
          handleMouseUp()
          handleMouseDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() })
          hasDragged.current = true
        } else {
          handleMouseUp()
        }
      }}
      onTouchCancel={() => {
        // System interruption (notification, keyboard, etc.) — reset all touch state
        if (reorderRef.current) endReorder(false)
        pinchRef.current = null
        handleMouseUp()
      }}
      onClick={handleClick}
    />
    {displayLabel && (
      <div className="path-label-overlay">{displayLabel}</div>
    )}
    {familyTabs && tabs.length > 1 && (
      <nav ref={tabsBarRef} onScroll={updateTabsEdges} className={`family-tabs${annotationHandlers ? ' family-tabs--lowered' : ''}${tabsEdges}`} aria-label={tr('Familles')}>
        {barTabs(tabs, activeKey).map(({ tb, gap, trait }) => {
          const active = tb.key === (tabs.some((x) => x.key === activeKey) ? activeKey : tabs[0].key)
          return (
            <button
              key={tb.key}
              type="button"
              style={gap ? { marginLeft: gap } : undefined}
              className={`family-tab${active ? ' is-active' : ''}${trait ? ` family-tab--suite family-tab--trait-${trait}` : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => chooseTab(tb.key)}
              onMouseEnter={() => { if (!active) hoverTab(tb.key) }}
              onMouseLeave={leaveTab}
              onFocus={() => { if (!active) hoverTab(tb.key) }}
              onBlur={leaveTab}
            >
              <span className="family-tab-name">{tb.label ? tr('Famille {name}', { name: tb.label }) : tr('Famille')}</span>
              <span className="family-tab-count" title={tr('{n} personnes', { n: tb.count })}>{tb.count}</span>
            </button>
          )
        })}
      </nav>
    )}
    </>
  )
}

export default memo(Galaxy)
