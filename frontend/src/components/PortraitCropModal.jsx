import { useEffect, useRef, useState } from 'react'
import { Crosshair, X } from 'lucide-react'
import { createPortal } from 'react-dom'

import { t } from '../i18n/index.js'
import PzBusy from './PzBusy.jsx'
import {
  DEFAULT_CROP,
  clampCrop,
  cropForSave,
  cropShape,
  cropViewport,
  frameAspect,
  imagePlacement,
  normalizeCrop,
  resolveFrameKind,
  shapeOfKind,
} from '../utils/portraitCrop.js'
import './PortraitCropModal.css'

// Taille du masque par rapport à la zone de recadrage (carrée)
const WINDOW_SIZE = 0.8
// Déplacement clavier : part de la zone visible (4 %, 16 % avec Maj)
const KEY_STEP = 0.04
const KEY_STEP_LARGE = 0.16
const KEY_ZOOM_STEP = 0.2

const SHAPE_LABELS = { round: t('Rond'), square: t('Carré'), polaroid: t('Polaroïd'), portrait: t('Vertical'), landscape: t('Horizontal') }

// Recadrage d'un portrait. Le masque garde la forme du cadre de la personne dans l'arbre ; la photo
// glisse dessous. La forme se choisit aussi ici : sans choix, elle suit la photo ou le tirage de la personne.
// `mode` : 'recrop' (depuis le menu) ou 'new' (juste après le choix d'une photo).
const PortraitCropModal = ({ src, frameType, name, mode = 'recrop', initialCrop = null, saving = false, error = '', onSave, onClose }) => {
  const stageRef = useRef(null)
  const dragRef = useRef(null)
  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null)
  const [size, setSize] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [crop, setCrop] = useState(() => normalizeCrop(initialCrop))
  const [shape, setShape] = useState(() => cropShape(initialCrop))
  const [dragging, setDragging] = useState(false)

  const imageRatio = size ? size.w / size.h : 1
  const frameKind = resolveFrameKind(frameType, imageRatio, shape)
  const aspect = frameAspect(frameKind, imageRatio, shape)
  const shownShape = shape ?? shapeOfKind(frameKind, imageRatio)
  const winW = aspect >= 1 ? WINDOW_SIZE : WINDOW_SIZE * aspect
  const winH = aspect >= 1 ? WINDOW_SIZE / aspect : WINDOW_SIZE

  // Toute valeur passe par clampCrop : l'affichage et l'enregistrement restent identiques
  const apply = (next) => {
    if (!size) return
    setCrop(clampCrop(size.w, size.h, aspect, next))
  }

  const current = size ? clampCrop(size.w, size.h, aspect, crop) : crop
  const placement = size ? imagePlacement(size.w, size.h, aspect, current, winW, winH) : null

  // Molette : zoom autour du centre. Listener natif, pour pouvoir annuler le défilement de la page.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      setCrop((prev) => {
        const c = size ? clampCrop(size.w, size.h, aspect, prev) : normalizeCrop(prev)
        const zoom = Math.min(4, Math.max(1, c.zoom * Math.exp(-event.deltaY * 0.002)))
        return size ? clampCrop(size.w, size.h, aspect, { ...c, zoom }) : { ...c, zoom }
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [size, aspect])

  // Escape ferme la fenêtre, sauf pendant l'enregistrement
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saving, onClose])

  const startDrag = (pointer) => {
    dragRef.current = { x: pointer.x, y: pointer.y, crop: current }
    setDragging(true)
  }

  const onPointerDown = (event) => {
    if (!size || saving) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 1) {
      startDrag({ x: event.clientX, y: event.clientY })
    } else if (pointersRef.current.size === 2) {
      // Deux doigts : pincement, le glissement s'arrête
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: current.zoom }
      dragRef.current = null
    }
  }

  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId) || !size) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      const zoom = pinchRef.current.zoom * (distance / (pinchRef.current.distance || distance))
      apply({ ...current, zoom: Math.min(4, Math.max(1, zoom)) })
      return
    }
    const drag = dragRef.current
    const rect = stageRef.current?.getBoundingClientRect()
    if (!drag || !rect || !rect.width) return
    // Le glissement déplace la photo : le centre visible va dans le sens inverse
    const viewport = cropViewport(size.w, size.h, aspect, drag.crop)
    const dxStage = (event.clientX - drag.x) / rect.width
    const dyStage = (event.clientY - drag.y) / rect.height
    const cx = drag.crop.x * size.w - (dxStage * viewport.sw) / winW
    const cy = drag.crop.y * size.h - (dyStage * viewport.sh) / winH
    apply({ x: cx / size.w, y: cy / size.h, zoom: drag.crop.zoom })
  }

  const onPointerUp = (event) => {
    pointersRef.current.delete(event.pointerId)
    pinchRef.current = null
    if (pointersRef.current.size === 1) {
      const [remaining] = pointersRef.current.values()
      startDrag(remaining)
    } else {
      dragRef.current = null
      setDragging(false)
    }
  }

  const onKeyDown = (event) => {
    if (!size) return
    const viewport = cropViewport(size.w, size.h, aspect, current)
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const moves = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    if (moves[event.key]) {
      event.preventDefault()
      const [dx, dy] = moves[event.key]
      apply({
        x: (current.x * size.w + dx * step * viewport.sw) / size.w,
        y: (current.y * size.h + dy * step * viewport.sh) / size.h,
        zoom: current.zoom,
      })
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      apply({ ...current, zoom: current.zoom + KEY_ZOOM_STEP })
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      apply({ ...current, zoom: current.zoom - KEY_ZOOM_STEP })
    }
  }

  const recenter = () => apply(DEFAULT_CROP)
  const setZoom = (zoom) => apply({ ...current, zoom: Number(zoom) })
  const save = () => {
    if (!size || saving) return
    onSave?.(cropForSave(size.w, size.h, aspect, current, shape))
  }

  const isNew = mode === 'new'

  return createPortal(
    <div className="pz-overlay pcrop-overlay" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose?.() }}>
      <div className="pz-modal pcrop-modal" role="dialog" aria-modal="true" aria-labelledby="pcropTitle">
        <div className="pz-modal-head">
          <h1 id="pcropTitle" className="pz-title">{t('Recadrer la photo')}</h1>
          {name && <p className="pz-sub">{name}</p>}
        </div>
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pz-modal-close" onClick={onClose} disabled={saving} aria-label={t('Fermer')}>
          <X size={18} aria-hidden="true" />
        </button>

        <div className="pcrop-body">
          <div
            ref={stageRef}
            className={`pcrop-stage ${dragging ? 'is-dragging' : ''}`}
            tabIndex={0}
            role="group"
            aria-label={t('Zone de recadrage')}
            aria-describedby="pcropHint"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            {src && (
              <img
                className="pcrop-img"
                src={src}
                alt=""
                draggable={false}
                onLoad={(event) => setSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
                onError={() => setLoadFailed(true)}
                style={placement ? { left: `${placement.left}%`, top: `${placement.top}%`, width: `${placement.width}%`, height: `${placement.height}%` } : { visibility: 'hidden' }}
              />
            )}
            <div
              className={`pcrop-window pcrop-window--${frameKind}`}
              style={{ width: `${winW * 100}%`, height: `${winH * 100}%` }}
              aria-hidden="true"
            />
            {!size && !loadFailed && <div className="pcrop-loading"><PzBusy busy busyLabel={t('Chargement de la photo')} /></div>}
          </div>

          <div className="pz-tabs pcrop-shapes" role="radiogroup" aria-label={t('Forme du cadre')}>
            {Object.entries(SHAPE_LABELS).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={shownShape === value}
                className={`pz-tab ${shownShape === value ? 'is-active' : ''}`}
                onClick={() => setShape(value)}
                disabled={!size || saving}
                aria-label={label}
                title={label}
              >
                <span className={`pcrop-ico pcrop-ico--${value}`} aria-hidden="true" />
              </button>
            ))}
          </div>

          <p id="pcropHint" className="pz-small pcrop-hint">
            {t('Glissez la photo, ou utilisez les flèches. Molette, pincement ou curseur pour zoomer.')}
          </p>

          <label className="pcrop-zoom">
            <span className="pz-small">{t('Zoom')}</span>
            <input
              type="range"
              min="1"
              max="4"
              step="0.01"
              value={current.zoom}
              onChange={(event) => setZoom(event.target.value)}
              disabled={!size || saving}
            />
          </label>

          {loadFailed && <p className="pz-error">{t('Impossible d’afficher cette photo.')}</p>}
          {error && <p className="pz-error">{error}</p>}
        </div>

        <div className="pz-modal-actions pz-modal-actions--split">
          <button type="button" className="pz-btn pz-btn--ghost" onClick={recenter} disabled={!size || saving}>
            <Crosshair size={16} aria-hidden="true" />
            {t('Recentrer')}
          </button>
          <div className="pcrop-actions">
            <button type="button" className="pz-btn pz-btn--ghost" onClick={onClose} disabled={saving}>
              {isNew ? t('Garder tel quel') : t('Annuler')}
            </button>
            <button type="button" className="pz-btn pz-btn--primary" onClick={save} disabled={!size || saving || loadFailed}>
              <PzBusy busy={saving} busyLabel={t('Enregistrement en cours')}>{t('Enregistrer')}</PzBusy>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default PortraitCropModal
