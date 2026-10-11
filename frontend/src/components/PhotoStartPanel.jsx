import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FolderOpen, ImagePlus, X } from 'lucide-react'
import './PhotoStartPanel.css'
import PzBusy from './PzBusy.jsx'
import { t } from '../i18n/index.js'
import { matchPhotoFiles } from '../utils/photoImport.js'

function withEmphasis(text) {
  const [before, emphasized = '', after = ''] = text.split(/<\/?em>/)
  return <>{before}<em>{emphasized}</em>{after}</>
}

function lifeYears(person) {
  if (!person.birthYear) return ''
  return person.deathYear ? `${person.birthYear} – ${person.deathYear}` : String(person.birthYear)
}

// Singulier ou pluriel, les deux formes passent par t()
function plural(n, one, many, vars = {}) {
  return n === 1 ? t(one, vars) : t(many, { n, ...vars })
}

function initialsOf(person) {
  return `${person.firstName?.[0] || ''}${person.lastName?.[0] || ''}`.toUpperCase() || '?'
}

// Dossier où le logiciel d'origine rangeait la première photo citée, pour aider à le retrouver
function folderOf(filePath) {
  const parts = String(filePath || '').split(/([\\/])/)
  if (parts.length < 3) return ''
  return parts.slice(0, -2).join('')
}

