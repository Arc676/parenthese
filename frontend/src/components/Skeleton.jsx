import { useEffect, useState } from 'react'
import { t } from '../i18n/index.js'
import './Skeleton.css'

// Blocs gris à la forme de ce qui arrive, à la place d'un « Chargement… ». Rien avant SHOW_AFTER : une réponse
// rapide ne fait pas clignoter l'écran. Aucun mouvement (pas de reflet qui passe), juste la place réservée.
const SHOW_AFTER = 300

// variant : rows (avatar et deux lignes : personnes, visites, propositions), timeline (frise de l'onglet Vie),
// lines (paragraphes)
export default function Skeleton({ variant = 'rows', count = 3, label = '' }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className={`pz-skel pz-skel--${variant}`} role="status" aria-busy="true">
      <span className="pz-sr">{label || t('Chargement…')}</span>
      {shown && Array.from({ length: count }, (_, i) => (
        <div key={i} className="pz-skel-row" aria-hidden="true">
          {variant === 'rows' && <span className="pz-skel-dot" />}
          {variant === 'timeline' && <span className="pz-skel-bar pz-skel-year" />}
          {variant === 'timeline' && <span className="pz-skel-dot" />}
          <span className="pz-skel-text">
            <span className="pz-skel-bar" style={{ width: `${[62, 48, 70, 55][i % 4]}%` }} />
            {variant !== 'lines' && <span className="pz-skel-bar pz-skel-bar--thin" style={{ width: `${[38, 30, 44, 34][i % 4]}%` }} />}
          </span>
        </div>
      ))}
    </div>
  )
}
