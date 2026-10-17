import { useState } from 'react'
import { Plus } from 'lucide-react'
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

export default function LifeTimeline({ person, family, life, loading = false, failed = false, medias = [], canEdit = false, onAdd, onEdit }) {
  const entries = buildLifeTimeline(person, family, life)
  const mediaById = new Map(medias.map((m) => [String(m.id), m]))
  const addButton = canEdit && (
    <button type="button" className="pz-btn pz-btn--soft pz-btn--block lt-add" onClick={onAdd}>
      <Plus size={16} strokeWidth={2} />
      {t('Ajouter un moment')}
    </button>
  )

  if (entries.length === 0) {
    return (
      <div className="pc-empty">
        <p className="pz-sub">{t('Pas encore de date connue pour {name}.', { name: person.firstName })}</p>
        <p className="pz-small">{t('Les dates de naissance, d’union et de décès, et celles de sa famille, apparaîtront ici.')}</p>
        {addButton}
      </div>
    )
  }

  return (
    <div className="lt" aria-busy={loading || undefined}>
      <ol className="lt-rail">
        {entries.map((entry) => (
          <li key={entry.key} className={`lt-ev lt-ev--${entry.kind}`}>
            <span className="lt-year">{entry.year ?? ''}</span>
            <div className="lt-body">
              {canEdit && entry.event ? (
                <button type="button" className="lt-title lt-title--edit" onClick={() => onEdit?.(entry.event)} aria-label={t('Modifier « {title} »', { title: entry.title })}>
                  {entry.title}
                </button>
              ) : (
                <div className="lt-title">{entry.title}</div>
              )}
              {entry.meta && <div className="lt-meta">{entry.meta}</div>}
              {entry.note && <p className="lt-note">{entry.note}</p>}
              {entry.sources && <Sources text={entry.sources} />}
              {entry.mediaId && mediaById.get(String(entry.mediaId))?.url && (
                <img className="lt-photo" src={mediaById.get(String(entry.mediaId)).url} alt={entry.title} loading="lazy" />
              )}
            </div>
          </li>
        ))}
      </ol>
      {failed && <p className="pz-small lt-failed">{t('Les autres événements n’ont pas pu être chargés.')}</p>}
      {addButton}
    </div>
  )
}
