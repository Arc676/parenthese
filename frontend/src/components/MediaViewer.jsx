import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pencil, UserPlus, X } from 'lucide-react'
import { MediaPeopleList, MediaPeopleMarkers } from './MediaPeople.jsx'
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
import { eventTitle } from '../utils/lifeTimeline.js'
import { getAccountErrorMessage } from '../utils/errorMessages.js'
import { growFromTransform, takeOrigin } from '../utils/openOrigin.js'
import { useSheetDrag, useSheetMode } from '../hooks/useSheetDrag.js'

const HTTP_URL_RE = /^https?:\/\/\S+$/i
const MAX_TITLE_LENGTH = 280
const MAX_CITATION_LENGTH = 2000

// Moment de vie qui porte ce souvenir (mediaIds des événements de la route /life)
const findLinkedEventId = (events, mediaId) => {
  const id = String(mediaId)
  return events.find((event) => (event.mediaIds || []).map(String).includes(id))?.id ?? null
}

const MediaViewer = ({
  media,
  person,
  onClose,
  canEdit = false,
  onLoadLifeEvents,
  onSave,
  // Personnes identifiées : canTag ouvre l'identification (admin en direct, famille en proposition)
  getPerson = () => null,
  allPersons = [],
  canTag = false,
  onSavePeople,
  onOpenPerson,
}) => {
  const [mapState, setMapState] = useState({ loading: false, error: '', data: null })
  const [tagging, setTagging] = useState(false)
  const [draftPeople, setDraftPeople] = useState([])
  const [activeTagId, setActiveTagId] = useState(null)
  // Visages identifiés : rien sur la photo par défaut (Patch, 27/10). Toucher la photo montre ou cache les prénoms,
  // survoler un prénom sous la photo entoure son visage.
  const [showNames, setShowNames] = useState(false)
  const [hotPersonId, setHotPersonId] = useState(null)
  const [savingPeople, setSavingPeople] = useState(false)
  const [peopleError, setPeopleError] = useState('')
  const [peopleNotice, setPeopleNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [lifeEvents, setLifeEvents] = useState([])
  const [draft, setDraft] = useState({ title: '', citationText: '', lifeEventId: null })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const svgUid = useId().replace(/:/g, '')
  const mapGridId = `media-map-grid-${svgUid}`
  const mapGlowId = `media-map-glow-${svgUid}`

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) onClose()
  }

  const isCitation = media?.type === 'citation'
  const savedPeople = Array.isArray(media?.people) ? media.people : []
  const shownPeople = tagging ? draftPeople : savedPeople

  const startTagging = () => {
    setPeopleError('')
    setPeopleNotice('')
    setDraftPeople(savedPeople.map((tag) => ({ ...tag })))
    setActiveTagId(null)
    setTagging(true)
  }

  const cancelTagging = () => {
    setTagging(false)
    setActiveTagId(null)
    setPeopleError('')
  }

  // Ajoutée, la personne devient celle dont on place le point (photo seulement)
  const addTag = (personId) => {
    setDraftPeople((current) => [...current, { personId, x: null, y: null }])
    setActiveTagId(media?.type === 'photo' ? personId : null)
  }

  const removeTag = (personId) => {
    setDraftPeople((current) => current.filter((tag) => tag.personId !== personId))
    setActiveTagId((current) => (current === personId ? null : current))
  }

  const placeActiveTag = (event) => {
    if (!tagging || !activeTagId) return
    const box = event.currentTarget.getBoundingClientRect()
    const clamp = (value) => Math.min(1, Math.max(0, value))
    const x = Number(clamp((event.clientX - box.left) / box.width).toFixed(4))
    const y = Number(clamp((event.clientY - box.top) / box.height).toFixed(4))
    setDraftPeople((current) => current.map((tag) => (tag.personId === activeTagId ? { ...tag, x, y } : tag)))
    setActiveTagId(null)
  }

  const savePeople = async () => {
    setSavingPeople(true)
    setPeopleError('')
    try {
      const result = await onSavePeople(draftPeople)
      setTagging(false)
      setActiveTagId(null)
      if (result?.status === 'pending') setPeopleNotice(t('Merci. La personne qui gère l’arbre va relire votre proposition.'))
    } catch (error) {
      setPeopleError(getAccountErrorMessage(error))
    } finally {
      setSavingPeople(false)
    }
  }

  const startEditing = async () => {
    setSaveError('')
    const linkedInitially = 'lifeEventId' in (media || {}) ? media.lifeEventId ?? null : null
    setDraft({ title: media?.label || '', citationText: media?.label || '', lifeEventId: linkedInitially })
    setEditing(true)
    if (!onLoadLifeEvents) return
    try {
      const data = await onLoadLifeEvents()
      const events = Array.isArray(data?.events) ? data.events : []
      setLifeEvents(events)
      if (!('lifeEventId' in (media || {}))) {
        setDraft((current) => ({ ...current, lifeEventId: findLinkedEventId(events, media.id) }))
      }
    } catch {
      setSaveError(t('Impossible de charger les moments de vie.'))
    }
  }

  const cancelEditing = () => {
    setEditing(false)
    setSaveError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const caption = (isCitation ? draft.citationText : draft.title).trim()
    if (!caption) {
      setSaveError(isCitation ? t('Saisissez le texte de la citation.') : t('Donnez un titre au souvenir.'))
      return
    }
    if (caption.length > (isCitation ? MAX_CITATION_LENGTH : MAX_TITLE_LENGTH)) {
      setSaveError(isCitation ? t('Le texte de la citation est trop long.') : t('Le titre est trop long.'))
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await onSave({ caption, lifeEventId: draft.lifeEventId ?? null })
      setEditing(false)
    } catch (error) {
      setSaveError(getAccountErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const renderEditForm = () => (
    <form className="mv-edit-form" onSubmit={handleSubmit}>
      {isCitation ? (
        <label className="mv-edit-field">
          <span className="mv-edit-label">{t('Texte de la citation')}</span>
          <textarea
            className="mv-edit-quote"
            rows={3}
            maxLength={MAX_CITATION_LENGTH}
            value={draft.citationText}
            onChange={(event) => setDraft((current) => ({ ...current, citationText: event.target.value }))}
          />
        </label>
      ) : (
        <label className="mv-edit-field">
          <span className="mv-edit-label">{t('Titre')}</span>
          <input
            className="mv-edit-title"
            type="text"
            maxLength={MAX_TITLE_LENGTH}
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
      )}
      <label className="mv-edit-field">
        <span className="mv-edit-label">{t('Moment de sa vie')}</span>
        <select
          className="mv-edit-select"
          value={draft.lifeEventId ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, lifeEventId: event.target.value || null }))}
        >
          <option value="">{t('Aucun')}</option>
          {lifeEvents.map((lifeEvent) => {
            const year = lifeEvent.date ? String(lifeEvent.date).slice(0, 4) : ''
            return (
              <option key={lifeEvent.id} value={lifeEvent.id}>
                {year ? `${eventTitle(lifeEvent)} (${year})` : eventTitle(lifeEvent)}
              </option>
            )
          })}
        </select>
      </label>
      {saveError && <p className="mv-edit-error" role="alert">{saveError}</p>}
      <div className="mv-edit-actions">
        <button type="button" className="pz-btn pz-btn--ghost" onClick={cancelEditing} disabled={saving}>
          {t('Annuler')}
        </button>
        <button type="submit" className="pz-btn pz-btn--primary" disabled={saving}>
          {t('Enregistrer')}
        </button>
      </div>
    </form>
  )

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

    // La boîte épouse l'image : les points (x, y en proportion) tombent pile sur les visages
    return (
      <div className="media-photo-frame">
        <div
          className={`mv-photo-box${tagging ? ' is-tagging' : ''}${activeTagId ? ' is-placing' : ''}${showNames ? ' show-names' : ''}`}
          onClick={(event) => (tagging ? placeActiveTag(event) : setShowNames((shown) => !shown))}
        >
          <img src={mediaUrl} alt={media?.label || t('Photo')} />
          <MediaPeopleMarkers
            people={shownPeople}
            getPerson={getPerson}
            activeId={activeTagId}
            hotId={tagging ? null : hotPersonId}
            onOpenPerson={tagging ? (id) => setActiveTagId(id) : onOpenPerson}
          />
        </div>
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

  // Ouvert depuis une vignette de la fiche : la carte part de la vignette et grandit jusqu'à sa place (Patch, 27/10).
  // Avant la peinture, pour ne jamais montrer la carte à sa place une image plus tôt.
  const cardRef = useRef(null)
  const mediaId = media?.id
  useLayoutEffect(() => {
    const card = cardRef.current
    const from = takeOrigin()
    if (!card || !from) return
    card.style.animation = 'none'
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // Sur téléphone, la fenêtre est collée en bas (pz.css, place-items: end) : on part du bord bas
    const anchor = getComputedStyle(card.parentElement).alignItems.includes('end') ? 'bottom' : 'center'
    const start = growFromTransform(from, card.getBoundingClientRect().width, { width: window.innerWidth, height: window.innerHeight }, anchor)
    if (!start) return
    card.style.transformOrigin = start.origin
    card.animate?.([{ transform: start.transform }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.23, 1, .32, 1)' })
  }, [mediaId])

  // Téléphone : glisser la photo vers le bas ferme le souvenir, comme la fiche (Patch, 27/10). Pas pendant
  // l'identification (on touche la photo pour placer un visage), ni quand la carte a défilé (on remonte d'abord).
  const sheetMode = useSheetMode()
  const drag = useSheetDrag({
    enabled: sheetMode && !tagging,
    zone: '.mv-photo-box',
    onClose,
    canStart: () => (cardRef.current?.scrollTop ?? 0) <= 0,
  })

  if (!media) return null

  return (
    <div className="pz-overlay media-viewer-overlay" onClick={handleOverlayClick}>
      <div
        ref={cardRef}
        style={drag.style}
        data-dragging={drag.dragging || undefined}
        {...drag.bind}
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
          {editing ? renderEditForm() : (
            <div className="mv-title-row">
              {mediaType !== 'citation' && media?.label && (
                <h2 className="mv-title">{media.label}</h2>
              )}
              {canEdit && onSave && (
                <button
                  type="button"
                  className="mv-edit-btn"
                  onClick={startEditing}
                  aria-label={t('Modifier le souvenir')}
                >
                  <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
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
          {(mediaType === 'photo' || mediaType === 'video') && !editing && (
            tagging ? (
              <div className="mv-people-edit">
                <p className="mv-people-hint">
                  {mediaType === 'photo'
                    ? (activeTagId ? t('Touchez son visage sur la photo.') : t('Ajoutez les personnes, puis touchez leur visage sur la photo.'))
                    : t('Ajoutez les personnes de la vidéo.')}
                </p>
                <MediaPeopleList
                  people={draftPeople}
                  getPerson={getPerson}
                  allPersons={allPersons}
                  editing
                  canPlace={mediaType === 'photo'}
                  activeId={activeTagId}
                  onActivate={setActiveTagId}
                  onAdd={addTag}
                  onRemove={removeTag}
                />
                {peopleError && <p className="mv-edit-error" role="alert">{peopleError}</p>}
                <div className="mv-edit-actions">
                  <button type="button" className="pz-btn pz-btn--ghost" onClick={cancelTagging} disabled={savingPeople}>
                    {t('Annuler')}
                  </button>
                  <button type="button" className="pz-btn pz-btn--primary" onClick={savePeople} disabled={savingPeople}>
                    {t('Enregistrer')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mv-people">
                <MediaPeopleList people={savedPeople} getPerson={getPerson} onOpenPerson={onOpenPerson} onHover={setHotPersonId} />
                {canTag && onSavePeople && (
                  <button type="button" className="pz-btn pz-btn--soft pz-btn--sm mv-people-btn" onClick={startTagging}>
                    <UserPlus size={15} strokeWidth={2} aria-hidden="true" />
                    {savedPeople.length ? t('Modifier les personnes') : mediaType === 'video' ? t('Qui est sur la vidéo ?') : t('Qui est sur la photo ?')}
                  </button>
                )}
                {peopleNotice && <p className="mv-people-notice" role="status">{peopleNotice}</p>}
              </div>
            )
          )}
          {mediaSource && !editing && (
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
