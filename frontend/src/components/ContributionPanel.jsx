import { useEffect, useState } from 'react'
import { buildMediaUrl } from '../utils/mediaToken.js'
import { API_BASE_URL } from '../api/client'
import { persons as treePersons } from '../data/mockData'
import { Check, ChevronDown, Copy, RefreshCw, X } from 'lucide-react'
import './SettingsPanels.css'
import PzBusy from './PzBusy.jsx'
import { HELP_URL } from '../utils/siteLinks.js'
import { t, dateLocale } from '../i18n/index.js'

// ─── helpers ────────────────────────────────────────────────────────────────

function formatAction(action) {
  if (action === 'create') return t('Création')
  if (action === 'update') return t('Modification')
  if (action === 'delete') return t('Suppression')
  if (action === 'reorder') return t('Réorganisation')
  return t('Changement')
}

function formatEntityType(entityType) {
  if (entityType === 'person') return t('personne')
  if (entityType === 'union') return t('union')
  if (entityType === 'parent_child_link') return t('lien parent-enfant')
  if (entityType === 'annotation') return t('annotation')
  if (entityType === 'media') return t('souvenir')
  return t('élément')
}

const MEDIA_TYPE_LABELS = {
  photo: t('Photo'),
  video: t('Vidéo'),
  audio: t('Voix'),
  document: t('Document'),
  citation: t('Citation'),
  geojson: t('Carte'),
  gpx: t('Trajet'),
}

// Souvenir envoyé par la famille : de quoi juger avant d'accepter
function getMediaPreview(change, treeId) {
  const data = (change.afterJson && typeof change.afterJson === 'object') ? change.afterJson : {}
  const label = MEDIA_TYPE_LABELS[data.type] || t('Souvenir')
  const caption = typeof data.caption === 'string' ? data.caption : ''
  const isYoutube = data.mimeType === 'video/youtube'
  const url = change.entityId && treeId && !isYoutube
    ? buildMediaUrl(`/trees/${encodeURIComponent(treeId)}/media/${encodeURIComponent(change.entityId)}`, API_BASE_URL)
    : null
  return { type: data.type, label, caption, url, isYoutube }
}

function formatAnnotationType(type) {
  if (type === 'sticker') return t('Sticker')
  if (type === 'drawing') return t('Dessin')
  if (type === 'text') return t('Texte')
  if (type === 'photo') return t('Photo canvas')
  return t('Annotation')
}

const PERSON_FIELD_LABELS = {
  firstName: t('Prénom'),
  lastName: t('Nom'),
  birthName: t('Nom de naissance'),
  birthDate: t('Date de naissance'),
  deathDate: t('Date de décès'),
  birthPlace: t('Lieu de naissance'),
  profession: t('Métier'),
  nationality: t('Nationalité'),
  region: t('Région'),
  notes: t('Notes'),
}

function displayVal(v) {
  if (v === null || v === undefined || v === '') return null
  return String(v)
}

// Nom d'une personne citée par un lien : dans l'arbre, ou ajoutée dans la même contribution (id provisoire « tmp: »)
function nameOfPersonRef(id, sessionChanges = []) {
  if (!id) return null
  const key = String(id)
  if (key.startsWith('tmp:')) {
    const added = sessionChanges.find((c) => c.entityType === 'person' && c.afterJson?.ref === key)
    const name = `${added?.afterJson?.firstName || ''} ${added?.afterJson?.lastName || ''}`.trim()
    return name || t('la nouvelle personne')
  }
  const person = treePersons.find((candidate) => String(candidate.id) === key)
  const name = `${person?.firstName || ''} ${person?.lastName || ''}`.trim()
  return name || null
}

function getRelationLabel(change, sessionChanges) {
  const data = change.afterJson && typeof change.afterJson === 'object' ? change.afterJson : null
  if (!data) return null
  if (change.entityType === 'parent_child_link') {
    const child = nameOfPersonRef(data.childPersonId, sessionChanges)
    const parent = nameOfPersonRef(data.parentPersonId, sessionChanges)
    return child && parent ? t('{child}, enfant de {parent}', { child, parent }) : null
  }
  if (change.entityType === 'union') {
    const a = nameOfPersonRef(data.partner1PersonId, sessionChanges)
    const b = nameOfPersonRef(data.partner2PersonId, sessionChanges)
    return a && b ? t('{a} et {b}', { a, b }) : null
  }
  return null
}

