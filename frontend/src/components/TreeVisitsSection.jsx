import { useEffect, useState } from 'react'
import { listTreeVisits } from '../api/treeApi'
import { dateLocale, t } from '../i18n/index.js'
import Skeleton from './Skeleton.jsx'

// Onglet Visites des paramètres de l'arbre : qui est venu, combien de fois.
// Le journal est tenu par le serveur à chaque ouverture de l'arbre (backend/src/lib/tree-visits.ts).

const DEVICE_LABEL = { phone: t('téléphone'), tablet: t('tablette'), desktop: t('ordinateur') }
const ACCESS_LABEL = { share: t('avec le lien'), member: t('membre'), shared_account: t('avec son compte') }

function visitorLabel(visit) {
  if (visit.isYou) return t('Vous')
  if (visit.name) return visit.name
  if (visit.email) return visit.email.split('@')[0]
  return t('Un visiteur')
}

function whenLabel(value) {
  const date = new Date(value)
  const time = date.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000)
  if (days === 0) return t("aujourd'hui à {time}", { time })
  if (days === 1) return t('hier à {time}', { time })
  return t('{date} à {time}', { date: date.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' }), time })
}

const TreeVisitsSection = ({ treeId, authToken }) => {
  const [state, setState] = useState({ loading: true, error: '', data: null })

  useEffect(() => {
    let active = true
    setState({ loading: true, error: '', data: null })
    listTreeVisits(treeId, authToken)
      .then((data) => { if (active) setState({ loading: false, error: '', data }) })
      .catch(() => { if (active) setState({ loading: false, error: t('Impossible de charger les visites.'), data: null }) })
    return () => { active = false }
  }, [treeId, authToken])

  if (state.loading) return <Skeleton variant="rows" count={4} />
  if (state.error) return <div className="pz-error" role="alert">{state.error}</div>

  const { summary, recent } = state.data
  return (
    <div className="ts-panel tv">
      <div className="tv-stats">
        {[[t('7 derniers jours'), summary.last7], [t('30 derniers jours'), summary.last30]].map(([label, s]) => (
          <div key={label} className="tv-stat">
            <p className="pz-eyebrow">{label}</p>
            <p className="tv-stat-value">{s.visits > 1 ? t('{n} visites', { n: s.visits }) : t('{n} visite', { n: s.visits })}</p>
            <p className="pz-small">{s.visitors > 1 ? t('{n} personnes', { n: s.visitors }) : t('{n} personne', { n: s.visitors })}</p>
          </div>
        ))}
      </div>
      <p className="pz-hint">{t("Vos propres visites ne sont pas comptées. Le prénom apparaît quand le visiteur l'a donné en ouvrant l'arbre.")}</p>

      <div className="tv-list">
        <p className="pz-eyebrow">{t('Dernières visites')}</p>
        {recent.length === 0 ? (
          <p className="pz-small">{t("Aucune visite pour l'instant. Le journal a commencé le 25 septembre 2026.")}</p>
        ) : (
          <ul>
            {recent.map((visit) => (
              <li key={visit.id} className={`tv-row ${visit.isYou ? 'is-you' : ''}`}>
                <span className="tv-name">{visitorLabel(visit)}</span>
                <span className="tv-meta pz-small">
                  {whenLabel(visit.createdAt)} · {DEVICE_LABEL[visit.device] || visit.device} · {ACCESS_LABEL[visit.accessKind] || visit.accessKind}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default TreeVisitsSection
