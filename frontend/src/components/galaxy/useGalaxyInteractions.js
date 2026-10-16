import { useRef, useCallback, useEffect } from 'react'
import { getPersonMedias } from '../../data/mockData'
import { MAX_ORBIT_MEDIAS, ORBIT_MEDIA_SIZE } from './constants'
import { nodeRadius, renvoiHitAreas } from './renderers'

const hitRenvoi = (x, y) => renvoiHitAreas.find(a => x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1)
import { getEntranceProgress } from './utils'

const CURSOR_GRAB = 'default'
const CURSOR_GRABBING = 'grabbing'
const CURSOR_NODE_GRAB = 'grab'
const CURSOR_POINTER = 'pointer'
const CURSOR_CROSSHAIR = 'crosshair'

const setCanvasCursor = (canvasRef, cursor) => {
  if (!canvasRef.current) return
  if (canvasRef.current.style.cursor === cursor) return
  canvasRef.current.style.cursor = cursor
}

export function useGalaxyInteractions({
  canvasRef, transformRef, targetTransformRef,
  layoutDataRef, nodeRandomDataRef, entranceRef,
  hoveredNodeIdRef, hoveredMediaKeyRef, mouseWorldPosRef,
  getAnimatedPos, onPersonSelect, onMediaSelect,
  onPersonPositionChange, editModeActive = false,
  annotationHandlers,
  minScale = 0.2,
  maxScale = 4,
}) {
  const isDragging = useRef(false)
  const isZooming = useRef(false)
  const zoomTimeoutRef = useRef(null)
  const lastMouse = useRef({ x: 0, y: 0 })
  const hasDragged = useRef(false)
  const annotationDragging = useRef(false)
  const draggedPersonRef = useRef(null)
  const handleMouseUpRef = useRef(null)
  const handleGlobalMouseUp = useCallback(() => {
    handleMouseUpRef.current?.()
  }, [])

  const getWorldPos = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    const t = transformRef.current
    return {
      x: (e.clientX - rect.left - t.x) / t.scale,
      y: (e.clientY - rect.top - t.y) / t.scale,
    }
  }, [canvasRef, transformRef])

  // panOnly : un doigt qui reste après un pincement ne saisit pas de personne, il ne fait que déplacer l'arbre
  const handleMouseDown = useCallback((e, { panOnly = false } = {}) => {
    const ah = annotationHandlers
    const worldPos = getWorldPos(e)

    // Drawing tool: start path
    if (ah && ah.activeTool === 'drawing' && worldPos) {
      ah.onCanvasMouseDown(worldPos.x, worldPos.y)
      return
    }

    // Pointer tool: hit any annotation → select + drag immediately
    if (ah && ah.activeTool === 'pointer' && worldPos) {
      const hit = ah.hitTest(worldPos.x, worldPos.y)
      if (hit) {
        annotationDragging.current = true
        ah.onAnnotationDragStart(worldPos.x, worldPos.y, hit.id)
        hasDragged.current = false
        lastMouse.current = { x: e.clientX, y: e.clientY }
        return
      }
    }

    if (editModeActive && !panOnly && (!ah || ah.activeTool === 'pointer') && worldPos && layoutDataRef.current) {
      const now = performance.now()
      for (let index = layoutDataRef.current.children.length - 1; index >= 0; index -= 1) {
        const node = layoutDataRef.current.children[index]
        if (node._type !== 'person') continue
        const pos = getAnimatedPos(node, now)
        if (Math.hypot(pos.cx - worldPos.x, pos.cy - worldPos.y) >= nodeRadius(node)) continue

        draggedPersonRef.current = {
          node,
          offsetX: worldPos.x - pos.cx,
          offsetY: worldPos.y - pos.cy,
          startClientX: e.clientX,
          startClientY: e.clientY,
          // Place d'origine, pour un glisser annulé (second doigt, interruption)
          originX: node.x,
          originY: node.y,
          originManual: node._manualPosition,
        }
        hoveredNodeIdRef.current = node.id
        hasDragged.current = false
        lastMouse.current = { x: e.clientX, y: e.clientY }
        setCanvasCursor(canvasRef, CURSOR_GRABBING)
        if (e.nativeEvent?.type === 'mousedown' && typeof window !== 'undefined' && handleMouseUpRef.current) {
          window.addEventListener('mouseup', handleGlobalMouseUp)
        }
        return
      }
    }

    isDragging.current = true
    hasDragged.current = false
    lastMouse.current = { x: e.clientX, y: e.clientY }
    setCanvasCursor(canvasRef, CURSOR_GRABBING)
  }, [canvasRef, annotationHandlers, getWorldPos, editModeActive, layoutDataRef, getAnimatedPos, hoveredNodeIdRef, handleGlobalMouseUp])

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect) {
      const t = transformRef.current
      mouseWorldPosRef.current = {
        x: (e.clientX - rect.left - t.x) / t.scale,
        y: (e.clientY - rect.top - t.y) / t.scale,
      }
    }

    const ah = annotationHandlers

    if (draggedPersonRef.current) {
      const drag = draggedPersonRef.current
      if (!hasDragged.current && Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) <= 2) return
      hasDragged.current = true
      drag.node.x = mouseWorldPosRef.current.x - drag.offsetX - drag.node.width / 2
      drag.node.y = mouseWorldPosRef.current.y - drag.offsetY - drag.node.height / 2
      drag.node._manualPosition = true
      hoveredNodeIdRef.current = drag.node.id
      lastMouse.current = { x: e.clientX, y: e.clientY }
      setCanvasCursor(canvasRef, CURSOR_GRABBING)
      return
    }

    // Drawing tool: accumulate points
    if (ah && ah.activeTool === 'drawing' && ah.drawingPathRef.current) {
      ah.onCanvasMouseMove(mouseWorldPosRef.current.x, mouseWorldPosRef.current.y)
      return
    }

    // Annotation drag
    if (annotationDragging.current && ah) {
      hasDragged.current = true
      ah.onCanvasMouseMove(mouseWorldPosRef.current.x, mouseWorldPosRef.current.y, e.clientX, e.clientY)
      return
    }

    // Set cursor based on active tool
    if (ah && ah.activeTool && ah.activeTool !== 'pointer') {
      setCanvasCursor(canvasRef, CURSOR_CROSSHAIR)
    }

    if (!isDragging.current && layoutDataRef.current) {
      const now = performance.now()
      let isOverClickable = false
      let newHoveredNode = null
      let newHoveredMedia = null
      const ent = entranceRef.current
      for (const node of layoutDataRef.current.children) {
        if (node._type !== 'person') continue
        if (ent && !ent.finished) {
          const ns = ent.nodeSchedule.get(node.id)
          if (ns && getEntranceProgress(now - ent.startTime, ns.startMs, ns.duration) < 0.5) continue
        }
        const pos = getAnimatedPos(node, now)
        const person = node._data
        const rd = nodeRandomDataRef.current.get(node.id)
        const pMedias = getPersonMedias(person.id)
        const orbitSlots = rd?.orbitSlots || []
        const orbitCount = Math.min(pMedias.length, MAX_ORBIT_MEDIAS)
        for (let i = 0; i < orbitCount; i++) {
          const slot = orbitSlots[i]
          if (!slot) continue
          const mx = pos.cx + Math.cos(slot.angle) * slot.dist
          const my = pos.cy + Math.sin(slot.angle) * slot.dist
          if (Math.sqrt((mx - mouseWorldPosRef.current.x) ** 2 + (my - mouseWorldPosRef.current.y) ** 2) < ORBIT_MEDIA_SIZE + 4) {
            isOverClickable = true
            newHoveredMedia = `${node.id}:${i}`
            break
          }
        }
        if (isOverClickable) break
        if (Math.sqrt((pos.cx - mouseWorldPosRef.current.x) ** 2 + (pos.cy - mouseWorldPosRef.current.y) ** 2) < nodeRadius(node)) {
          isOverClickable = true
          newHoveredNode = node.id
          break
        }
      }
      if (!isOverClickable && hitRenvoi(mouseWorldPosRef.current.x, mouseWorldPosRef.current.y)) isOverClickable = true
      hoveredNodeIdRef.current = newHoveredNode
      hoveredMediaKeyRef.current = newHoveredMedia

      if (!ah || ah.activeTool === 'pointer') {
        const cursor = editModeActive && newHoveredNode
          ? CURSOR_NODE_GRAB
          : isOverClickable ? CURSOR_POINTER : CURSOR_GRAB
        setCanvasCursor(canvasRef, cursor)
      }
    }

    if (!isDragging.current) return
    const dx = e.clientX - lastMouse.current.x
    const dy = e.clientY - lastMouse.current.y
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasDragged.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
    targetTransformRef.current = {
      ...targetTransformRef.current,
      x: targetTransformRef.current.x + dx,
      y: targetTransformRef.current.y + dy,
    }
  }, [canvasRef, transformRef, targetTransformRef, layoutDataRef, nodeRandomDataRef, entranceRef, hoveredNodeIdRef, hoveredMediaKeyRef, mouseWorldPosRef, getAnimatedPos, annotationHandlers, editModeActive])

  const handleMouseUp = useCallback(() => {
    const ah = annotationHandlers

    // Finalize drawing
    if (ah && ah.activeTool === 'drawing' && ah.drawingPathRef.current) {
      const worldPos = mouseWorldPosRef.current
      ah.onCanvasMouseUp(worldPos.x, worldPos.y)
      return
    }

    // Stop annotation drag
    if (annotationDragging.current && ah) {
      const worldPos = mouseWorldPosRef.current
      ah.onCanvasMouseUp(worldPos.x, worldPos.y)
      annotationDragging.current = false
      return
    }

    if (draggedPersonRef.current) {
      const { node } = draggedPersonRef.current
      draggedPersonRef.current = null
      if (typeof window !== 'undefined') {
        window.removeEventListener('mouseup', handleGlobalMouseUp)
      }
      if (hasDragged.current) {
        onPersonPositionChange?.(node._data.id, {
          layoutX: node.x + node.width / 2,
          layoutY: node.y + node.height / 2,
        })
      }
      hoveredNodeIdRef.current = node.id
      setCanvasCursor(canvasRef, editModeActive ? CURSOR_NODE_GRAB : CURSOR_POINTER)
      return
    }

    isDragging.current = false
    const isOverClickable = hoveredNodeIdRef.current || hoveredMediaKeyRef.current
    setCanvasCursor(canvasRef, isOverClickable ? CURSOR_POINTER : CURSOR_GRAB)
  }, [canvasRef, hoveredNodeIdRef, hoveredMediaKeyRef, mouseWorldPosRef, annotationHandlers, onPersonPositionChange, editModeActive, handleGlobalMouseUp])

  useEffect(() => {
    handleMouseUpRef.current = handleMouseUp
  }, [handleMouseUp])

  useEffect(() => () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [handleGlobalMouseUp])

  // Annule le glisser d'une personne sans rien enregistrer : la personne revient à sa place d'avant
  const cancelPersonDrag = useCallback(() => {
    const drag = draggedPersonRef.current
    if (!drag) return
    draggedPersonRef.current = null
    const { node, originX, originY, originManual } = drag
    node.x = originX
    node.y = originY
    node._manualPosition = originManual
    if (typeof window !== 'undefined') {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
    hoveredNodeIdRef.current = node.id
    setCanvasCursor(canvasRef, editModeActive ? CURSOR_NODE_GRAB : CURSOR_POINTER)
  }, [canvasRef, hoveredNodeIdRef, editModeActive, handleGlobalMouseUp])

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false
    annotationDragging.current = false
    setCanvasCursor(canvasRef, draggedPersonRef.current ? CURSOR_GRABBING : CURSOR_GRAB)
    mouseWorldPosRef.current = { x: -9999, y: -9999 }
    hoveredNodeIdRef.current = null
    hoveredMediaKeyRef.current = null
  }, [canvasRef, mouseWorldPosRef, hoveredNodeIdRef, hoveredMediaKeyRef])

  const handleWheel = useCallback((e) => {
    if (e.cancelable) e.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const wheelDelta = Math.max(-120, Math.min(120, e.deltaY))
    const delta = Math.exp(-wheelDelta * 0.0011)
    const base = targetTransformRef.current
    const newScale = Math.max(minScale, Math.min(maxScale, base.scale * delta))
    const ratio = newScale / base.scale
    isZooming.current = true
    if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current)
    zoomTimeoutRef.current = setTimeout(() => { isZooming.current = false }, 220)
    targetTransformRef.current = {
      scale: newScale,
      x: mouseX - ratio * (mouseX - base.x),
      y: mouseY - ratio * (mouseY - base.y),
    }
  }, [canvasRef, targetTransformRef, minScale, maxScale])

  const handleClick = useCallback((e) => {
    if (hasDragged.current) return
    const ah = annotationHandlers
    const layoutData = layoutDataRef.current
    if (!layoutData) return
    const rect = canvasRef.current.getBoundingClientRect()
    const t = transformRef.current
    const clickX = (e.clientX - rect.left - t.x) / t.scale
    const clickY = (e.clientY - rect.top - t.y) / t.scale

    // Annotation tool intercepts click
    if (ah && ah.activeTool && ah.activeTool !== 'pointer') {
      const handled = ah.onCanvasClick(clickX, clickY, transformRef)
      if (handled) return
    }

    // Pointer mode: check annotation hit first
    if (ah && ah.activeTool === 'pointer') {
      const handled = ah.onCanvasClick(clickX, clickY, transformRef)
      if (handled) return
    }

    const now = performance.now()
    const ent = entranceRef.current

    for (const node of layoutData.children) {
      if (node._type !== 'person') continue
      if (ent && !ent.finished) {
        const ns = ent.nodeSchedule.get(node.id)
        if (ns && getEntranceProgress(now - ent.startTime, ns.startMs, ns.duration) < 0.5) continue
      }
      const pos = getAnimatedPos(node, now)
      const person = node._data
      const rd = nodeRandomDataRef.current.get(node.id)
      const personMedias = getPersonMedias(person.id)
      const orbitSlots = rd?.orbitSlots || []
      const orbitCount = Math.min(personMedias.length, MAX_ORBIT_MEDIAS)

      for (let i = 0; i < orbitCount; i++) {
        const slot = orbitSlots[i]
        if (!slot) continue
        const mx = pos.cx + Math.cos(slot.angle) * slot.dist
        const my = pos.cy + Math.sin(slot.angle) * slot.dist
        const dist = Math.sqrt((mx - clickX) ** 2 + (my - clickY) ** 2)
        if (dist < ORBIT_MEDIA_SIZE + 4) {
          onMediaSelect?.(personMedias[i], person)
          return
        }
      }
    }

    for (const node of layoutData.children) {
      if (node._type !== 'person') continue
      if (ent && !ent.finished) {
        const ns = ent.nodeSchedule.get(node.id)
        if (ns && getEntranceProgress(now - ent.startTime, ns.startMs, ns.duration) < 0.5) continue
      }
      const pos = getAnimatedPos(node, now)
      if (Math.sqrt((pos.cx - clickX) ** 2 + (pos.cy - clickY) ** 2) < nodeRadius(node)) {
        onPersonSelect(node._data)
        return
      }
    }

    // Renvoi : on glisse vers l'autre extrémité (parents ou enfant), sans dézoomer en dessous de la lecture des prénoms
    const renvoi = hitRenvoi(clickX, clickY)
    if (renvoi) {
      const rect2 = canvasRef.current.getBoundingClientRect()
      const scale = Math.max(t.scale, 0.8)
      targetTransformRef.current = {
        scale,
        x: rect2.width / 2 - renvoi.targetX * scale,
        y: rect2.height / 2 - renvoi.targetY * scale,
      }
    }
  }, [canvasRef, transformRef, targetTransformRef, layoutDataRef, nodeRandomDataRef, entranceRef, getAnimatedPos, onPersonSelect, onMediaSelect, annotationHandlers])

  return {
    isDragging, isZooming, zoomTimeoutRef, hasDragged,
    handleMouseDown, handleMouseMove, handleMouseUp,
    handleMouseLeave, handleWheel, handleClick, cancelPersonDrag,
  }
}
