import { useEffect, useId, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  buildOpenStreetMapEmbedUrl,
  buildOpenStreetMapUrl,
  buildProjectedMapData,
  parseGeoJsonMapText,
  parseGpxMapText,
} from '../utils/geoMedia'
import './MediaViewer.css'
import { t } from '../i18n/index.js'
import { firstNameLabel } from '../utils/personName.js'

const HTTP_URL_RE = /^https?:\/\/\S+$/i

const MediaViewer = ({ media, person, onClose }) => {
  const [mapState, setMapState] = useState({ loading: false, error: '', data: null })
  const svgUid = useId().replace(/:/g, '')
  const mapGridId = `media-map-grid-${svgUid}`
  const mapGlowId = `media-map-glow-${svgUid}`

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) onClose()
  }

  const birthYearLabel = person?.birthYear ?? '-'
  const personYears = person
    ? person.deathYear
      ? `${birthYearLabel} - ${person.deathYear}`
      : `${birthYearLabel}`
    : ''

  const mediaType = media?.type || ''
  const mediaSource = String(media?.source || '').trim()
  const isMediaSourceUrl = HTTP_URL_RE.test(mediaSource)
  const mediaUrl = media?.urlHd || media?.url || ''
  const normalizedMimeType = String(media?.mimeType || '').toLowerCase()
  const isPdfDocument = mediaType === 'document' && (
    normalizedMimeType.includes('pdf') ||
    /\.pdf(?:$|\?)/i.test(mediaUrl)
  )
  const isGeoMedia = mediaType === 'geojson' || mediaType === 'gpx'

  useEffect(() => {
    if (!isGeoMedia || !mediaUrl) {
      setMapState({ loading: false, error: '', data: null })
      return
    }

    let cancelled = false

    async function loadMapPayload() {
      setMapState({ loading: true, error: '', data: null })

      try {
        const response = await fetch(mediaUrl, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error('map_fetch_failed')
        }

        const text = await response.text()
        const raw = mediaType === 'geojson'
          ? parseGeoJsonMapText(text)
          : parseGpxMapText(text)
        const projected = buildProjectedMapData(raw)

        if (!cancelled) {
          setMapState({ loading: false, error: '', data: projected })
        }
      } catch {
        if (!cancelled) {
          setMapState({ loading: false, error: t('Impossible de visualiser cette carte.'), data: null })
        }
      }
    }

    loadMapPayload()

    return () => {
      cancelled = true
    }
  }, [isGeoMedia, mediaType, mediaUrl])

  const openStreetMapUrl = useMemo(() => buildOpenStreetMapUrl(mapState.data), [mapState.data])
  const openStreetMapEmbedUrl = useMemo(() => buildOpenStreetMapEmbedUrl(mapState.data), [mapState.data])
  const focusLabel = useMemo(() => {
    const focus = mapState.data?.focusCoordinate
    if (!focus) {
      return ''
    }
    const [lon, lat] = focus
    return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`
  }, [mapState.data])
  const isSinglePointOnly = Boolean(
    mapState.data &&
    mapState.data.stats.pathCount === 0 &&
    mapState.data.stats.pointCount === 1,
  )

  const typeLabels = useMemo(() => ({
    photo: t('Photo'),
    video: t('Vidéo'),
    audio: t('Voix'),
    document: t('Document'),
    citation: t('Citation'),
    geojson: t('Carte GPS'),
    gpx: t('Trace GPX'),
  }), [])

  const renderPhoto = () => {
    if (!mediaUrl) {
      return (
        <div className="media-document-container">
          <div className="media-document-text">{t('Photo non disponible')}</div>
        </div>
      )
    }

    return (
      <div className="media-photo-frame">
        <img src={mediaUrl} alt={media?.label || t('Photo')} />
      </div>
    )
  }

  const renderVideo = () => {
    if (!mediaUrl) {
      return (
        <div className="media-video-container">
          <div className="media-video-text">{t('Vidéo non disponible')}</div>
        </div>
      )
    }

    if (normalizedMimeType === 'video/youtube') {
      // Extract YouTube video ID and build embed URL
      const watchMatch = mediaUrl.match(/[?&]v=([^&]+)/)
      const shortMatch = mediaUrl.match(/youtu\.be\/([^/?]+)/)
      const videoId = (watchMatch?.[1] || shortMatch?.[1] || '').split(/[?#]/)[0]
      // Un identifiant YouTube fait 11 caractères : tout le reste est refusé plutôt qu'intégré
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return (
          <div className="media-video-container">
            <div className="media-video-text">{t('Lien YouTube invalide')}</div>
          </div>
        )
      }
      // youtube-nocookie : pas de cookie YouTube tant que la vidéo n'est pas lancée
      const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`
      return (
        <div className="media-video-container media-video-container--youtube">
          <iframe
            className="media-video-player media-video-player--youtube"
            src={embedUrl}
            title={media?.label || t('Vidéo YouTube')}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )
    }

    return (
      <video className="media-video-player" src={mediaUrl} controls preload="metadata" />
    )
  }

  const renderAudio = () => {
    if (!mediaUrl) {
      return (
        <>
          <div className="media-audio-container">
            <div className="media-audio-grooves" />
            <div className="media-audio-label-circle">
              <div className="media-audio-hole" />
            </div>
          </div>
          <div className="media-audio-text">{t('Audio non disponible')}</div>
        </>
      )
    }

    return (
      <div className="media-audio-player-wrap">
        <audio className="media-audio-player" src={mediaUrl} controls preload="metadata" />
      </div>
    )
  }

  const renderDocument = () => {
    if (!mediaUrl) {
      return (
        <div className="media-document-container">
          <div className="media-document-corner" />
          <div className="media-document-lines">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="media-document-line" />
            ))}
          </div>
          <div className="media-document-text">{t('Document non disponible')}</div>
        </div>
      )
    }

    if (isPdfDocument) {
      return (
        <div className="media-document-viewer">
          <iframe
            className="media-document-pdf"
            src={mediaUrl}
            title={media?.label || t('Document PDF')}
          />
          <div className="media-document-actions">
            <a className="media-document-download" href={mediaUrl} target="_blank" rel="noreferrer">
              {t('Ouvrir le PDF dans un nouvel onglet')}
            </a>
          </div>
        </div>
      )
    }

    return (
      <div className="media-document-container">
        <div className="media-document-corner" />
        <div className="media-document-lines">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="media-document-line" />
          ))}
        </div>
        <div className="media-document-text">{t('Aperçu limité pour ce format')}</div>
        <div className="media-document-actions">
          <a className="media-document-download" href={mediaUrl} target="_blank" rel="noreferrer">
            {t('Télécharger / ouvrir le document')}
          </a>
        </div>
      </div>
    )
  }

  const renderGeoMap = () => {
    if (!mediaUrl) {
      return (
        <div className="media-map-viewer">
          <div className="media-map-status">{t('Fichier cartographique non disponible.')}</div>
        </div>
      )
    }

    if (mapState.loading) {
      return (
        <div className="media-map-viewer">
          <div className="media-map-status">{t('Chargement de la carte...')}</div>
        </div>
      )
    }

    if (mapState.error || !mapState.data) {
      return (
        <div className="media-map-viewer">
          <div className="media-map-status">{mapState.error || t('Visualisation indisponible.')}</div>
          <div className="media-map-actions">
            <a className="media-map-open" href={mediaUrl} target="_blank" rel="noreferrer">
              {t('Ouvrir le fichier')}
            </a>
          </div>
        </div>
      )
    }

    return (
      <div className="media-map-viewer">
        <div className="media-map-context">
          {isSinglePointOnly && openStreetMapEmbedUrl ? (
            <iframe
              className="media-map-embed"
              src={openStreetMapEmbedUrl}
              title={t('Carte OpenStreetMap')}
              loading="lazy"
              // Origine seulement : l'adresse complète contient celle de l'arbre
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <svg
              className="media-map-svg media-map-svg--standalone"
              viewBox={`0 0 ${mapState.data.width} ${mapState.data.height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={t('Aperçu cartographique du média')}
            >
              <defs>
                <pattern id={mapGridId} width="22" height="22" patternUnits="userSpaceOnUse">
                  <path d="M 22 0 L 0 0 0 22" className="media-map-grid" />
                </pattern>
                <radialGradient id={mapGlowId} cx="52%" cy="42%" r="82%">
                  <stop offset="0%" className="media-map-bg-center" />
                  <stop offset="100%" className="media-map-bg-edge" />
                </radialGradient>
              </defs>

              <rect x="0" y="0" width={mapState.data.width} height={mapState.data.height} fill={`url(#${mapGlowId})`} />
              <rect x="0" y="0" width={mapState.data.width} height={mapState.data.height} fill={`url(#${mapGridId})`} />

              {mapState.data.paths.map((path, pathIndex) => (
                <polyline
                  key={`path-${pathIndex}`}
                  className="media-map-trace"
                  points={path.map((point) => `${point.x},${point.y}`).join(' ')}
                />
              ))}

              {mapState.data.points.map((point, pointIndex) => (
                <g key={`pt-${pointIndex}`}>
                  <circle className="media-map-point-ring" cx={point.x} cy={point.y} r="7" />
                  <circle className="media-map-point" cx={point.x} cy={point.y} r="3.5" />
                </g>
              ))}
            </svg>
          )}
        </div>

        <div className="media-map-meta">
          <span>{t('{n} trace(s)', { n: mapState.data.stats.pathCount })}</span>
          <span>{t('{n} point(s)', { n: mapState.data.stats.pointCount })}</span>
          <span>{t('{n} coordonnee(s)', { n: mapState.data.stats.vertexCount })}</span>
          {focusLabel && <span>{t('Centre : {coords}', { coords: focusLabel })}</span>}
        </div>

        <div className="media-map-actions">
          {openStreetMapUrl && (
            <a className="media-map-open" href={openStreetMapUrl} target="_blank" rel="noreferrer">
              {t('Ouvrir dans OpenStreetMap')}
            </a>
          )}
          <a className="media-map-open" href={mediaUrl} target="_blank" rel="noreferrer">
            {t('Ouvrir le fichier source')}
          </a>
        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (mediaType) {
      case 'photo':
        return renderPhoto()
      case 'video':
        return renderVideo()
      case 'audio':
        return renderAudio()
      case 'document':
        return renderDocument()
      case 'geojson':
      case 'gpx':
        return renderGeoMap()
      case 'citation':
        return (
            <blockquote className="media-citation-container">
              <p className="media-citation-text">« {media?.label || t('Citation sans texte')} »</p>
            </blockquote>
        )
      default:
        return null
    }
  }

  if (!media) return null

  return (
    <div className="pz-overlay media-viewer-overlay" onClick={handleOverlayClick}>
      <div
        className={`media-viewer-card media-viewer-card--${mediaType}`}
        role="dialog"
        aria-modal="true"
        aria-label={media?.label || typeLabels[mediaType] || t('Souvenir')}
      >
        <button
          type="button"
          className="pz-btn pz-btn--ghost pz-btn--icon media-viewer-close"
          onClick={onClose}
          aria-label={t('Fermer le souvenir')}
        >
          <X size={18} strokeWidth={2.25} />
        </button>

        <div className="mv-stage">
          {renderContent()}
        </div>

        <div className="mv-caption">
          {mediaType !== 'citation' && media?.label && (
            <h2 className="mv-title">{media.label}</h2>
          )}
          <div className="mv-meta">
            <span className="mv-person">
              {person?.photo ? (
                <img className="mv-person-avatar" src={person.photo} alt="" />
              ) : (
                <span className="mv-person-avatar mv-person-initial">{person?.firstName?.[0] || '?'}</span>
              )}
              <span className="mv-person-name">{person ? firstNameLabel(person) : ''} <em>{person?.lastName}</em></span>
              {personYears && <span className="mv-person-years">{personYears}</span>}
            </span>
            <span className="pz-tag">{typeLabels[mediaType] || mediaType}</span>
          </div>
          {mediaSource && (
            <p className="mv-source">
              {t('Source')}{' '}
              {isMediaSourceUrl ? (
                <a href={mediaSource} target="_blank" rel="noreferrer">{mediaSource}</a>
              ) : (
                <span>{mediaSource}</span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default MediaViewer
