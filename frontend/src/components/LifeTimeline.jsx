import { useState } from 'react'
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

export default function LifeTimeline({ person, family, life, loading = false, failed = false }) {
  const entries = buildLifeTimeline(person, family, life)

  if (entries.length === 0) {
    return (
      <div className="pc-empty">
        <p className="pz-sub">{t('Pas encore de date connue pour {name}.', { name: person.firstName })}</p>
        <p className="pz-small">{t('Les dates de naissance, d’union et de décès, et celles de sa famille, apparaîtront ici.')}</p>
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
              <div className="lt-title">{entry.title}</div>
              {entry.meta && <div className="lt-meta">{entry.meta}</div>}
              {entry.note && <p className="lt-note">{entry.note}</p>}
              {entry.sources && <Sources text={entry.sources} />}
            </div>
          </li>
        ))}
      </ol>
      {failed && <p className="pz-small lt-failed">{t('Les autres événements n’ont pas pu être chargés.')}</p>}
    </div>
  )
}
