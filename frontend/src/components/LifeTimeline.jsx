import { useState } from 'react'
import { Plus, Play, FileText, Mic, Paperclip } from 'lucide-react'
import { t } from '../i18n/index.js'
import { buildLifeTimeline } from '../utils/lifeTimeline.js'
import './LifeTimeline.css'

// Onglet Vie de la fiche : naissance, unions et décès en grands repères, les autres événements
// plus petits entre eux, la famille proche en retrait. Les sources restent repliées.
function Sources({ text }) {
  const [open, setOpen] = useState(false)
  const list = text.split('\n').map((s) => s.trim()).filter(Boolean)
  if (list.length === 0) return null
  return (
    <div className="lt-sources">
      <button type="button" className="lt-src" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {list.length === 1 ? t('1 source') : t('{n} sources', { n: list.length })}
      </button>
      {open && (
        <ul className="lt-src-list">
          {list.map((source) => <li key={source}>{source}</li>)}
        </ul>
      )}
    </div>
  )
}

const FILE_LABELS = { video: t('Vidéo'), audio: t('Enregistrement'), document: t('Document') }

// Souvenirs rattachés au moment : les photos en vignettes, le reste (vidéo, acte, voix) en pastilles
function Attachments({ medias, onOpen }) {
  if (medias.length === 0) return null
  const photos = medias.filter((m) => m.type === 'photo' && m.url)
  const others = medias.filter((m) => !(m.type === 'photo' && m.url))
  return (
    <div className="lt-attach">
      {photos.length > 0 && (
        <div className="lt-photos">
          {photos.map((media) => (
            <button key={media.id} type="button" className="lt-photo" onClick={() => onOpen?.(media)} aria-label={t('Voir « {title} »', { title: media.label })}>
              <img src={media.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {others.map((media) => {
        const Icon = media.type === 'video' ? Play : media.type === 'audio' ? Mic : media.type === 'document' ? FileText : Paperclip
        return (
          <button key={media.id} type="button" className="lt-file" onClick={() => onOpen?.(media)}>
            <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className="lt-file-label">{media.label || FILE_LABELS[media.type] || t('Souvenir')}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function LifeTimeline({
  person, family, life, loading = false, failed = false, medias = [],
  canAdd = false, canEdit = false, notice = '', onAdd, onEdit, onOpenMedia,
}) {
  const entries = buildLifeTimeline(person, family, life)
  const mediaById = new Map(medias.map((m) => [String(m.id), m]))
  const addButton = canAdd && (
    <button type="button" className="pz-btn pz-btn--soft pz-btn--block lt-add" onClick={onAdd}>
      <Plus size={16} strokeWidth={2} />
      {t('Ajouter un moment')}
    </button>
  )
  const noticeLine = notice && <p className="pz-success lt-notice" role="status">{notice}</p>

  if (entries.length === 0) {
    return (
      <div className="pc-empty">
        <p className="pz-sub">{t('Pas encore de date connue pour {name}.', { name: person.firstName })}</p>
        <p className="pz-small">{t('Les dates de naissance, d’union et de décès, et celles de sa famille, apparaîtront ici.')}</p>
        {noticeLine}
        {addButton}
      </div>
    )
  }

  return (
    <div className="lt" aria-busy={loading || undefined}>
      {noticeLine}
      <ol className="lt-rail">
        {entries.map((entry) => {
          const editable = canEdit && (entry.event || entry.milestone)
          const attached = (entry.mediaIds || []).map((id) => mediaById.get(String(id))).filter(Boolean)
          return (
            <li key={entry.key} className={`lt-ev lt-ev--${entry.kind}`}>
              <span className="lt-year">{entry.year ?? ''}</span>
              <div className="lt-body">
                {editable ? (
                  <button type="button" className="lt-title lt-title--edit" onClick={() => onEdit?.(entry)} aria-label={t('Modifier « {title} »', { title: entry.title })}>
                    {entry.title}
                  </button>
                ) : (
                  <div className="lt-title">{entry.title}</div>
                )}
                {entry.meta && <div className="lt-meta">{entry.meta}</div>}
                {entry.note && <p className="lt-note">{entry.note}</p>}
                {entry.sources && <Sources text={entry.sources} />}
                <Attachments medias={attached} onOpen={onOpenMedia} />
              </div>
            </li>
          )
        })}
      </ol>
      {failed && <p className="pz-small lt-failed">{t('Les autres événements n’ont pas pu être chargés.')}</p>}
      {addButton}
    </div>
  )
}