function getPersonDisplayName(change, sessionChanges = []) {
  const relationLabel = getRelationLabel(change, sessionChanges)
  if (relationLabel) return relationLabel
  if (change.entityType === 'annotation') {
    const data = change.afterJson || change.after || {}
    return formatAnnotationType(data.type)
  }
  if (change.entityType === 'media') {
    const data = change.afterJson || {}
    return MEDIA_TYPE_LABELS[data.type] || t('Souvenir')
  }
  const data = (change.afterJson && typeof change.afterJson === 'object')
    ? change.afterJson
    : (change.beforeJson && typeof change.beforeJson === 'object' ? change.beforeJson : null)
  if (!data) return null
  const name = `${data.firstName || ''} ${data.lastName || ''}`.trim()
  return name || null
}

function getFieldRows(change) {
  if (change.entityType !== 'person') return []
  const after = change.afterJson
  if (!after || typeof after !== 'object') return []
  const before = (change.beforeJson && typeof change.beforeJson === 'object') ? change.beforeJson : null

  return Object.entries(after)
    .filter(([key]) => PERSON_FIELD_LABELS[key])
    .map(([key, newVal]) => ({
      key,
      label: PERSON_FIELD_LABELS[key],
      oldVal: before !== null ? before[key] : undefined,
      newVal,
    }))
    .filter(({ newVal, oldVal }) => {
      if (oldVal !== undefined) return true
      return newVal !== null && newVal !== undefined && newVal !== ''
    })
}

function getAnnotationPreview(change, treeId) {
  const data = change.afterJson || change.after || {}
  const type = data.type
  if (!type) return null
  if (type === 'sticker') return { type, emoji: data.content || '?' }
  if (type === 'text') return { type, text: data.content || '' }
  if (type === 'drawing') return { type, color: data.style?.color || '#2A2622' }
  if (type === 'photo') {
    try {
      // Seulement une photo de cet arbre, reconstruite depuis son chemin : une adresse fournie par
      // l'auteur de la contribution pourrait pister celui qui relit
      const parsed = typeof data.content === 'string' ? JSON.parse(data.content) : data.content
      const prefix = `/trees/${treeId}/annotation-photos/`
      const photoPath = typeof parsed?.photoPath === 'string' ? parsed.photoPath : ''
      const isOwnPhoto = photoPath.startsWith(prefix) && /^[A-Za-z0-9-]+$/.test(photoPath.slice(prefix.length))
      return { type, url: isOwnPhoto ? buildMediaUrl(photoPath, API_BASE_URL) : null }
    } catch { return { type } }
  }
  return { type }
}

function formatSessionDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(dateLocale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Message d'invitation prêt à envoyer par mail, SMS ou WhatsApp
function buildInviteText(url, password) {
  return [
    t('Bonjour à tous,'),
    '',
    t("Je rassemble l'histoire de notre famille dans un arbre en ligne, et j'aimerais que vous m'aidiez à le compléter."),
    '',
    t("L'arbre est ici {url}", { url }),
    t("Le mot de passe pour l'ouvrir est {password}", { password }),
    '',
    t("En bas de l'écran, vous pouvez ajouter une photo, un souvenir ou une personne qui manque."),
    t("Le mode d'emploi, si besoin {url}", { url: HELP_URL }),
  ].join('\n')
}

// ─── component ──────────────────────────────────────────────────────────────

const ContributionPanel = ({
  visible,
  treeId,
  canModerate,
  loading,
  errorMessage,
  inviteShareUrl,
  inviteKnownPasswords,
  inviteSaving,
  inviteError,
  inviteMessage,
  sessions,
  reviewingSessionId,
  onClose,
  onRefresh,
  onRotatePasswords,
  onRememberPassword,
  onReviewSession,
}) => {
  const [decisionMap, setDecisionMap] = useState({})
  const [collapsedSessions, setCollapsedSessions] = useState(new Set())
  const [confirmApproveAll, setConfirmApproveAll] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  // '' | 'change' (nouveau mot de passe) | 'remember' (arbre d'avant : saisir celui déjà donné)
  const [passwordMode, setPasswordMode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [inviteLocalError, setInviteLocalError] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')

  // Load persisted decisions from localStorage
  useEffect(() => {
    if (!treeId) return
    try {
      const saved = localStorage.getItem(`contrib_decisions_${treeId}`)
      if (saved) setDecisionMap(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [treeId])

  // Persist decisions to localStorage on change
  useEffect(() => {
    if (!treeId) return
    try {
      localStorage.setItem(`contrib_decisions_${treeId}`, JSON.stringify(decisionMap))
    } catch { /* ignore */ }
  }, [treeId, decisionMap])

  const toggleCollapse = (sessionId) => {
    setCollapsedSessions((prev) => {
      const next = new Set(prev)
      next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId)
      return next
    })
  }

  const toggleChangeDecision = (sessionId, changeId, decision) => {
    setDecisionMap((current) => {
      const prev = current[sessionId]?.[changeId] || ''
      const next = prev === decision ? '' : decision
      return { ...current, [sessionId]: { ...(current[sessionId] || {}), [changeId]: next } }
    })
  }

  const getChangeDecision = (sessionId, changeId) =>
    decisionMap?.[sessionId]?.[changeId] || ''

  const buildChangeDecisions = (sessionId) => {
    const raw = decisionMap[sessionId] || {}
    return Object.entries(raw)
      .filter(([, d]) => d === 'approved' || d === 'rejected')
      .map(([changeId, decision]) => ({ changeId, decision }))
  }

  const getSessionSummary = (sessionId, changes) => {
    const decisions = decisionMap[sessionId] || {}
    let approved = 0, rejected = 0, pending = 0
    for (const ch of (changes || [])) {
      const d = decisions[ch.id] || ''
      if (d === 'approved') approved++
      else if (d === 'rejected') rejected++
      else pending++
    }
    return { approved, rejected, pending, total: (changes || []).length }
  }

  const applyDecisions = (sessionId, changes) => {
    const explicit = buildChangeDecisions(sessionId)
    const explicitIds = new Set(explicit.map((d) => d.changeId))
    const allDecisions = [
      ...explicit,
      ...(changes || [])
        .filter((ch) => !explicitIds.has(ch.id))
        .map((ch) => ({ changeId: ch.id, decision: 'rejected' })),
    ]
    onReviewSession(sessionId, { decision: 'rejected', changeDecisions: allDecisions })
  }

  useEffect(() => {
    if (!visible) return undefined
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  useEffect(() => {
    if (!copyFeedback) return undefined
    const timer = window.setTimeout(() => setCopyFeedback(''), 1800)
    return () => window.clearTimeout(timer)
  }, [copyFeedback])

  useEffect(() => {
    if (!visible) return
    setPasswordMode('')
    setNewPassword('')
    setInviteLocalError('')
  }, [inviteKnownPasswords?.share, visible])

  const knownShare = inviteKnownPasswords?.share || ''
  const defaultInviteText = knownShare && inviteShareUrl ? buildInviteText(inviteShareUrl, knownShare) : ''
  const [inviteText, setInviteText] = useState('')
  useEffect(() => { setInviteText(defaultInviteText) }, [defaultInviteText])

  const handleCopy = async (value, label) => {
    const text = String(value || '').trim()
    if (!text) return
    try { await navigator.clipboard.writeText(text); setCopyFeedback(label) }
    catch { setCopyFeedback(t('Copie indisponible')) }
  }

  const handleSavePassword = async (e) => {
    e.preventDefault()
    setInviteLocalError('')
    if (passwordMode === 'remember') {
      if (!newPassword.trim()) return
      const result = await onRememberPassword?.({ password: newPassword.trim() })
      if (result?.ok) { setPasswordMode(''); setNewPassword('') }
      return
    }
    if (newPassword.trim().length < 8) { setInviteLocalError(t('Minimum 8 caractères.')); return }
    const result = await onRotatePasswords?.({ password: newPassword.trim() })
    if (result?.ok) { setPasswordMode(''); setNewPassword('') }
  }

  if (!visible) return null

  const [familyTitleBefore, familyTitleAfter] = t('La famille {em}').split('{em}')

  return (
    <div className="pz-overlay contrib-overlay" onClick={() => onClose?.()}>
      <div
        className="pz-modal pz-modal--wide contrib-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contribPanelTitle"
      >
        <div className="pz-modal-head">
          <p className="pz-eyebrow">{t('Partager et relire')}</p>
          <h1 id="contribPanelTitle" className="pz-title">{familyTitleBefore}<em>{t('participe')}</em>{familyTitleAfter}</h1>
        </div>
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pz-modal-close" onClick={onClose} aria-label={t('Fermer')}>
          <X size={18} strokeWidth={2} />
        </button>

        {canModerate ? (
          <div className="contrib-list-section">

            {/* ── Section invitation ── */}
            <div className="contrib-invite">
              <div className="contrib-invite-top">
                <strong className="contrib-invite-title">{t('Le lien à envoyer à la famille')}</strong>
                {copyFeedback && <span className="contrib-copy-feedback">{copyFeedback}</span>}
              </div>
              <div className="contrib-invite-link">
                <code className="contrib-link-url">{inviteShareUrl || t('Lien indisponible')}</code>
                <button type="button" className="pz-btn pz-btn--primary pz-btn--sm" disabled={!inviteShareUrl} onClick={() => handleCopy(inviteShareUrl, t('Lien copié'))}><Copy size={14} strokeWidth={2} />{t('Copier')}</button>
              </div>
              <div className="contrib-invite-passwords">
                <div className="contrib-role-row">
                  <span className="contrib-role-badge"><strong>{t('Mot de passe')}</strong><small>{t('pour regarder et ajouter')}</small></span>
                  {passwordMode ? (
                    <form className="contrib-pass-edit-inline" onSubmit={handleSavePassword}>
                      <input className="contrib-pass-edit-input" type="text" value={newPassword} placeholder={passwordMode === 'remember' ? t('Celui déjà donné à la famille') : t('8 caractères minimum')} aria-label={passwordMode === 'remember' ? t('Mot de passe actuel') : t('Nouveau mot de passe')} autoFocus autoComplete="off" onChange={(e) => setNewPassword(e.target.value)} />
                      <button type="submit" className="contrib-pill-btn contrib-pill-btn--save" disabled={inviteSaving}><PzBusy busy={inviteSaving} busyLabel={t('Enregistrement en cours')}>{passwordMode === 'remember' ? t('Vérifier') : t('Enregistrer')}</PzBusy></button>
                      <button type="button" className="contrib-pill-btn contrib-pill-btn--ghost" onClick={() => { setPasswordMode(''); setNewPassword(''); setInviteLocalError('') }}>{t('Annuler')}</button>
                    </form>
                  ) : (
                    <>
                      <button type="button" className={`contrib-pass-reveal${knownShare && !showPassword ? ' contrib-pass-reveal--blurred' : ''}`} onClick={() => setShowPassword((v) => !v)} disabled={!knownShare} title={showPassword ? t('Cliquer pour masquer') : t('Cliquer pour révéler')}>{knownShare || t('Pas encore enregistré')}</button>
                      {knownShare && <button type="button" className="contrib-pill-btn contrib-pill-btn--edit" onClick={() => handleCopy(knownShare, t('Mot de passe copié'))}>{t('Copier')}</button>}
                      {!knownShare && <button type="button" className="contrib-pill-btn contrib-pill-btn--edit" disabled={inviteSaving} onClick={() => setPasswordMode('remember')}>{t("Saisir l'actuel")}</button>}
                      <button type="button" className="contrib-pill-btn contrib-pill-btn--edit" disabled={inviteSaving} onClick={() => setPasswordMode('change')}>{t('Changer')}</button>
                    </>
                  )}
                </div>
                <p className="contrib-pass-hint">
                  {passwordMode === 'remember' || (!knownShare && !passwordMode)
                    ? t("Déjà donné à la famille ? Saisissez-le ici. Il est vérifié puis gardé, rien ne change pour ceux qui ont déjà ouvert l'arbre.")
                    : t("Changer le mot de passe oblige les personnes qui ont déjà ouvert l'arbre à saisir le nouveau.")}
                </p>
              </div>
              {defaultInviteText && (
                <div className="contrib-invite-message">
                  <label className="contrib-invite-title" htmlFor="contrib-invite-text">{t('Le message à envoyer')}</label>
                  <textarea id="contrib-invite-text" className="contrib-invite-textarea" rows={9} value={inviteText} onChange={(e) => setInviteText(e.target.value)} />
                  <div className="contrib-invite-message-actions">
                    <button type="button" className="pz-btn pz-btn--primary pz-btn--sm" onClick={() => handleCopy(inviteText, t('Message copié'))}><Copy size={14} strokeWidth={2} />{t('Copier le message')}</button>
                  </div>
                </div>
              )}
              {(inviteLocalError || inviteError) && <div className="contrib-error">{inviteLocalError || inviteError}</div>}
              {inviteMessage && <div className="contrib-ok">{inviteMessage}</div>}
            </div>

            {/* ── En-tête sessions ── */}
            <div className="contrib-list-header">
              <div className="contrib-list-heading">
                <h2>{t('Propositions à relire')}</h2>
                <p>{t('Acceptez ou refusez chaque modification, puis appliquez vos choix.')}</p>
              </div>
              <div className="contrib-list-header-actions">
                <span className="contrib-count">{sessions.length || 0}</span>
                <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={onRefresh} disabled={loading}><RefreshCw size={14} strokeWidth={2} />{t('Actualiser')}</button>
              </div>
            </div>

            {errorMessage && <div className="contrib-error">{errorMessage}</div>}

            {loading ? (
              <div className="contrib-empty">{t('Chargement…')}</div>
            ) : sessions.length === 0 ? (
              <div className="contrib-empty">{t("Rien à relire pour l'instant. Les propositions de la famille apparaîtront ici.")}</div>
            ) : (
              <div className="contrib-list">
                {sessions.map((session) => {
                  const summary = getSessionSummary(session.id, session.changes)
                  const isReviewing = reviewingSessionId === session.id
                  const hasDecisions = summary.approved + summary.rejected > 0
                  const isCollapsed = collapsedSessions.has(session.id)

                  return (
                    <div key={session.id} className="contrib-item contrib-item-stack">

                      {/* ── En-tête de session (cliquable pour collapse) ── */}
                      <div
                        className="contrib-item-main contrib-item-main--clickable"
                        onClick={() => toggleCollapse(session.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && toggleCollapse(session.id)}
                      >
                        <div className="contrib-item-top">
                          <strong className="contrib-session-title">{session.title || t('Proposition sans titre')}</strong>
                          <div className="contrib-session-top-right">
                            {formatSessionDate(session.createdAt) && (
                              <span className="contrib-session-date">{formatSessionDate(session.createdAt)}</span>
                            )}
                            <ChevronDown
                              size={16}
                              strokeWidth={2}
                              className={`contrib-collapse-icon${isCollapsed ? '' : ' contrib-collapse-icon--up'}`}
                            />
                          </div>
                        </div>
                        <div className="contrib-item-meta">
                          <span className="contrib-meta-pill">{t('par {name}', { name: session.submittedByLabel || t('Contributeur') })}</span>
                          <span className="contrib-meta-sep">·</span>
                          <span className="contrib-meta-pill">{summary.total > 1 ? t('{n} modifications', { n: summary.total }) : t('{n} modification', { n: summary.total })}</span>
                          {hasDecisions && (
                            <>
                              <span className="contrib-meta-sep">·</span>
                              {summary.approved > 0 && <span className="contrib-decision-summary contrib-decision-summary--ok">{summary.approved > 1 ? t('{n} acceptées', { n: summary.approved }) : t('{n} acceptée', { n: summary.approved })}</span>}
                              {summary.rejected > 0 && <span className="contrib-decision-summary contrib-decision-summary--ko">{summary.rejected > 1 ? t('{n} refusées', { n: summary.rejected }) : t('{n} refusée', { n: summary.rejected })}</span>}
                              {summary.pending > 0 && <span className="contrib-decision-summary contrib-decision-summary--pending">{t('{n} en attente', { n: summary.pending })}</span>}
                            </>
                          )}
                          {summary.pending === 0 && summary.total > 0 && (
                            <span className="contrib-all-decided-badge">{t('Tout est relu')}</span>
                          )}
                        </div>
                        {session.comment && (
                          <p className="contrib-session-comment">{t('« {text} »', { text: session.comment })}</p>
                        )}
                      </div>

                      {/* ── Cartes de changement (collapsibles) ── */}
                      {!isCollapsed && (() => {
                        // Grouper les changements par entityType
                        const groupOrder = ['media', 'person', 'union', 'parent_child_link', 'annotation']
                        const groupLabels = { media: t('Souvenirs'), person: t('Personnes'), union: t('Unions'), parent_child_link: t('Liens'), annotation: t('Annotations') }
                        const groupMap = {}
                        for (const ch of (session.changes || [])) {
                          const key = ch.entityType || 'other'
                          if (!groupMap[key]) groupMap[key] = []
                          groupMap[key].push(ch)
                        }
                        const orderedKeys = [
                          ...groupOrder.filter((k) => groupMap[k]),
                          ...Object.keys(groupMap).filter((k) => !groupOrder.includes(k)),
                        ]
                        const hasMultipleGroups = orderedKeys.length > 1

                        const renderChangeCard = (change) => {
                          const decision = getChangeDecision(session.id, change.id)
                          const isApproved = decision === 'approved'
                          const isRejected = decision === 'rejected'
                          const personName = getPersonDisplayName(change, session.changes || [])
                          const fields = getFieldRows(change)
                          const annPreview = change.entityType === 'annotation' ? getAnnotationPreview(change, treeId) : null
                          const mediaPreview = change.entityType === 'media' ? getMediaPreview(change, treeId) : null

                          return (
                            <div
                              key={change.id}
                              className={`contrib-change-card${isApproved ? ' contrib-change-card--approved' : ''}${isRejected ? ' contrib-change-card--rejected' : ''}`}
                            >
                              <div className="contrib-change-card-head">
                                <span className={`contrib-action-badge contrib-action-badge--${change.action}`}>
                                  {formatAction(change.action)}
                                </span>
                                <span className="contrib-change-entity-name">
                                  {personName || formatEntityType(change.entityType)}
                                </span>
                                {change.conflictState === 'needs_review' && (
                                  <span className="contrib-conflict-badge">{t('À vérifier')}</span>
                                )}
                                <div className="contrib-card-decisions">
                                  <button
                                    type="button"
                                    className={`contrib-decision-icon contrib-decision-icon--approve${isApproved ? ' active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); toggleChangeDecision(session.id, change.id, 'approved') }}
                                    disabled={isReviewing}
                                    title={t('Accepter')} aria-label={t('Accepter')}
                                  >
                                    <Check size={13} strokeWidth={2.5} />
                                  </button>
                                  <button
                                    type="button"
                                    className={`contrib-decision-icon contrib-decision-icon--reject${isRejected ? ' active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); toggleChangeDecision(session.id, change.id, 'rejected') }}
                                    disabled={isReviewing}
                                    title={t('Refuser')} aria-label={t('Refuser')}
                                  >
                                    <X size={13} strokeWidth={2.5} />
                                  </button>
                                </div>
                              </div>

                              {annPreview && (
                                <div className="contrib-annotation-preview">
                                  {annPreview.type === 'sticker' && <span className="contrib-ann-emoji">{annPreview.emoji}</span>}
                                  {annPreview.type === 'text' && <span className="contrib-ann-text">{t('« {text} »', { text: (annPreview.text || '').slice(0, 120) })}</span>}
                                  {annPreview.type === 'drawing' && (
                                    <span className="contrib-ann-drawing" style={{ borderLeftColor: annPreview.color }}>{t('Dessin libre')}</span>
                                  )}
                                  {annPreview.type === 'photo' && annPreview.url && (
                                    <img src={annPreview.url} className="contrib-ann-photo" alt={t('Photo canvas')} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                                  )}
                                  {annPreview.type === 'photo' && !annPreview.url && (
                                    <span className="contrib-ann-text">{t('Photo (aperçu indisponible)')}</span>
                                  )}
                                </div>
                              )}

                              {mediaPreview && (
                                <div className="contrib-media-preview">
                                  {mediaPreview.type === 'photo' && mediaPreview.url && (
                                    <a href={mediaPreview.url} target="_blank" rel="noreferrer" className="contrib-media-photo">
                                      <img src={mediaPreview.url} alt={mediaPreview.caption || t('Photo proposée')} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                                    </a>
                                  )}
                                  {mediaPreview.type !== 'photo' && mediaPreview.type !== 'citation' && mediaPreview.url && (
                                    <a href={mediaPreview.url} target="_blank" rel="noreferrer" className="pz-link">{t('Ouvrir le fichier')}</a>
                                  )}
                                  {mediaPreview.caption && (
                                    <p className="contrib-media-caption">{mediaPreview.type === 'citation' ? t('« {text} »', { text: mediaPreview.caption }) : mediaPreview.caption}</p>
                                  )}
                                </div>
                              )}

                              {fields.length > 0 && (
                                <div className="contrib-change-fields">
                                  {fields.map(({ key, label, oldVal, newVal }) => (
                                    <div key={key} className="contrib-field-row">
                                      <span className="contrib-field-label">{label}</span>
                                      {oldVal !== undefined ? (
                                        <span className="contrib-field-diff">
                                          <span className="contrib-field-old">{displayVal(oldVal) ?? t('vide')}</span>
                                          <span className="contrib-field-arrow">→</span>
                                          <span className="contrib-field-new">{displayVal(newVal) ?? t('vide')}</span>
                                        </span>
                                      ) : (
                                        <span className="contrib-field-new">{displayVal(newVal) ?? t('vide')}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        }

                        return (
                          <>
                            <div className="contrib-change-list">
                              {orderedKeys.map((groupKey) => (
                                <div key={groupKey} className="contrib-change-group">
                                  {hasMultipleGroups && (
                                    <div className="contrib-group-header">{groupLabels[groupKey] || groupKey}</div>
                                  )}
                                  {groupMap[groupKey].map(renderChangeCard)}
                                </div>
                              ))}
                            </div>

                            {/* ── Actions de session ── */}
                            <div className="contrib-session-footer">
                              {hasDecisions ? (
                                <>
                                  <button
                                    type="button"
                                    className="contrib-apply-btn"
                                    onClick={() => applyDecisions(session.id, session.changes)}
                                    disabled={isReviewing}
                                  >
                                    <PzBusy busy={isReviewing} busyLabel={t('Application en cours')}>{summary.pending > 1
                                      ? t('Appliquer mes choix, {n} sans réponse seront refusées', { n: summary.pending })
                                      : summary.pending === 1
                                        ? t('Appliquer mes choix, {n} sans réponse sera refusée', { n: summary.pending })
                                        : t('Appliquer mes choix')}</PzBusy>
                                  </button>
                                  <div className="contrib-session-quick">
                                    {confirmApproveAll === session.id ? (
                                      <div className="contrib-confirm-approve">
                                        <span>{t('Tout accepter ?')}</span>
                                        <button type="button" className="contrib-confirm-yes" onClick={() => { setConfirmApproveAll(null); onReviewSession(session.id, { decision: 'approved' }) }} disabled={isReviewing}>{t('Oui')}</button>
                                        <button type="button" className="contrib-confirm-no" onClick={() => setConfirmApproveAll(null)}>{t('Non')}</button>
                                      </div>
                                    ) : (
                                      <button type="button" className="contrib-quick-btn" onClick={() => setConfirmApproveAll(session.id)} disabled={isReviewing}>{t('Tout accepter')}</button>
                                    )}
                                    <button type="button" className="contrib-quick-btn" onClick={() => onReviewSession(session.id, { decision: 'rejected' })} disabled={isReviewing}>{t('Tout refuser')}</button>
                                  </div>
                                </>
                              ) : (
                                <div className="contrib-session-quick contrib-session-quick--full">
                                  {confirmApproveAll === session.id ? (
                                    <div className="contrib-confirm-approve">
                                      <span>{t('Accepter toutes les modifications de cette proposition ?')}</span>
                                      <button type="button" className="contrib-confirm-yes" onClick={() => { setConfirmApproveAll(null); onReviewSession(session.id, { decision: 'approved' }) }} disabled={isReviewing}>{t('Oui, tout accepter')}</button>
                                      <button type="button" className="contrib-confirm-no" onClick={() => setConfirmApproveAll(null)}>{t('Annuler')}</button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      className="contrib-apply-btn contrib-apply-btn--approve"
                                      onClick={() => setConfirmApproveAll(session.id)}
                                      disabled={isReviewing}
                                    >
                                      <PzBusy busy={isReviewing} busyLabel={t('Application en cours')}>{t('Tout accepter')}</PzBusy>
                                    </button>
                                  )}
                                  <button type="button" className="contrib-quick-btn" onClick={() => onReviewSession(session.id, { decision: 'rejected' })} disabled={isReviewing}>{t('Tout refuser')}</button>
                                </div>
                              )}
                            </div>
                          </>
                        )
                      })()}

                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="contrib-readonly">
            {t("Ce panneau est réservé à l'administration de l'arbre.")}
          </div>
        )}
      </div>
    </div>
  )
}

export default ContributionPanel
