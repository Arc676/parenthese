import { useEffect, useRef, useState } from 'react'
import {
  PHONE_QUERY,
  SHEET_WIDTH_QUERY,
  canStartSheetDrag,
  shouldCloseSheet,
  sheetDragIntent,
  sheetOffset,
  velocityBetween,
} from '../utils/sheetDrag'

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * Vrai en mode feuille : téléphone ou pointeur grossier, et largeur où la fiche se pose en bas (même règle que la barre).
 */
export function useSheetMode() {
  const [sheet, setSheet] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches && window.matchMedia(SHEET_WIDTH_QUERY).matches
  ))
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const phone = window.matchMedia(PHONE_QUERY)
    const width = window.matchMedia(SHEET_WIDTH_QUERY)
    const update = () => setSheet(phone.matches && width.matches)
    phone.addEventListener('change', update)
    width.addEventListener('change', update)
    return () => {
      phone.removeEventListener('change', update)
      width.removeEventListener('change', update)
    }
  }, [])
  return sheet
}

/**
 * Glisser pour fermer une feuille du bas.
 * - Le geste ne part que des éléments de `zone` (sélecteur CSS) et jamais d'un champ de saisie ni d'une sélection de texte.
 * - La feuille suit le doigt (transform inline) ; au-dessus de sa position de repos elle résiste (`sheetOffset`) et revient au lâcher.
 * - Au lâcher : `closes` décide (par défaut, un tiers de la hauteur ou un lâcher rapide). Fermer attend la fin de la sortie,
 *   puis appelle `onClose`. Si `onClose` renvoie `false` (enregistrement refusé), la feuille revient.
 * - Après un vrai glisser, le clic qui suit est avalé (pas de bouton déclenché au lâcher).
 * - `canStart` (facultatif) peut refuser le geste au moment de l'appui (feuille qui a défilé, par exemple).
 *
 * Usage : `<div {...drag.bind} style={drag.style} data-dragging={drag.dragging || undefined}>`
 */
export function useSheetDrag({
  enabled = true,
  zone,
  onClose,
  closes = shouldCloseSheet,
  closeDelayMs = 180,
  canStart = null,
}) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef(null)
  const suppressClick = useRef(false)
  const closingRef = useRef(false)

  const settle = () => {
    setDragging(false)
    setOffset(0)
  }

  const close = async (height) => {
    closingRef.current = true
    setDragging(false)
    setOffset(height)
    await wait(closeDelayMs)
    const kept = await onClose?.()
    closingRef.current = false
    // Enregistrement refusé : la fiche reste, revient à sa place et l'erreur reste affichée par la fiche
    if (kept === false) settle()
  }

  const onPointerDown = (event) => {
    suppressClick.current = false
    if (!enabled || closingRef.current || event.button > 0) return
    const selection = typeof window !== 'undefined' ? window.getSelection?.()?.toString() ?? '' : ''
    if (!canStartSheetDrag(event.target, zone, selection)) return
    if (canStart && !canStart(event)) return
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      height: event.currentTarget.offsetHeight,
      active: false,
      prev: null,
      last: { y: event.clientY, t: event.timeStamp },
    }
  }

  const onPointerMove = (event) => {
    const g = gesture.current
    if (!g || event.pointerId !== g.id) return
    const dx = event.clientX - g.x
    const dy = event.clientY - g.y
    if (!g.active) {
      const intent = sheetDragIntent(dx, dy)
      if (intent === 'pending') return
      const selecting = typeof window !== 'undefined' && window.getSelection?.()?.toString()
      if (intent === 'other' || selecting) {
        gesture.current = null
        return
      }
      g.active = true
      suppressClick.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setDragging(true)
    }
    g.prev = g.last
    g.last = { y: event.clientY, t: event.timeStamp }
    setOffset(sheetOffset(dy))
  }

  const onPointerUp = (event) => {
    const g = gesture.current
    if (!g || event.pointerId !== g.id) return
    gesture.current = null
    if (!g.active) return
    const end = { y: event.clientY, t: event.timeStamp }
    const offsetNow = Math.max(0, event.clientY - g.y)
    const velocity = velocityBetween(g.prev ?? g.last, end)
    if (closes({ offset: offsetNow, height: g.height, velocity })) {
      close(g.height)
    } else {
      settle()
    }
  }

  const onPointerCancel = () => {
    const g = gesture.current
    gesture.current = null
    if (g?.active) settle()
  }

  // Après un vrai glisser, le clic du lâcher ne doit pas atteindre les boutons de la feuille
  const onClickCapture = (event) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.stopPropagation()
    event.preventDefault()
  }

  return {
    dragging,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
    style: offset !== 0 ? { transform: `translateY(${offset}px)` } : undefined,
  }
}
