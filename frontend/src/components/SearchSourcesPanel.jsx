import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Search, X } from 'lucide-react'
import './AddPersonPanel.css'
import './SearchSourcesPanel.css'
import PzBusy from './PzBusy.jsx'
import { t, dateLocale } from '../i18n/index.js'
import { fetchSearchSources, searchSource } from '../api/searchSourcesApi.js'
import { SEARCH_LINKS, SEARCH_LINK_REGIONS } from '../data/searchLinks.js'
import { changesFromResult } from '../utils/searchResultChanges.js'
import { fullNameLabel } from '../utils/personName.js'

// Ce que chaque source interrogée couvre et ce qui part vers elle : affiché avant qu'on coche
const SOURCE_INFO = {
  deces: {
    name: t('Décès en France depuis 1970'),
    detail: t("Fichier de l'INSEE, par matchID. Date et lieu de décès, rien avant 1970. Une femme se cherche sous son nom de naissance."),
    sent: t("Envoie le nom, le prénom et l'année de naissance à matchid.io"),
  },
  wikitree: {
    name: 'WikiTree',
    detail: t('Un arbre mondial tenu par ses membres. Profils publics seulement.'),
    sent: t("Envoie le nom, le prénom et l'année de naissance à wikitree.com"),
  },
}

// « 1898 », « 1898-03 » ou « 1898-03-14 » dans la langue de l'interface
function formatDate(value) {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  if (!month) return String(year)
  const date = new Date(Date.UTC(year, month - 1, day || 1))
  const options = day ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' }
  return date.toLocaleDateString(dateLocale, { ...options, timeZone: 'UTC' })
}

function eventLine(event) {
  return [formatDate(event?.date), event?.place].filter(Boolean).join(', ')
}

function personYears(person) {
  const birth = person.birthYear || person.birthDate?.slice(0, 4)
  const death = person.deathYear || person.deathDate?.slice(0, 4)
  return [birth, death].filter(Boolean).join(' – ')
}

// Titre traduit : le passage entre <em> et </em> garde son italique (comme « Ajouter quelqu'un »)
function withEmphasis(text) {
  const [before, emphasized = '', after = ''] = text.split(/<\/?em>/)
  return <>{before}<em>{emphasized}</em>{after}</>
}

const plain = (value) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

