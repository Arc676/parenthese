import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSheetDrag } from '../../hooks/useSheetDrag'
import './NavMenu.css'

/**
 * Menu partagé de la barre flottante.
 * Téléphone : feuille qui monte du bas, voile sur l'arbre, poignée qui se glisse vers le bas pour fermer.
 * Ordinateur : popover ancré à la pilule, fermé par le clic dehors et par Échap (géré par la barre).
 */
export function NavMenu({ phone = false, label, onClose, triggerRef, children }) {
  const ref = useRef(null)
  // Le geste part de la poignée seulement (le contenu de la feuille défile et reste intact)
  const drag = useSheetDrag({ enabled: phone, zone: '.navm-handle', onClose, closes: ({ offset }) => offset > 70 })

  useEffect(() => {
    const node = ref.current
    node?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
    return () => {
      // Le focus revient au déclencheur quand le menu se referme
      if (node?.contains(document.activeElement)) triggerRef?.current?.focus({ preventScroll: true })
    }
  }, [triggerRef])

  if (phone) {
    return createPortal(
      <>
        <div className="navm-scrim" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          className="navm-sheet"
          role="dialog"
          aria-label={label}
          style={drag.style}
          data-dragging={drag.dragging || undefined}
          {...drag.bind}
        >
          <div className="navm-handle" aria-hidden="true">
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
