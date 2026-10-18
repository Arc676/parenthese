import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './NavMenu.css'

/**
 * Menu partagé de la barre flottante.
 * Téléphone : feuille qui monte du bas, voile sur l'arbre, poignée qui se glisse vers le bas pour fermer.
 * Ordinateur : popover ancré à la pilule, fermé par le clic dehors et par Échap (géré par la barre).
 */
export function NavMenu({ phone = false, label, onClose, triggerRef, children }) {
  const ref = useRef(null)
  const dragStart = useRef(null)
  const [dragY, setDragY] = useState(0)

  useEffect(() => {
    const node = ref.current
    node?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
    return () => {
      // Le focus revient au déclencheur quand le menu se referme
      if (node?.contains(document.activeElement)) triggerRef?.current?.focus({ preventScroll: true })
    }
  }, [triggerRef])

  const onHandleDown = (event) => {
    dragStart.current = event.clientY
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onHandleMove = (event) => {
    if (dragStart.current === null) return
    setDragY(Math.max(0, event.clientY - dragStart.current))
  }
  const onHandleUp = (event) => {
    if (dragStart.current === null) return
    const distance = event.clientY - dragStart.current
    dragStart.current = null
    if (distance > 70) onClose()
    else setDragY(0)
  }

  if (phone) {
    return createPortal(
      <>
        <div className="navm-scrim" onClick={onClose} aria-hidden="true" />
        <div ref={ref} className="navm-sheet" role="dialog" aria-label={label} style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}>
          <div
            className="navm-handle"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={() => { dragStart.current = null; setDragY(0) }}
            aria-hidden="true"
          >
            <span />
          </div>
          {children}
        </div>
      </>,
      document.body,
    )
  }

  return (
    <div ref={ref} className="navm-pop" role="dialog" aria-label={label}>
      {children}
    </div>
  )
}

export function NavMenuGroup({ label, children }) {
  return (
    <div role="group" aria-label={label}>
      <p className="navm-group" aria-hidden="true">{label}</p>
      {children}
    </div>
  )
}

export function NavMenuItem({ icon, label, sub = null, onSelect, danger = false, disabled = false, right = null, className = '' }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`navm-item${danger ? ' navm-item--danger' : ''}${className ? ` ${className}` : ''}`}
      onClick={onSelect}
      disabled={disabled}
    >
      {icon && <span className="navm-ic" aria-hidden="true">{icon}</span>}
      <span className="navm-text">
        {label}
        {sub && <small>{sub}</small>}
      </span>
      {right}
    </button>
  )
}

export function NavMenuSep() {
  return <div className="navm-sep" role="separator" />
}