function SearchSourcesPanel({ visible, treeId, token, persons = [], canApply = false, onApply, onClose }) {
  const [lastName, setLastName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [place, setPlace] = useState('')
  // Sources allumées sur ce serveur, lues à la première ouverture pour l'arbre affiché (null : pas encore lues)
  const [loadedSources, setLoadedSources] = useState({ treeId: null, list: null })
  const sources = loadedSources.treeId === treeId ? loadedSources.list : null
  const [checked, setChecked] = useState([])
  const [results, setResults] = useState({})
  const [searching, setSearching] = useState(false)
  const [region, setRegion] = useState('fr')
  const [picker, setPicker] = useState(null)
  const [applied, setApplied] = useState({})

  useEffect(() => {
    if (!visible || !treeId || !token || loadedSources.treeId === treeId) return
    let cancelled = false
    fetchSearchSources(treeId, token)
      .then((list) => {
        if (cancelled) return
        const known = list.filter((id) => SOURCE_INFO[id])
        setLoadedSources({ treeId, list: known })
        setChecked(known)
      })
      .catch(() => { if (!cancelled) setLoadedSources({ treeId, list: [] }) })
    return () => { cancelled = true }
  }, [visible, treeId, token, loadedSources.treeId])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  const query = useMemo(() => ({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    birthYear: /^\d{4}$/.test(birthYear.trim()) ? Number(birthYear.trim()) : undefined,
    place: place.trim() || undefined,
  }), [firstName, lastName, birthYear, place])

  const canSearch = Boolean(query.firstName && query.lastName && checked.length && !searching)

  const handleSearch = async (event) => {
    event.preventDefault()
    if (!canSearch) return
    setSearching(true)
    setPicker(null)
    setResults(Object.fromEntries(checked.map((id) => [id, { status: 'loading', items: [] }])))
    await Promise.all(checked.map(async (id) => {
      try {
        const items = await searchSource(treeId, id, query, token)
        setResults((prev) => ({ ...prev, [id]: { status: 'done', items } }))
      } catch (error) {
        const status = error?.payload?.error === 'source_quota' ? 'quota' : 'error'
        setResults((prev) => ({ ...prev, [id]: { status, items: [] } }))
      }
    }))
    setSearching(false)
  }

  const toggleSource = (id) => setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  // Personnes de l'arbre proposées pour un résultat : même nom de famille d'abord, puis l'année de naissance la plus proche
  const candidates = useMemo(() => {
    if (!picker) return []
    const needle = plain(picker.filter)
    const year = Number(picker.result.birth?.date?.slice(0, 4)) || null
    return persons
      .filter((person) => !needle || plain(`${person.firstName} ${person.lastName} ${person.birthName || ''}`).includes(needle))
      .map((person) => {
        const personYear = Number(person.birthYear || person.birthDate?.slice(0, 4)) || null
        const gap = year && personYear ? Math.abs(year - personYear) : 50
        // Né(e) une autre année que le résultat : on le dit avant qu'on rattache la mauvaise personne
        return { person, gap, yearOff: Boolean(year && personYear && gap > 2) }
      })
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 6)
  }, [picker, persons])

  const handlePick = async (person) => {
    const { key, result, sourceId } = picker
    const changes = changesFromResult(person, result, SOURCE_INFO[sourceId].name)
    if (!changes) {
      setPicker((prev) => ({ ...prev, nothingNew: fullNameLabel(person) }))
      return
    }
    setPicker((prev) => ({ ...prev, saving: true }))
    try {
      await onApply?.(person.id, changes)
      setApplied((prev) => ({ ...prev, [key]: fullNameLabel(person) }))
      setPicker(null)
    } catch {
      setPicker((prev) => ({ ...prev, saving: false, failed: true }))
    }
  }

  if (!visible) return null

  const linkQuery = { firstName: query.firstName, lastName: query.lastName, birthYear: query.birthYear }
  const links = SEARCH_LINKS.filter((link) => link.region === region)
  const checkedCount = checked.length

  return (
    <aside className="search-panel" role="dialog" aria-labelledby="searchPanelTitle">
      <div className="apn-head">
        <div className="pz-modal-head">
          <h2 id="searchPanelTitle" className="pz-title">{withEmphasis(t("Chercher <em>quelqu'un</em>"))}</h2>
        </div>
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon apn-close" onClick={onClose} aria-label={t('Fermer')}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      <div className="apn-scroll">
        <form className="sp-form" onSubmit={handleSearch}>
          <div className="pz-row2">
            <div className="pz-field">
              <label htmlFor="sp-lastName">{t('Nom de naissance')}</label>
              <input id="sp-lastName" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" />
            </div>
            <div className="pz-field">
              <label htmlFor="sp-firstName">{t('Prénom')}</label>
              <input id="sp-firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <div className="pz-row2">
            <div className="pz-field">
              <label htmlFor="sp-birthYear">{t('Né(e) vers')}<span className="apn-optional">{t('année')}</span></label>
              <input id="sp-birthYear" type="text" inputMode="numeric" maxLength={4} value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ''))} autoComplete="off" />
            </div>
            <div className="pz-field">
              <label htmlFor="sp-place">{t('Lieu de naissance')}<span className="apn-optional">{t('facultatif')}</span></label>
              <input id="sp-place" type="text" value={place} onChange={(e) => setPlace(e.target.value)} autoComplete="off" />
            </div>
          </div>

          <div className="apn-section sp-sources">
            <p className="pz-label">{t('Où chercher')}</p>
            {sources === null && <p className="pz-hint">{t('Chargement…')}</p>}
            {sources?.length === 0 && (
              <p className="pz-hint">{t("Ce serveur n'interroge aucune source : aucun nom ne quitte l'instance. Les liens plus bas ouvrent les sites dans votre navigateur.")}</p>
            )}
            {sources?.map((id) => {
              const info = SOURCE_INFO[id]
              return (
                <label key={id} className="sp-source">
                  <input type="checkbox" checked={checked.includes(id)} onChange={() => toggleSource(id)} />
                  <span>
                    <span className="sp-source-name">{info.name}</span>
                    <span className="sp-source-detail">{info.detail}</span>
                    <span className="sp-source-sent">{info.sent}</span>
                  </span>
                </label>
              )
            })}
            {sources?.length > 0 && (
              <div className="sp-submit">
                <button type="submit" className="pz-btn pz-btn--primary pz-btn--sm" disabled={!canSearch}>
                  <PzBusy busy={searching} busyLabel={t('Recherche…')}>{checkedCount > 1 ? t('Chercher dans {n} sources', { n: checkedCount }) : t('Chercher')}</PzBusy>
                </button>
              </div>
            )}
          </div>
        </form>

        {Object.entries(results).map(([sourceId, { status, items }]) => (
          <section key={sourceId} className="apn-section sp-results" aria-live="polite">
            <div className="sp-results-head">
              <h3 className="sp-results-title">{SOURCE_INFO[sourceId].name}</h3>
              {status === 'done' && <span className="pz-hint">{items.length === 0 ? t('Rien trouvé') : items.length === 1 ? t('1 trouvé') : t('{n} trouvés', { n: items.length })}</span>}
            </div>
            {status === 'loading' && <p className="pz-hint">{t('Recherche…')}</p>}
            {status === 'error' && <p className="pz-error">{t('La source ne répond pas pour le moment. Réessayez plus tard.')}</p>}
            {status === 'quota' && <p className="pz-error">{t("Ce serveur a épuisé ses recherches sans clé. Son administrateur peut ajouter une clé matchID gratuite (MATCHID_TOKEN).")}</p>}
            {status === 'done' && items.length === 0 && (
              <p className="pz-hint">{t("Personne sous ce nom. Essayez sans l'année, ou avec le nom de naissance.")}</p>
            )}
            {items.map((result) => {
              const key = `${sourceId}:${result.id}`
              const isPicking = picker?.key === key
              return (
                <article key={key} className={`sp-result${applied[key] ? ' sp-result--done' : ''}`}>
                  <div className="sp-result-name">{result.firstName} <em>{result.lastName}</em></div>
                  {result.birth?.date || result.birth?.place ? <p className="sp-result-line">{t('Naissance')} : {eventLine(result.birth)}</p> : null}
                  {result.death?.date || result.death?.place ? <p className="sp-result-line">{t('Décès')} : {eventLine(result.death)}</p> : null}
                  <div className="sp-result-foot">
                    <span className={`sp-match${result.match === 'good' ? ' sp-match--good' : ''}`}>
                      {result.match === 'good' ? t('Correspond bien') : t('À comparer')}
                    </span>
                    <a className="pz-link sp-result-link" href={result.url} target="_blank" rel="noopener noreferrer">
                      {t('Voir la source')}<ArrowUpRight size={13} aria-hidden="true" />
                    </a>
                    {canApply && !applied[key] && (
                      <button type="button" className={`pz-btn pz-btn--sm ${result.match === 'good' ? 'pz-btn--primary' : 'pz-btn--secondary'}`} onClick={() => setPicker(isPicking ? null : { key, result, sourceId, filter: result.lastName })} aria-expanded={isPicking}>
                        {t("Ajouter à l'arbre")}
                      </button>
                    )}
                  </div>
                  {applied[key] && <p className="sp-result-applied">{t('Ajouté à {name}, à vérifier', { name: applied[key] })}</p>}
                  {isPicking && (
                    <div className="sp-picker">
                      <div className="pz-field">
                        <label htmlFor={`sp-pick-${key}`}>{t('À quelle personne de l’arbre ?')}</label>
                        <div className="apn-search">
                          <Search size={16} className="apn-search-icon" aria-hidden="true" />
                          <input id={`sp-pick-${key}`} type="text" value={picker.filter} onChange={(e) => setPicker((prev) => ({ ...prev, filter: e.target.value, nothingNew: null, failed: false }))} autoComplete="off" autoFocus />
                        </div>
                      </div>
                      <ul className="sp-picker-list">
                        {candidates.length === 0 && <li className="pz-hint">{t('Personne ne correspond à cette recherche.')}</li>}
                        {candidates.map(({ person, yearOff }) => (
                          <li key={person.id}>
                            <button type="button" className="apn-dropdown-item" onClick={() => handlePick(person)} disabled={picker.saving}>
                              <span className="apn-avatar" aria-hidden="true">{person.photo ? <img src={person.photo} alt="" /> : (person.firstName || '?').charAt(0)}</span>
                              <span className="apn-dropdown-name">{person.firstName} <em>{person.lastName}</em></span>
                              <span className={`apn-dropdown-date${yearOff ? ' sp-year-off' : ''}`} title={yearOff ? t("Pas la même année de naissance que ce résultat") : undefined}>{personYears(person)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {candidates.some((candidate) => candidate.yearOff) && <p className="pz-hint">{t("Une année en couleur n'est pas celle de ce résultat.")}</p>}
                      {picker.nothingNew && <p className="pz-hint">{t('Rien de nouveau pour {name} : ses dates et ses lieux sont déjà remplis.', { name: picker.nothingNew })}</p>}
                      {picker.failed && <p className="pz-error">{t("L'ajout n'a pas marché. Réessayez.")}</p>}
                      <p className="pz-hint">{t('Seuls les champs vides sont remplis. La personne passe « à vérifier », et la source va dans sa note.')}</p>
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        ))}

        <section className="apn-section sp-links">
          <p className="pz-label">{t('Chercher aussi sur')}</p>
          <div className="pz-tabs" role="tablist">
            {SEARCH_LINK_REGIONS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={region === item.id} className={`pz-tab${region === item.id ? ' is-active' : ''}`} onClick={() => setRegion(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <ul className="sp-link-list">
            {links.map((link) => (
              <li key={link.id}>
                <a href={link.url(linkQuery)} target="_blank" rel="noopener noreferrer" className="sp-link">
                  <span className="sp-link-name">{link.name}<ArrowUpRight size={13} aria-hidden="true" /></span>
                  <span className="sp-link-detail">{link.detail}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="pz-hint">{t("Ces sites s'ouvrent dans votre navigateur, avec le nom déjà tapé quand ils le permettent. Rien ne passe par Parenthèse.")}</p>
        </section>
      </div>
    </aside>
  )
}

export default SearchSourcesPanel
