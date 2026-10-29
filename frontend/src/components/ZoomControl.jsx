import { useRef, useCallback, useEffect, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { t } from '../i18n/index.js'
import './ZoomControl.css'

const TRACK_HEIGHT = 120
const THUMB_SIZE = 14
// Paliers de zoom au clic (step 0 = fit via resetZoom)
const ZOOM_STEPS = [1.0, 1.8, 2.8]

export default function ZoomControl({ zoomApiRef }) {
  const [scale, setScale] = useState(0.25)
  // Bornes de zoom de Galaxy, relevées dans la boucle rAF : lire zoomApiRef.current pendant le rendu
  // est signalé par react-hooks/refs
  const [bounds, setBounds] = useState({ min: 0.25, max: 3.2 })
  const [isHovered, setIsHovered] = useState(false)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  )

  const sliderTrackRef = useRef(null)
  const hideTimerRef = useRef(null)
  const isSliderDraggingRef = useRef(false)

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)')
    const handler = (e) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // Poll scale depuis la boucle RAF de Galaxy
  useEffect(() => {
    let rafId
    const tick = () => {
      const api = zoomApiRef?.current
      const s = api?.getScale?.()
      if (s !== undefined) {
        setScale(prev => Math.abs(prev - s) > 0.004 ? s : prev)
      }
      const min = api?.MIN_SCALE ?? 0.25
      const max = api?.MAX_SCALE ?? 3.2
      setBounds(prev => (prev.min === min && prev.max === max ? prev : { min, max }))
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [zoomApiRef])

  // Valeurs dérivées
  const MIN_SCALE = bounds.min
  const MAX_SCALE = bounds.max
  const sliderRatio = Math.max(0, Math.min(1, (scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)))
  const thumbCenter = (THUMB_SIZE / 2) + sliderRatio * (TRACK_HEIGHT - THUMB_SIZE)

  // Hover (desktop)
  const showSlider = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    setIsHovered(true)
  }, [])

  const hideSlider = useCallback(() => {
    hideTimerRef.current = setTimeout(() => {
      if (!isSliderDraggingRef.current) setIsHovered(false)
    }, 250)
  }, [])

  // Click = cycle paliers : step1 → step2 → step3 → fit → step1…
  const stepZoom = useCallback(() => {
    const api = zoomApiRef?.current
    if (!api) return
    const currentScale = api.getScale()
    const next = ZOOM_STEPS.find(s => s > currentScale + 0.05)
    if (next) {
      api.zoomTo(next)
    } else {
      api.resetZoom()
    }
  }, [zoomApiRef])

  // Slider pointer drag (fonctionne desktop et mobile via pointer events)
  const handleSliderPointerDown = useCallback((e) => {
    e.preventDefault()
    isSliderDraggingRef.current = true

    const applyPos = (ev) => {
      const rect = sliderTrackRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = 1 - (ev.clientY - rect.top) / rect.height
      const clamped = Math.max(0, Math.min(1, ratio))
      const api = zoomApiRef?.current
      if (!api) return
      api.zoomTo(api.MIN_SCALE + clamped * (api.MAX_SCALE - api.MIN_SCALE))
    }
    applyPos(e)

    const onMove = (ev) => applyPos(ev)
    const onUp = () => {
      isSliderDraggingRef.current = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [zoomApiRef])

  // Sur téléphone, on zoome à deux doigts : la réglette n'apparaît jamais, la loupe seule reste
  const panelVisible = isHovered && !isMobile

  return (
    <div
      className="zoom-control"
      onMouseEnter={showSlider}
      onMouseLeave={hideSlider}
    >
      {/* Panel slider — au survol sur ordinateur, jamais sur téléphone */}
      <div
        className={`zoom-slider-panel ${panelVisible ? 'visible' : ''}`}
        onMouseEnter={showSlider}
        onMouseLeave={hideSlider}
      >
        <ZoomIn size={13} strokeWidth={1.5} className="zoom-panel-icon" />

        <div
          ref={sliderTrackRef}
          className="zoom-slider-track"
          onPointerDown={handleSliderPointerDown}
        >
          <div className="zoom-slider-fill" style={{ height: thumbCenter }} />
          <div
            className="zoom-slider-thumb"
            style={{ bottom: thumbCenter - THUMB_SIZE / 2 }}
          />
        </div>

        <ZoomOut size={13} strokeWidth={1.5} className="zoom-panel-icon" />
      </div>

      {/* Bouton principal */}
      <button
        className="zoom-button"
        onClick={stepZoom}
        aria-label={t('Zoomer')}
      >
        <ZoomIn size={20} strokeWidth={1.5} className="zoom-btn-icon" />
      </button>
    </div>
  )
}
