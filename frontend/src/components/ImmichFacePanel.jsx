import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, Unlink, UserRound, X } from 'lucide-react'
import { createPortal } from 'react-dom'

import {
  assignImmichPerson,
  checkImmichStatus,
  fetchImmichLink,
  fetchImmichThumbnail,
  getImmichErrorMessage,
  listImmichPeople,
  unassignImmichPerson,
} from '../api/immichApi.js'
import { t } from '../i18n/index.js'
import PzBusy from './PzBusy.jsx'
import './ImmichFacePanel.css'

// Nombre de miniatures chargées en même temps : une liste peut compter beaucoup de visages.
const MAX_PARALLEL_THUMBNAILS = 3

// Miniatures du panneau : une requête par visage, mise en cache le temps du panneau. Les URL
// blob sont révoquées au démontage. Renvoie request(immichPersonId) -> URL blob, ou null.
function useFaceThumbnails(treeId, token) {
  const cacheRef = useRef(new Map()) // immichPersonId -> URL blob, ou null (pas de vignette)
  const inflightRef = useRef(new Map()) // immichPersonId -> promesse en attente
  const queueRef = useRef([])
  const runningRef = useRef(0)
  const mountedRef = useRef(true)

  const pump = useCallback(() => {
    while (runningRef.current < MAX_PARALLEL_THUMBNAILS && queueRef.current.length > 0) {
      const job = queueRef.current.shift()
      runningRef.current += 1
      job().finally(() => {
        runningRef.current -= 1
        pump()
      })
    }
  }, [])

  const request = useCallback((immichPersonId) => {
    if (cacheRef.current.has(immichPersonId)) return Promise.resolve(cacheRef.current.get(immichPersonId))
    if (inflightRef.current.has(immichPersonId)) return inflightRef.current.get(immichPersonId)

    const promise = new Promise((resolve) => {
      queueRef.current.push(async () => {
        let url = null
        if (mountedRef.current) {
          try {
            url = await fetchImmichThumbnail(treeId, immichPersonId, token)
          } catch {
            url = null
          }
        }
        inflightRef.current.delete(immichPersonId)
        if (!mountedRef.current) {
          if (url) URL.revokeObjectURL(url)
          resolve(null)
          return
        }
        cacheRef.current.set(immichPersonId, url)
        resolve(url)
      })
    })
    inflightRef.current.set(immichPersonId, promise)
    pump()
    return promise
  }, [treeId, token, pump])

  useEffect(() => {
    mountedRef.current = true
    const cache = cacheRef.current
    // La file et les promesses en attente ne sont pas vidées : elles se résolvent à vide dès
    // qu'elles trouvent le panneau démonté, et restent valables si le montage reprend (StrictMode).
    return () => {
      mountedRef.current = false
      cache.forEach((url) => { if (url) URL.revokeObjectURL(url) })
      cache.clear()
    }
  }, [])

  return request
}

// Vrai une fois l'élément affiché (ou tout de suite si eager). Sans IntersectionObserver, vrai.
function useInView(ref, eager) {
  const [inView, setInView] = useState(eager)

  useEffect(() => {
    if (inView) return undefined
    const element = ref.current
    if (!element) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true)
        observer.disconnect()
      }
    }, { rootMargin: '120px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [inView, ref])

  return inView
}

// Visage d'une personne Immich : sa miniature ronde, chargée à l'affichage. En attente, ou sans
// vignette, un rond neutre avec l'icône.
const FaceThumb = ({ immichPersonId, hasThumbnail, request, eager = false, className = '' }) => {
  const ref = useRef(null)
  const inView = useInView(ref, eager)
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!inView || !hasThumbnail || !immichPersonId) return undefined
    let cancelled = false
    request(immichPersonId).then((loaded) => { if (!cancelled) setUrl(loaded) })
    return () => { cancelled = true }
  }, [inView, hasThumbnail, immichPersonId, request])

  return (
    <span ref={ref} className={`immich-face ${className}`} aria-hidden="true">
      {url ? <img src={url} alt="" /> : <UserRound size={16} aria-hidden="true" />}
    </span>
  )
}

