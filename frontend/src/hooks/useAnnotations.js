import { useState, useCallback, useRef, useEffect } from 'react'
import {
  annotations as annotationData,
  addAnnotation as addAnnotationToStore,
  updateAnnotation as updateAnnotationInStore,
  removeAnnotation as removeAnnotationFromStore,
} from '../data/mockData'
import { withAnchor } from '../components/annotations/anchor'

/**
 * Hook pour gerer les annotations canvas (dessin, stickers, texte).
 *
 * @param {Object} options
 * @param {boolean} options.editModeActive
 * @param {Function} options.updateDraft - merge data into edit draft
 * @param {Object} options.viewRef - rempli par la galaxie : centres des portraits et annotations affichées
 * @returns {Object} API annotations
 */
export function useAnnotations({ editModeActive, updateDraft, viewRef = null }) {
  const [activeTool, setActiveTool] = useState('pointer')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null)
  const [selectedSticker, setSelectedSticker] = useState(null)
  const [textInputState, setTextInputState] = useState(null) // { x, y, screenX, screenY, editingId?, text?, style? }
  const [revision, setRevision] = useState(0)

  const [currentStyle, setCurrentStyle] = useState({
    color: '#93402A',
    brushWidth: 3,
    fontSize: 18,
    stabilo: false,
  })

  // Drawing in-progress path (mutable ref for perf)
  const drawingPathRef = useRef(null)
  const currentDrawingAnnId = useRef(null)
  const isDraggingAnnotation = useRef(false)
  const draggingIdRef = useRef(null)
  const isOverTrashRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isOverTrash, setIsOverTrash] = useState(false)
  const dragStartPos = useRef(null)
  const dragAnnotationOrigPos = useRef(null)
  // Vrai si l'annotation touchée était déjà sélectionnée avant l'appui : un texte se rouvre alors pour être modifié
  const pressedSelectedRef = useRef(false)

  // Style rattaché à la personne la plus proche dans l'onglet affiché (voir annotations/anchor.js)
  const anchoredStyle = useCallback((style, x, y) => withAnchor(style, x, y, viewRef?.current?.centers), [viewRef])
  // Annotation telle que dessinée dans l'onglet affiché (position comprise)
  const shownOf = useCallback((id) => (viewRef?.current?.shown || annotationData).find((a) => a.id === id) || null, [viewRef])

  // Texte rouvert : la galaxie ne le dessine pas sous sa saisie
  useEffect(() => {
    if (viewRef?.current) viewRef.current.editingId = textInputState?.editingId ?? null
    else if (viewRef) viewRef.current = { editingId: textInputState?.editingId ?? null }
  }, [viewRef, textInputState])

  // Track added/modified/deleted for draft
  const addedIdsRef = useRef(new Set())
  const modifiedIdsRef = useRef(new Set())
  const deletedIdsRef = useRef(new Set())

  // Reset tool when edit mode deactivated
  useEffect(() => {
    if (!editModeActive) {
      setActiveTool('pointer')
      setSelectedAnnotationId(null)
      setSelectedSticker(null)
      setTextInputState(null)
      drawingPathRef.current = null
      currentDrawingAnnId.current = null
    }
  }, [editModeActive])

  // Clear sticker selection when switching away from sticker tool
  useEffect(() => {
    if (activeTool !== 'sticker') {
      setSelectedSticker(null)
    }
    if (activeTool !== 'drawing') {
      currentDrawingAnnId.current = null
    }
  }, [activeTool])

  // Sync draft with changes
  const syncDraft = useCallback(() => {
    if (!updateDraft) return
    updateDraft({
      addedAnnotations: [...addedIdsRef.current],
      modifiedAnnotations: [...modifiedIdsRef.current],
      deletedAnnotations: [...deletedIdsRef.current],
      annotationsData: annotationData.filter(
        (a) => addedIdsRef.current.has(a.id) || modifiedIdsRef.current.has(a.id)
      ),
    })
  }, [updateDraft])

  // Add annotation
  const addAnnotation = useCallback((ann) => {
    const created = addAnnotationToStore(ann)
    addedIdsRef.current.add(created.id)
    syncDraft()
    setRevision((r) => r + 1)
    return created
  }, [syncDraft])

  // Update annotation
  const updateAnnotation = useCallback((id, changes) => {
    const updated = updateAnnotationInStore(id, changes)
    if (updated && !addedIdsRef.current.has(id)) {
      modifiedIdsRef.current.add(id)
    }
    syncDraft()
    setRevision((r) => r + 1)
    return updated
  }, [syncDraft])

  // Delete annotation
  const deleteAnnotation = useCallback((id) => {
    removeAnnotationFromStore(id)
    if (addedIdsRef.current.has(id)) {
      addedIdsRef.current.delete(id)
    } else {
      deletedIdsRef.current.add(id)
    }
    modifiedIdsRef.current.delete(id)
    if (selectedAnnotationId === id) setSelectedAnnotationId(null)
    syncDraft()
    setRevision((r) => r + 1)
  }, [selectedAnnotationId, syncDraft])

  // Delete selected
  const deleteSelectedAnnotation = useCallback(() => {
    if (selectedAnnotationId) {
      deleteAnnotation(selectedAnnotationId)
    }
  }, [selectedAnnotationId, deleteAnnotation])

  // Select annotation
  const selectAnnotation = useCallback((id) => {
    setSelectedAnnotationId(id)
  }, [])

  // Place a photo annotation at world coordinates
  const placePhoto = useCallback((worldX, worldY, photoPath, url, naturalW, naturalH) => {
    const size = Math.min(200, Math.max(80, naturalW / 2))
    addAnnotation({
      type: 'photo',
      x: worldX,
      y: worldY,
      content: JSON.stringify({ photoPath, url, w: naturalW, h: naturalH }),
      style: anchoredStyle({ size }, worldX, worldY),
      zIndex: 5,
    })
  }, [addAnnotation, anchoredStyle])

  // ---- Hit detection ----
  // Seules les annotations dessinées dans l'onglet affiché se touchent, à leur position dessinée
  const hitTest = useCallback((worldX, worldY) => {
    // Iterate in reverse z-order (top first)
    const sorted = [...(viewRef?.current?.shown || annotationData)].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))
    for (const ann of sorted) {
      if (ann.type === 'text') {
        const fontSize = ann.style?.fontSize || 18
        const w = ann.content.length * fontSize * 0.6 + 16
        const h = fontSize + 12
        if (Math.abs(worldX - ann.x) < w / 2 && Math.abs(worldY - ann.y) < h / 2) {
          return ann
        }
      } else if (ann.type === 'photo') {
        const size = ann.style?.size || 150
        let aspect = 1
        try {
          const parsed = typeof ann.content === 'string' ? JSON.parse(ann.content) : ann.content
          if (parsed.w && parsed.h) aspect = parsed.w / parsed.h
        } catch { /* ignore */ }
        const drawW = aspect >= 1 ? size : size * aspect
        const drawH = aspect >= 1 ? size / aspect : size
        if (Math.abs(worldX - ann.x) < drawW / 2 && Math.abs(worldY - ann.y) < drawH / 2) {
          return ann
        }
      } else if (ann.type === 'sticker') {
        const size = ann.style?.fontSize || 40
        const r = size / 2 + 6
        if (Math.abs(worldX - ann.x) < r && Math.abs(worldY - ann.y) < r) {
          return ann
        }
      } else if (ann.type === 'drawing') {
        // Check proximity to any path point
        try {
          const parsed = typeof ann.content === 'string' ? JSON.parse(ann.content) : ann.content
          const paths = parsed.paths || []
          const threshold = (ann.style?.brushWidth || 3) + 8
          for (const path of paths) {
            for (const pt of (path.points || [])) {
              const dx = worldX - (ann.x + pt.x)
              const dy = worldY - (ann.y + pt.y)
              if (dx * dx + dy * dy < threshold * threshold) {
                return ann
              }
            }
          }
        } catch { /* ignore */ }
      }
    }
    return null
  }, [viewRef])

  // ---- Canvas event handlers (called from useGalaxyInteractions) ----

  const onCanvasMouseDown = useCallback((worldX, worldY) => {
    if (activeTool === 'drawing') {
      drawingPathRef.current = {
        points: [{ x: worldX, y: worldY }],
        color: currentStyle.color,
        width: currentStyle.brushWidth,
      }
    }
  }, [activeTool, currentStyle])

  const onCanvasMouseMove = useCallback((worldX, worldY, screenX, screenY) => {
    if (activeTool === 'drawing' && drawingPathRef.current) {
      drawingPathRef.current.points.push({ x: worldX, y: worldY })
    }

    // Drag annotation (use ref for immediate access)
    if (isDraggingAnnotation.current && draggingIdRef.current && dragAnnotationOrigPos.current) {
      const dx = worldX - dragStartPos.current.x
      const dy = worldY - dragStartPos.current.y
      const ann = annotationData.find((a) => a.id === draggingIdRef.current)
      if (ann) {
        // Déplacer recalcule l'ancre : la personne la plus proche du nouvel endroit
        const x = (dragAnnotationOrigPos.current.x ?? 0) + dx
        const y = (dragAnnotationOrigPos.current.y ?? 0) + dy
        updateAnnotation(draggingIdRef.current, { x, y, style: anchoredStyle(ann.style, x, y) })
      }
      // Check if over trash button in toolbar
      let overTrash = false
      if (screenX !== undefined && screenY !== undefined) {
        const trashBtn = document.querySelector('[data-annotation-trash]')
        if (trashBtn) {
          const rect = trashBtn.getBoundingClientRect()
          const margin = 18
          overTrash =
            screenX >= rect.left - margin &&
            screenX <= rect.right + margin &&
            screenY >= rect.top - margin &&
            screenY <= rect.bottom + margin
        }
      }
      isOverTrashRef.current = overTrash
      setIsOverTrash(overTrash)
    }
  }, [activeTool, updateAnnotation, anchoredStyle])

  const onCanvasMouseUp = useCallback((_worldX, _worldY) => {
    // Finalize drawing
    if (activeTool === 'drawing' && drawingPathRef.current && drawingPathRef.current.points.length >= 2) {
      // Store path relative to first point (annotation position = first point)
      const firstPt = drawingPathRef.current.points[0]
      const relativePts = drawingPathRef.current.points.map((pt) => ({
        x: pt.x - firstPt.x,
        y: pt.y - firstPt.y,
      }))

      // If a drawing annotation is already active, append this stroke to it
      if (currentDrawingAnnId.current) {
        const existing = shownOf(currentDrawingAnnId.current)
        if (existing) {
          const anchorX = existing.x
          const anchorY = existing.y
          const relToAnchor = drawingPathRef.current.points.map((pt) => ({
            x: pt.x - anchorX,
            y: pt.y - anchorY,
          }))
          let parsed
          try {
            parsed = typeof existing.content === 'string' ? JSON.parse(existing.content) : (existing.content || {})
          } catch { parsed = {} }
          const paths = Array.isArray(parsed.paths) ? parsed.paths : []
          paths.push({
            points: relToAnchor,
            color: drawingPathRef.current.color,
            width: drawingPathRef.current.width,
          })
          updateAnnotation(existing.id, {
            content: JSON.stringify({ paths }),
          })
        } else {
          currentDrawingAnnId.current = null
        }
      }

      // Otherwise create a new drawing annotation
      if (!currentDrawingAnnId.current) {
        const created = addAnnotation({
          type: 'drawing',
          x: firstPt.x,
          y: firstPt.y,
          content: JSON.stringify({
            paths: [{
              points: relativePts,
              color: drawingPathRef.current.color,
              width: drawingPathRef.current.width,
            }],
          }),
          style: anchoredStyle({
            color: drawingPathRef.current.color,
            brushWidth: drawingPathRef.current.width,
          }, firstPt.x, firstPt.y),
          zIndex: 0,
        })
        currentDrawingAnnId.current = created.id
      }

      drawingPathRef.current = null
    }

    // Stop dragging annotation — delete if over trash
    if (isDraggingAnnotation.current) {
      if (isOverTrashRef.current && draggingIdRef.current) {
        deleteAnnotation(draggingIdRef.current)
      }
      isDraggingAnnotation.current = false
      draggingIdRef.current = null
      isOverTrashRef.current = false
      setIsDragging(false)
      setIsOverTrash(false)
      dragStartPos.current = null
      dragAnnotationOrigPos.current = null
    }
  }, [activeTool, addAnnotation, deleteAnnotation, anchoredStyle, shownOf])

  const onCanvasClick = useCallback((worldX, worldY, transformRef) => {
    if (activeTool === 'text') {
      // Open text input at this position
      if (transformRef) {
        const t = transformRef.current
        setTextInputState({
          x: worldX,
          y: worldY,
          screenX: worldX * t.scale + t.x,
          screenY: worldY * t.scale + t.y,
        })
      }
      return true
    }

    if (activeTool === 'sticker' && selectedSticker) {
      addAnnotation({
        type: 'sticker',
        x: worldX,
        y: worldY,
        content: selectedSticker,
        style: anchoredStyle({
          fontSize: 40,
          rotation: (Math.random() - 0.5) * 0.25,
        }, worldX, worldY),
        zIndex: 10,
      })
      return true
    }

    if (activeTool === 'pointer') {
      const hit = hitTest(worldX, worldY)
      if (hit) {
        // Un texte déjà sélectionné se rouvre au clic pour être modifié (double clic sur ordinateur)
        if (hit.type === 'text' && pressedSelectedRef.current && transformRef) {
          pressedSelectedRef.current = false
          const t = transformRef.current
          setTextInputState({
            x: hit.x,
            y: hit.y,
            screenX: hit.x * t.scale + t.x,
            screenY: hit.y * t.scale + t.y,
            editingId: hit.id,
            text: hit.content,
            style: hit.style,
          })
          return true
        }
        setSelectedAnnotationId(hit.id)
        // Prepare for potential drag
        isDraggingAnnotation.current = false
        dragStartPos.current = { x: worldX, y: worldY }
        dragAnnotationOrigPos.current = { x: hit.x, y: hit.y }
        return true
      }
      setSelectedAnnotationId(null)
    }

    return false
  }, [activeTool, selectedSticker, addAnnotation, hitTest, anchoredStyle])

  // Start drag — accepts annotationId so we can drag without prior selection
  const onAnnotationDragStart = useCallback((worldX, worldY, annotationId) => {
    const targetId = annotationId || selectedAnnotationId
    if (activeTool === 'pointer' && targetId) {
      const ann = shownOf(targetId)
      if (ann) {
        pressedSelectedRef.current = targetId === selectedAnnotationId
        setSelectedAnnotationId(targetId)
        draggingIdRef.current = targetId
        isDraggingAnnotation.current = true
        isOverTrashRef.current = false
        setIsDragging(true)
        setIsOverTrash(false)
        dragStartPos.current = { x: worldX, y: worldY }
        dragAnnotationOrigPos.current = { x: ann.x, y: ann.y }
        return true
      }
    }
    return false
  }, [activeTool, selectedAnnotationId, shownOf])

  // Commit text from overlay input
  const commitTextInput = useCallback((text) => {
    if (!textInputState || !text.trim()) {
      setTextInputState(null)
      return
    }

    // Texte rouvert : seul son contenu change, il garde sa place et son style
    if (textInputState.editingId) {
      if (text.trim() !== textInputState.text) updateAnnotation(textInputState.editingId, { content: text.trim() })
      setTextInputState(null)
      return
    }

    addAnnotation({
      type: 'text',
      x: textInputState.x,
      y: textInputState.y,
      content: text.trim(),
      style: anchoredStyle({
        color: currentStyle.color,
        fontSize: currentStyle.fontSize,
        stabilo: currentStyle.stabilo,
      }, textInputState.x, textInputState.y),
      zIndex: 0,
    })

    setTextInputState(null)
  }, [textInputState, currentStyle, addAnnotation, updateAnnotation, anchoredStyle])

  const cancelTextInput = useCallback(() => {
    setTextInputState(null)
  }, [])

  // The currently selected annotation object (for resize slider, etc.)
  const selectedAnnotation = selectedAnnotationId
    ? (annotationData.find((a) => a.id === selectedAnnotationId) || null)
    : null

  // Resize the selected annotation (sticker/text → fontSize, photo → size)
  const resizeSelected = useCallback((newSize) => {
    if (!selectedAnnotationId) return
    const ann = annotationData.find((a) => a.id === selectedAnnotationId)
    if (!ann) return
    const key = ann.type === 'photo' ? 'size' : 'fontSize'
    updateAnnotation(selectedAnnotationId, { style: { ...ann.style, [key]: newSize } })
  }, [selectedAnnotationId, updateAnnotation])

  return {
    // State
    activeTool,
    setActiveTool,
    selectedAnnotationId,
    selectedAnnotation,
    selectAnnotation,
    selectedSticker,
    setSelectedSticker,
    currentStyle,
    setCurrentStyle,
    textInputState,
    drawingPathRef,
    revision,
    isDragging,
    isOverTrash,

    // Actions
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    deleteSelectedAnnotation,
    commitTextInput,
    cancelTextInput,
    resizeSelected,
    placePhoto,

    // Canvas event handlers
    hitTest,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    onCanvasClick,
    onAnnotationDragStart,
  }
}