// Après un import GEDCOM (ou depuis les paramètres) : retrouver les photos que le logiciel connaissait,
// et demander les premiers visages un par un.
export default function PhotoStartPanel({
  visible,
  personsImported = null,
  photoRefs = [],
  faces = [],
  onUploadOne,
  onBulkPlace,
  onRefsChange,
  onClose,
}) {
  const folderInputRef = useRef(null)
  const faceInputRef = useRef(null)
  const faceTargetRef = useRef(null)
  const [remaining, setRemaining] = useState(photoRefs)
  const [found, setFound] = useState(null)
  const [bulk, setBulk] = useState({ running: false, done: 0, total: 0, placed: null, failed: 0 })
  const [faceState, setFaceState] = useState({})
  const [shownFaces, setShownFaces] = useState(faces)
  const [placedTotal, setPlacedTotal] = useState(0)

  // La liste des visages et les chemins sont figés à l'ouverture : une ligne ne disparaît pas sous le doigt
  useEffect(() => {
    if (!visible) return
    setRemaining(photoRefs)
    setFound(null)
    setBulk({ running: false, done: 0, total: 0, placed: null, failed: 0 })
    setFaceState({})
    setShownFaces(faces)
    setPlacedTotal(0)
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible) return undefined
    const onKey = (e) => { if (e.key === 'Escape' && !bulk.running) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, onClose, bulk.running])

  // Les aperçus locaux sont libérés quand la fenêtre se ferme
  const previewsRef = useRef([])
  useEffect(() => {
    if (visible) return undefined
    previewsRef.current.forEach((url) => URL.revokeObjectURL(url))
    previewsRef.current = []
    return undefined
  }, [visible])

  const exampleFolder = useMemo(() => folderOf(remaining[0]?.file), [remaining])

  if (!visible) return null

  const handleFolder = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    setBulk((b) => ({ ...b, placed: null, failed: 0 }))
    setFound(matchPhotoFiles(remaining, files))
  }

  const handlePlace = async () => {
    if (!found?.matches.length || bulk.running) return
    const total = found.matches.length
    setBulk({ running: true, done: 0, total, placed: null, failed: 0 })
    const result = await onBulkPlace(found.matches, (done) => setBulk((b) => ({ ...b, done })))
    const placedIds = new Set(result.placedIds)
    // Une personne de la liste des visages dont la photo vient d'être placée passe en « Ajoutée »
    const shownIds = new Set(shownFaces.map((p) => String(p.id)))
    const placedFaces = {}
    for (const match of found.matches) {
      if (!placedIds.has(match.personId) || !shownIds.has(String(match.personId))) continue
      const preview = URL.createObjectURL(match.file)
      previewsRef.current.push(preview)
      placedFaces[match.personId] = { busy: false, error: '', preview, fromFolder: true }
    }
    setFaceState((s) => ({ ...s, ...placedFaces }))
    const nextRemaining = remaining.filter((ref) => !placedIds.has(ref.personId))
    setRemaining(nextRemaining)
    onRefsChange?.(nextRemaining)
    setFound(null)
    setPlacedTotal((n) => n + placedIds.size)
    setBulk({ running: false, done: total, total, placed: placedIds.size, failed: total - placedIds.size })
  }

  const pickFace = (personId) => {
    faceTargetRef.current = personId
    faceInputRef.current?.click()
  }

  const handleFaceFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    const personId = faceTargetRef.current
    if (!file || !personId) return
    setFaceState((s) => ({ ...s, [personId]: { ...s[personId], busy: true, error: '' } }))
    const error = await onUploadOne(personId, file)
    setFaceState((s) => {
      const previous = s[personId]
      if (error) return { ...s, [personId]: { ...previous, busy: false, error } }
      const preview = URL.createObjectURL(file)
      previewsRef.current.push(preview)
      return { ...s, [personId]: { busy: false, error: '', preview } }
    })
  }

  const refsKnown = photoRefs.length > 0
  const addedCount = Object.values(faceState).filter((s) => s?.preview && !s.fromFolder).length + placedTotal

  return (
    <div className="pz-overlay psp-overlay">
      <div className="pz-modal psp" role="dialog" aria-modal="true" aria-labelledby="pspTitle">
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pz-modal-close" onClick={onClose} disabled={bulk.running} aria-label={t('Fermer')}>
          <X size={18} strokeWidth={2} />
        </button>
        <div className="pz-modal-head">
          {personsImported != null && <p className="pz-eyebrow">{t('Import terminé')}</p>}
          <h2 id="pspTitle" className="pz-title">{withEmphasis(t('Il manque les <em>visages</em>'))}</h2>
          <p className="pz-sub">
            {personsImported != null
              ? t('{n} personnes sont dans votre arbre. Avec une photo, la famille se reconnaît tout de suite.', { n: personsImported.toLocaleString() })
              : t('Avec une photo, la famille se reconnaît tout de suite.')}
          </p>
        </div>

        {refsKnown && (
          <section className="psp-block psp-block--folder" aria-labelledby="pspFolderTitle">
            <h3 id="pspFolderTitle" className="psp-h">{t('Vos photos sont déjà sur votre ordinateur')}</h3>
            {remaining.length > 0 ? (
              <>
                <p className="psp-p">
                  {plural(remaining.length, 'Votre logiciel associait une photo à 1 personne. Choisissez le dossier où il la range, Parenthèse place le portrait.', 'Votre logiciel associait une photo à {n} personnes. Choisissez le dossier où il les range, Parenthèse place chaque portrait.')}
                </p>
                {exampleFolder && (
                  <p className="pz-hint">{t('Il les rangeait dans {folder}', { folder: exampleFolder })}</p>
                )}
              </>
            ) : (
              <p className="psp-p">{t('Toutes les photos de votre logiciel sont placées.')}</p>
            )}

            <input
              ref={folderInputRef}
              type="file"
              className="pz-sr"
              tabIndex={-1}
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolder}
            />

            {bulk.running ? (
              <div className="psp-progress" role="status">
                <div className="psp-bar"><span style={{ width: `${Math.round((bulk.done / Math.max(1, bulk.total)) * 100)}%` }} /></div>
                <p className="pz-small">{t('Envoi de {done} sur {total}', { done: bulk.done, total: bulk.total })}</p>
              </div>
            ) : found ? (
              <div className="psp-found">
                {found.matches.length > 0 ? (
                  <>
                    <p className="psp-p"><strong>{plural(found.matches.length, '1 photo retrouvée sur {k}.', '{n} photos retrouvées sur {k}.', { k: remaining.length })}</strong></p>
                    <div className="psp-row-actions">
                      <button type="button" className="pz-btn pz-btn--accent" onClick={handlePlace}>
                        {plural(found.matches.length, 'Placer ce portrait', 'Placer les {n} portraits')}
                      </button>
                      <button type="button" className="pz-btn pz-btn--ghost" onClick={() => folderInputRef.current?.click()}>
                        {t('Un autre dossier')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="pz-error">{t("Aucune photo de ce dossier ne correspond. Essayez le dossier indiqué plus haut, ou celui qui le contient.")}</p>
                    <button type="button" className="pz-btn pz-btn--secondary" onClick={() => folderInputRef.current?.click()}>
                      <FolderOpen size={18} strokeWidth={2} aria-hidden="true" />
                      {t('Choisir un autre dossier')}
                    </button>
                  </>
                )}
              </div>
            ) : remaining.length > 0 ? (
              <button type="button" className="pz-btn pz-btn--accent psp-folder-btn" onClick={() => folderInputRef.current?.click()}>
                <FolderOpen size={18} strokeWidth={2} aria-hidden="true" />
                {bulk.placed != null ? t('Choisir un autre dossier') : t('Choisir le dossier des photos')}
              </button>
            ) : null}

            {bulk.placed != null && !bulk.running && (
              <p className="pz-success" role="status">
                {plural(bulk.placed, '1 portrait placé.', '{n} portraits placés.')}
                {bulk.failed > 0 && ` ${t("{f} n'ont pas pu être envoyés (format non pris en charge ou fichier trop lourd).", { f: bulk.failed })}`}
              </p>
            )}
            {!bulk.running && remaining.length > 0 && (
              <p className="pz-hint">{t('Seules les photos qui correspondent à une personne sont envoyées, vers votre arbre uniquement.')}</p>
            )}
          </section>
        )}

        {shownFaces.length > 0 && (
          <section className="psp-block" aria-labelledby="pspFacesTitle">
            <h3 id="pspFacesTitle" className="psp-h">{refsKnown ? t('Ou commencez par ces visages') : t('Commencez par ces visages')}</h3>
            <input ref={faceInputRef} type="file" accept="image/*" className="pz-sr" tabIndex={-1} onChange={handleFaceFile} />
            <ul className="psp-faces">
              {shownFaces.map((person) => {
                const state = faceState[person.id] || {}
                const years = lifeYears(person)
                return (
                  <li key={person.id} className="psp-face">
                    <span className={`psp-face-photo ${state.preview ? 'is-set' : ''}`} aria-hidden="true">
                      {state.preview ? <img src={state.preview} alt="" /> : initialsOf(person)}
                    </span>
                    <span className="psp-face-id">
                      <span className="psp-face-name">{`${person.firstName} ${person.lastName || ''}`.trim()}</span>
                      {years && <span className="psp-face-years">{years}</span>}
                      {state.error && <span className="psp-face-error">{state.error}</span>}
                    </span>
                    {state.preview && !state.busy ? (
                      <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm psp-face-done" onClick={() => pickFace(person.id)}>
                        <Check size={16} strokeWidth={2.2} aria-hidden="true" />
                        {t('Ajoutée')}
                      </button>
                    ) : (
                      <button type="button" className="pz-btn pz-btn--soft pz-btn--sm" onClick={() => pickFace(person.id)} disabled={state.busy || bulk.running}>
                        <PzBusy busy={Boolean(state.busy)} busyLabel={t('Envoi')}>
                          <ImagePlus size={16} strokeWidth={2} aria-hidden="true" />
                          {t('Ajouter une photo')}
                        </PzBusy>
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <div className="pz-modal-actions pz-modal-actions--split">
          <p className="pz-small">
            {addedCount > 0 ? plural(addedCount, '1 photo ajoutée.', '{n} photos ajoutées.') : t('Vous pourrez en ajouter plus tard depuis chaque fiche.')}
          </p>
          <button type="button" className="pz-btn pz-btn--primary" onClick={onClose} disabled={bulk.running}>
            {t("Voir l'arbre")}
          </button>
        </div>
      </div>
    </div>
  )
}