// Associer une personne de l'arbre à une personne Immich : sa vignette devient le portrait.
// Réservé aux administrateurs de l'arbre (l'API vérifie le rôle côté serveur).
const ImmichFacePanel = ({ person, treeId, token, onClose, onImmichChange }) => {
  const [available, setAvailable] = useState(null) // null : vérification en cours
  const [unavailableReason, setUnavailableReason] = useState('')
  const [people, setPeople] = useState([])
  const [loadingPeople, setLoadingPeople] = useState(false)
  const [linkedId, setLinkedId] = useState(null) // personne Immich déjà associée à cette fiche
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [error, setError] = useState('')
  const requestThumbnail = useFaceThumbnails(treeId, token)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const status = await checkImmichStatus(treeId, token)
        if (cancelled) return
        setAvailable(Boolean(status?.available))
        setUnavailableReason(status?.available ? '' : (status?.reason || 'unreachable'))
        if (!status?.available) return

        setLoadingPeople(true)
        const [immichPeople, link] = await Promise.all([
          listImmichPeople(treeId, token),
          fetchImmichLink(treeId, person.id, token).catch(() => null),
        ])
        if (cancelled) return
        setPeople(immichPeople)
        setLinkedId(link)
      } catch (err) {
        if (cancelled) return
        setAvailable(false)
        setUnavailableReason('')
        setError(getImmichErrorMessage(err, t))
      } finally {
        if (!cancelled) setLoadingPeople(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [treeId, token, person.id])

  const handleSelect = useCallback((immichPerson) => {
    setSelected(immichPerson)
    setError('')
    setConfirmReplace(false)
  }, [])

  const handleAssign = useCallback(async (replaceAvatar = false) => {
    if (!selected || actionLoading) return
    setActionLoading(true)
    setError('')
    try {
      await assignImmichPerson(treeId, person.id, selected.id, token, { replaceAvatar })
      onImmichChange?.(person.id)
      onClose?.()
    } catch (err) {
      // Un portrait est déjà en place : le serveur refuse le remplacement en silence
      // (409 avatar_exists) ; il revient à l'administrateur de le confirmer.
      if (!replaceAvatar && err?.payload?.error === 'avatar_exists') {
        setConfirmReplace(true)
      } else {
        setError(getImmichErrorMessage(err, t))
      }
    } finally {
      setActionLoading(false)
    }
  }, [selected, actionLoading, treeId, person, token, onImmichChange, onClose])

  const handleUnassign = useCallback(async () => {
    if (!person.avatarFromImmich || actionLoading) return
    setActionLoading(true)
    setError('')
    try {
      await unassignImmichPerson(treeId, person.id, token)
      onImmichChange?.(person.id)
      onClose?.()
    } catch (err) {
      setError(getImmichErrorMessage(err, t))
    } finally {
      setActionLoading(false)
    }
  }, [person, actionLoading, treeId, token, onImmichChange, onClose])

  const filteredPeople = search.trim()
    ? people.filter((immichPerson) => immichPerson.name?.toLowerCase().includes(search.trim().toLowerCase()))
    : people

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  // L'association en place se retire aussi bien sans connexion : changer ou retirer le serveur
  // Immich ne laisse jamais une ancienne image impossible à nettoyer manuellement. Le graphe
  // ne dit que l'origine du portrait (avatarFromImmich), jamais l'identifiant Immich.
  const unassignBlock = person.avatarFromImmich && (
    <div className="immich-current">
      <p>{t('{name} est déjà associée à une personne Immich.', { name: person.firstName || person.lastName })}</p>
      <button type="button" className="pz-btn pz-btn--danger-ghost" onClick={handleUnassign} disabled={actionLoading}>
        <Unlink size={16} aria-hidden="true" /> {t('Retirer l’association')}
      </button>
    </div>
  )

  return createPortal(
    <div className="pz-overlay immich-modal-overlay" onClick={handleOverlayClick}>
      <div className="pz-modal immich-modal-card" role="dialog" aria-modal="true" aria-labelledby="immichFaceTitle">
        <div className="pz-modal-head">
          <p className="pz-eyebrow">{t('Reconnaissance des visages')}</p>
          <h1 id="immichFaceTitle" className="pz-title">{person.firstName} <em>{person.lastName}</em></h1>
        </div>
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pz-modal-close" onClick={onClose} aria-label={t('Fermer')}>
          <X size={18} aria-hidden="true" />
        </button>

        {available === null || loadingPeople ? (
          <div className="immich-body"><PzBusy /></div>
        ) : available === false ? (
          <div className="immich-body">
            {unassignBlock}
            <p className="immich-empty">
              {unavailableReason === 'not_configured'
                ? t('Immich n’est pas configuré pour cet arbre. Ses administrateurs le règlent dans Paramètres de l’arbre.')
                : t('Immich est injoignable.')}
            </p>
            {error && <div className="pz-error immich-error">{error}</div>}
          </div>
        ) : (
          <div className="immich-body">
            {unassignBlock}

            <div className="pz-field">
              <span className="pz-label" id="immichSearchLabel">{t('Personne à associer dans Immich')}</span>
              <div className="immich-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  aria-labelledby="immichSearchLabel"
                  placeholder={t('Rechercher par nom')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {filteredPeople.length === 0 ? (
              <p className="immich-empty">{people.length === 0 ? t('Aucune personne dans Immich.') : t('Aucune personne trouvée.')}</p>
            ) : (
              <div className="immich-list" role="listbox" aria-label={t('Personnes Immich')}>
                {filteredPeople.map((immichPerson) => {
                  const isSelected = selected?.id === immichPerson.id
                  const isLinked = linkedId === immichPerson.id
                  return (
                    <button
                      key={immichPerson.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`immich-person ${isSelected ? 'is-active' : ''} ${isLinked ? 'is-linked' : ''}`}
                      onClick={() => handleSelect(immichPerson)}
                    >
                      <FaceThumb
                        immichPersonId={immichPerson.id}
                        hasThumbnail={immichPerson.hasThumbnail}
                        request={requestThumbnail}
                      />
                      <span className="immich-person-name">{immichPerson.name || t('Sans nom')}</span>
                      {isLinked && <span className="pz-tag pz-tag--accent immich-person-tag">{t('Associée')}</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {selected && (
              <div className="immich-preview">
                <FaceThumb
                  key={selected.id}
                  className="immich-face--preview"
                  immichPersonId={selected.id}
                  hasThumbnail={selected.hasThumbnail}
                  request={requestThumbnail}
                  eager
                />
                <div className="immich-preview-name">{selected.name || t('Sans nom')}</div>
              </div>
            )}

            {error && <div className="pz-error immich-error">{error}</div>}

            {confirmReplace && (
              <p className="immich-confirm">
                {t('Un portrait est déjà en place. Associer cette personne Immich remplacera le portrait actuel et supprimera son fichier.')}
              </p>
            )}

            <div className="pz-modal-actions">
              {confirmReplace ? (
                <>
                  <button type="button" className="pz-btn pz-btn--ghost" onClick={() => setConfirmReplace(false)}>
                    {t('Garder le portrait actuel')}
                  </button>
                  <button type="button" className="pz-btn pz-btn--danger" onClick={() => handleAssign(true)} disabled={actionLoading}>
                    {actionLoading ? <Loader2 size={16} className="immich-spin" aria-hidden="true" /> : null}
                    {t('Remplacer le portrait et associer')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="pz-btn pz-btn--ghost" onClick={onClose}>{t('Annuler')}</button>
                  <button type="button" className="pz-btn pz-btn--primary" onClick={() => handleAssign()} disabled={!selected || actionLoading}>
                    {actionLoading ? <Loader2 size={16} className="immich-spin" aria-hidden="true" /> : null}
                    {t('Associer et prendre le portrait')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

export default ImmichFacePanel
