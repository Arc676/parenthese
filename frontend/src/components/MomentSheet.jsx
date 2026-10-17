import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ImagePlus } from 'lucide-react'
import { t } from '../i18n/index.js'
import { createLifeEvent, updateLifeEvent, deleteLifeEvent } from '../api/treeApi.js'
import { DESCRIBED_TYPES, eventTitle } from '../utils/lifeTimeline.js'
import './MomentSheet.css'

// Fiche « Ajouter un moment » de l'onglet Vie : quoi, quand, où, une photo. La date exacte, la fin,
// la source et la note restent dans « Plus de détails ». Sert aussi à modifier un moment existant.

// Suggestions touchables : le texte exact devient le type correspondant (exporté en GEDCOM sous sa balise)
const SUGGESTIONS = [
  { label: t('Baptême'), type: 'baptism' },
  { label: t('Déménagement'), type: 'residence' },
  { label: t('Diplôme'), type: 'graduation' },
  { label: t('Service militaire'), type: 'military' },
  { label: t('Retraite'), type: 'retirement' },
]

const yearOf = (value) => String(value ?? '').match(/^(\d{4})/)?.[1] || ''
const exactDay = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) && !String(value).endsWith('-01-01') ? value : '')

export default function MomentSheet({ person, event = null, treeId, token, medias = [], onUploadPhoto, onClose, onSaved }) {
  const editing = Boolean(event)
  const [what, setWhat] = useState(() => (event ? eventTitle(event) : ''))
  const [year, setYear] = useState(() => yearOf(event?.date))
  const [approx, setApprox] = useState(() => ['about', 'estimated', 'calculated', 'between'].includes(event?.datePrecision))
  const [place, setPlace] = useState(event?.place || '')
  const [day, setDay] = useState(() => exactDay(event?.date))
  const [endYear, setEndYear] = useState(() => yearOf(event?.dateEnd))
  const [sources, setSources] = useState(event?.sources || '')
  const [notes, setNotes] = useState(event?.notes || '')
  const [mediaId, setMediaId] = useState(event?.mediaId || null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const whatRef = useRef(null)
  const fileRef = useRef(null)
  const hasDetails = Boolean(day || endYear || sources || notes)

  useEffect(() => { whatRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  useEffect(() => {
    if (!file) { setPreview(''); return undefined }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const linkedMedia = mediaId ? medias.find((m) => String(m.id) === String(mediaId)) : null
  const yearValid = !year || /^\d{4}$/.test(year)
  const endValid = !endYear || (/^\d{4}$/.test(endYear) && (!year || Number(endYear) >= Number(year)))
  const canSave = what.trim().length > 0 && yearValid && endValid && !busy

  const buildPayload = (photoId) => {
    const text = what.trim()
    const suggestion = SUGGESTIONS.find((s) => s.label.toLowerCase() === text.toLowerCase())
    const type = editing ? event.type : (suggestion?.type || 'custom')
    const textField = DESCRIBED_TYPES.includes(type) ? 'description' : 'label'
    // Une suggestion reprise telle quelle n'a pas besoin de libellé : le type suffit
    const textValue = !editing && suggestion ? null : text
    const start = day || year || null
    let datePrecision = null
    if (start && endYear) datePrecision = approx ? 'between' : 'from'
    else if (start && approx && !day) datePrecision = 'about'
    return {
      ...(editing ? {} : { type }),
      [textField]: textValue,
      ...(textField === 'description' ? { label: null } : {}),
      date: start,
      dateEnd: start && endYear ? endYear : null,
      datePrecision,
      place: place.trim() || null,
      sources: sources.trim() || null,
      notes: notes.trim() || null,
      mediaId: photoId,
    }
  }

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setError('')
    try {
      let photoId = mediaId
      if (file && onUploadPhoto) {
        const created = await onUploadPhoto(person.id, file, [what.trim(), year].filter(Boolean).join(', '))
        photoId = created?.id || null
      }
      const payload = buildPayload(photoId)
      if (editing) await updateLifeEvent(treeId, event.id, payload, token)
      else await createLifeEvent(treeId, person.id, payload, token)
      onSaved()
    } catch (err) {
      setError(err?.message && !/^request_failed|^invalid_/.test(err.message) ? err.message : t('L’enregistrement n’a pas abouti. Réessayez dans un instant.'))
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteLifeEvent(treeId, event.id, token)
      onSaved()
    } catch {
      setError(t('La suppression n’a pas abouti. Réessayez dans un instant.'))
      setBusy(false)
    }
  }

  return createPortal(
    <div className="pz-overlay ms-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="pz-modal ms" role="dialog" aria-modal="true" aria-labelledby="ms-title">
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pz-modal-close" onClick={onClose} aria-label={t('Fermer')} disabled={busy}>
          <X size={18} strokeWidth={1.8} />
        </button>
        <div className="pz-modal-head">
          <h2 id="ms-title" className="pz-title ms-title">
            {editing ? t('Modifier ce moment') : t('Ajouter à la vie de {name}', { name: person.firstName })}
          </h2>
        </div>

        <form className="ms-form" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="pz-field">
            <label htmlFor="ms-what">{t('Quoi ?')}</label>
            <input id="ms-what" ref={whatRef} value={what} maxLength={120} onChange={(e) => setWhat(e.target.value)} placeholder={t('Service militaire, premier emploi, départ pour Paris…')} />
            {!editing && (
              <div className="ms-chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s.type} type="button" className={`ms-chip${what === s.label ? ' is-on' : ''}`} onClick={() => setWhat(s.label)}>{s.label}</button>
                ))}
              </div>
            )}
          </div>

          <div className="ms-row">
            <div className="pz-field ms-year">
              <label htmlFor="ms-year">{t('Quand ?')}</label>
              <input id="ms-year" inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} placeholder={t('Année')} aria-invalid={!yearValid || undefined} disabled={Boolean(day)} />
            </div>
            <label className="ms-check">
              <input type="checkbox" checked={approx} onChange={(e) => setApprox(e.target.checked)} disabled={Boolean(day) && !endYear} />
              {t('environ')}
            </label>
          </div>

          <div className="pz-field">
            <label htmlFor="ms-place">{t('Où ?')} <span className="ms-optional">{t('facultatif')}</span></label>
            <input id="ms-place" value={place} maxLength={300} onChange={(e) => setPlace(e.target.value)} placeholder={t('Ville ou adresse')} />
          </div>

          <div className="ms-photo">
            {(preview || linkedMedia?.url) ? (
              <div className="ms-photo-current">
                <img src={preview || linkedMedia.url} alt="" />
                <button type="button" className="pz-btn pz-btn--ghost" onClick={() => { setFile(null); setMediaId(null) }} disabled={busy}>
                  {t('Retirer la photo')}
                </button>
              </div>
            ) : onUploadPhoto && (
              <button type="button" className="ms-photo-add" onClick={() => fileRef.current?.click()} disabled={busy}>
                <ImagePlus size={16} strokeWidth={1.8} />
                {t('Une photo')} <span className="ms-optional">{t('facultatif')}</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = '' }} />
          </div>

          <details className="ms-more" open={hasDetails || undefined}>
            <summary>{t('Plus de détails')}</summary>
            <div className="ms-more-body">
              <div className="ms-row">
                <div className="pz-field">
                  <label htmlFor="ms-day">{t('Date exacte')}</label>
                  <input id="ms-day" type="date" value={day} onChange={(e) => { setDay(e.target.value); if (e.target.value) setYear(e.target.value.slice(0, 4)) }} />
                </div>
                <div className="pz-field ms-year">
                  <label htmlFor="ms-end">{t('Jusqu’en')}</label>
                  <input id="ms-end" inputMode="numeric" maxLength={4} value={endYear} onChange={(e) => setEndYear(e.target.value.replace(/\D/g, ''))} placeholder={t('Année')} aria-invalid={!endValid || undefined} />
                </div>
              </div>
              <div className="pz-field">
                <label htmlFor="ms-sources">{t('Source')}</label>
                <textarea id="ms-sources" rows={2} value={sources} maxLength={4000} onChange={(e) => setSources(e.target.value)} placeholder={t('Registre, acte, archive, témoignage… une par ligne')} />
              </div>
              <div className="pz-field">
                <label htmlFor="ms-notes">{t('Note')}</label>
                <textarea id="ms-notes" rows={2} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </details>

          {error && <p className="pz-error" role="alert">{error}</p>}

          <div className={`pz-modal-actions${editing ? ' pz-modal-actions--split' : ''}`}>
            {editing && (confirmDelete ? (
              <span className="ms-confirm">
                <button type="button" className="pz-btn pz-btn--danger" onClick={remove} disabled={busy}>{t('Supprimer')}</button>
                <button type="button" className="pz-btn pz-btn--ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>{t('Garder')}</button>
              </span>
            ) : (
              <button type="button" className="pz-btn pz-btn--ghost ms-delete" onClick={() => setConfirmDelete(true)} disabled={busy}>{t('Supprimer ce moment')}</button>
            ))}
            <span className="ms-actions-end">
              <button type="button" className="pz-btn pz-btn--ghost" onClick={onClose} disabled={busy}>{t('Annuler')}</button>
              <button type="submit" className="pz-btn pz-btn--primary" disabled={!canSave}>
                {busy ? t('Enregistrement…') : editing ? t('Enregistrer') : t('Ajouter')}
              </button>
            </span>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
