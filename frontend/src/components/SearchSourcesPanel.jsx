import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Search, X } from 'lucide-react'
import './AddPersonPanel.css'
import './SearchSourcesPanel.css'
import PzBusy from './PzBusy.jsx'
import { t, dateLocale } from '../i18n/index.js'
import { fetchSearchSources, searchSource } from '../api/searchSourcesApi.js'
import { SEARCH_LINKS, SEARCH_LINK_REGIONS } from '../data/searchLinks.js'
import { changesFromResult, personFromResult } from '../utils/searchResultChanges.js'
import { fullNameLabel } from '../utils/personName.js'

// Ce que chaque source interrogée couvre et ce qui part vers elle : affiché avant qu'on coche
const SOURCE_INFO = {
  deces: {
    name: t('Décès en France depuis 1970'),
    detail: t("Fichier de l'INSEE, par matchID. Date et lieu de décès, rien avant 1970. Une femme se cherche sous son nom de naissance."),
    sent: t("Envoie le nom, le prénom et l'année de naissance à matchid.io"),
    short: t("Fichier de l'INSEE, par matchID"),
  },
  wikitree: {
    name: 'WikiTree',
    detail: t('Un arbre mondial tenu par ses membres. Profils publics seulement.'),
    sent: t("Envoie le nom, le prénom et l'année de naissance à wikitree.com"),
    short: t('Arbre tenu par ses membres'),
  },
}

// « 1898 », « 1898-03 » ou « 1898-03-14 » dans la langue de l'interface
function formatDate(value) {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  if (!month) return String(year)
  const date = new Date(Date.UTC(year, month - 1, day || 1))
  const options = day ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' }
  const text = date.toLocaleDateString(dateLocale, { ...options, timeZone: 'UTC' })
  // « 1er janvier », pas « 1 janvier »
  return dateLocale === 'fr-FR' && day === 1 ? text.replace(/^1 /, '1er ') : text
}

// « Né le 24 août 1898 à Monségur (40) », accordé au sexe quand la source le donne
const VERBS = {
  birth: { M: (when) => t('Né {when}', { when }), F: (when) => t('Née {when}', { when }), null: (when) => t('Né(e) {when}', { when }) },
  death: { M: (when) => t('Mort {when}', { when }), F: (when) => t('Morte {when}', { when }), null: (when) => t('Mort(e) {when}', { when }) },
}

function eventSentence(kind, event, sex) {
  if (!event?.date && !event?.place) return null
  const parts = []
  if (event.date) parts.push(event.date.length === 10 ? t('le {date}', { date: formatDate(event.date) }) : t('en {date}', { date: formatDate(event.date) }))
  if (event.place) parts.push(t('à {place}', { place: event.place }))
  return (VERBS[kind][sex] || VERBS[kind].null)(parts.join(' '))
}

// « 1898 – 1987, 89 ans au décès » ; l'âge seulement quand les deux dates sont complètes
function lifespan(result) {
  const birth = result.birth?.date
  const death = result.death?.date
  // Une seule date : la phrase « Né le … » la donne déjà
  if (!birth || !death) return ''
  const years = `${birth.slice(0, 4)} – ${death.slice(0, 4)}`
  if (birth.length !== 10 || death.length !== 10) return years
  const age = Number(death.slice(0, 4)) - Number(birth.slice(0, 4)) - (death.slice(5) < birth.slice(5) ? 1 : 0)
  return `${years}, ${t('{age} ans au décès', { age })}`
}

// Pourquoi « Correspond bien » ou « À comparer » : l'année et le lieu cherchés, face à ceux du résultat
function matchReason(result, query) {
  const reasons = []
  const year = Number(result.birth?.date?.slice(0, 4)) || null
  if (query.birthYear) {
    if (!year) reasons.push(t("pas d'année de naissance"))
    else reasons.push(Math.abs(year - query.birthYear) <= 1 ? t('même année') : t('autre année'))
  }
  if (query.place) {
    if (!result.birth?.place) reasons.push(t('pas de lieu de naissance'))
    else reasons.push(plain(result.birth.place).startsWith(plain(query.place)) ? t('même lieu') : t('autre lieu de naissance'))
  }
  return reasons.length ? reasons.join(', ') : t('seuls le nom et le prénom sont comparés')
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

// Mêmes libellés que « Ajouter quelqu'un » : la nouvelle personne est parent, enfant… de quelqu'un de l'arbre
const RELATION_TABS = {
  parent: t('Parent'),
  child: t('Enfant'),
  spouse: t('Conjoint·e'),
  sibling: t('Frère·Sœur'),
}
const RELATION_LABELS = {
  parent: t('Parent de'),
  child: t('Enfant de'),
  spouse: t('Conjoint·e de'),
  sibling: t('Frère·Sœur de'),
}

const plain = (value) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

function SearchSourcesPanel({ visible, treeId, token, persons = [], canApply = false, onApply, onCreate, createError = '', onClose }) {
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
  // Après une recherche, le formulaire se replie en une ligne : les résultats passent devant
  const [searched, setSearched] = useState(null)
  const [editing, setEditing] = useState(true)

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
    setSearched(query)
    setEditing(false)
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

  // Le plus souvent, la personne trouvée n'est pas encore dans l'arbre : on la crée, rattachée à un proche
  const handleCreate = async () => {
    const { key, result, sourceId, relationType, relative } = picker
    if (!relative) return
    setPicker((prev) => ({ ...prev, saving: true, failed: false }))
    const created = await onCreate?.(personFromResult(result, SOURCE_INFO[sourceId].name, { personId: relative.id, type: relationType }))
    if (created) {
      setApplied((prev) => ({ ...prev, [key]: { name: `${result.firstName} ${result.lastName}`.trim(), created: true } }))
      setPicker(null)
    } else {
      setPicker((prev) => ({ ...prev, saving: false, failed: true }))
    }
  }

  const handlePick = async (person) => {
    if (picker.mode === 'new') {
      setPicker((prev) => ({ ...prev, relative: person }))
      return
    }
    const { key, result, sourceId } = picker
    const changes = changesFromResult(person, result, SOURCE_INFO[sourceId].name)
    if (!changes) {
      setPicker((prev) => ({ ...prev, nothingNew: fullNameLabel(person) }))
      return
    }
    setPicker((prev) => ({ ...prev, saving: true }))
    try {
      await onApply?.(person.id, changes)
      setApplied((prev) => ({ ...prev, [key]: { name: fullNameLabel(person), created: false } }))
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
        {!editing && searched && (
          <div className="sp-summary">
            <div className="sp-summary-text">
              <p className="sp-summary-who">{searched.firstName} <em>{searched.lastName}</em></p>
              {(searched.birthYear || searched.place) && (
                <p className="pz-hint">{[searched.birthYear && t('né(e) vers {year}', { year: searched.birthYear }), searched.place].filter(Boolean).join(', ')}</p>
              )}
            </div>
            <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={() => setEditing(true)}>{t('Modifier')}</button>
          </div>
        )}
        {editing && (
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
        )}

        {Object.entries(results).map(([sourceId, { status, items }]) => (
          <section key={sourceId} className="apn-section sp-results" aria-live="polite">
            <div className="sp-results-head">
              <div>
                <h3 className="sp-results-title">{SOURCE_INFO[sourceId].name}</h3>
                <p className="sp-results-sub">{SOURCE_INFO[sourceId].short}</p>
              </div>
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
                  <div className="sp-result-head">
                    <div className="sp-result-name">{result.firstName} <em>{result.lastName}</em></div>
                    <span className={`sp-match${result.match === 'good' ? ' sp-match--good' : ''}`}>
                      {result.match === 'good' ? t('Correspond bien') : t('À comparer')}
                    </span>
                  </div>
                  {lifespan(result) && <p className="sp-result-years">{lifespan(result)}</p>}
                  {[eventSentence('birth', result.birth, result.sex), eventSentence('death', result.death, result.sex)].filter(Boolean).map((line) => (
                    <p key={line} className="sp-result-line">{line}</p>
                  ))}
                  <p className="sp-result-reason">{matchReason(result, searched || query)}</p>
                  <div className="sp-result-foot">
                    <a className="pz-link sp-result-link" href={result.url} target="_blank" rel="noopener noreferrer">
                      {t('Voir la source')}<ArrowUpRight size={13} aria-hidden="true" />
                    </a>
                    {canApply && !applied[key] && (
                      <button type="button" className={`pz-btn pz-btn--sm ${result.match === 'good' ? 'pz-btn--primary' : 'pz-btn--secondary'}`} onClick={() => setPicker(isPicking ? null : { key, result, sourceId, mode: 'new', relationType: 'parent', relative: null, filter: result.lastName })} aria-expanded={isPicking}>
                        {t("Ajouter à l'arbre")}
                      </button>
                    )}
                  </div>
                  {applied[key] && (
                    <p className="sp-result-applied">
                      {applied[key].created ? t("{name} est dans l'arbre, à vérifier", { name: applied[key].name }) : t('Ajouté à {name}, à vérifier', { name: applied[key].name })}
                    </p>
                  )}
                  {isPicking && (
                    <div className="sp-picker">
                      <div className="pz-tabs" role="tablist">
                        <button type="button" role="tab" aria-selected={picker.mode === 'new'} className={`pz-tab${picker.mode === 'new' ? ' is-active' : ''}`} onClick={() => setPicker((prev) => ({ ...prev, mode: 'new', nothingNew: null, failed: false }))}>{t('Nouvelle personne')}</button>
                        <button type="button" role="tab" aria-selected={picker.mode === 'existing'} className={`pz-tab${picker.mode === 'existing' ? ' is-active' : ''}`} onClick={() => setPicker((prev) => ({ ...prev, mode: 'existing', failed: false }))}>{t("Déjà dans l'arbre")}</button>
                      </div>
                      {picker.mode === 'new' && (
                        <div className="pz-tabs apn-types" role="radiogroup" aria-label={t('Type de lien')}>
                          {Object.entries(RELATION_TABS).map(([type, label]) => (
                            <button key={type} type="button" role="radio" aria-checked={picker.relationType === type} className={`pz-tab${picker.relationType === type ? ' is-active' : ''}`} onClick={() => setPicker((prev) => ({ ...prev, relationType: type }))}>
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="pz-field">
                        <label htmlFor={`sp-pick-${key}`}>{picker.mode === 'new' ? RELATION_LABELS[picker.relationType] : t('À quelle personne de l’arbre ?')}</label>
                        <div className="apn-search">
                          <Search size={16} className="apn-search-icon" aria-hidden="true" />
                          <input id={`sp-pick-${key}`} type="text" value={picker.filter} onChange={(e) => setPicker((prev) => ({ ...prev, filter: e.target.value, nothingNew: null, failed: false }))} autoComplete="off" autoFocus />
                        </div>
                      </div>
                      <ul className="sp-picker-list">
                        {candidates.length === 0 && <li className="pz-hint">{t('Personne ne correspond à cette recherche.')}</li>}
                        {candidates.map(({ person, yearOff }) => (
                          <li key={person.id}>
                            <button type="button" className={`apn-dropdown-item${picker.relative?.id === person.id ? ' is-selected' : ''}`} aria-pressed={picker.mode === 'new' ? picker.relative?.id === person.id : undefined} onClick={() => handlePick(person)} disabled={picker.saving}>
                              <span className="apn-avatar" aria-hidden="true">{person.photo ? <img src={person.photo} alt="" /> : (person.firstName || '?').charAt(0)}</span>
                              <span className="apn-dropdown-name">{person.firstName} <em>{person.lastName}</em></span>
                              <span className={`apn-dropdown-date${yearOff && picker.mode === 'existing' ? ' sp-year-off' : ''}`} title={yearOff && picker.mode === 'existing' ? t("Pas la même année de naissance que ce résultat") : undefined}>{personYears(person)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {picker.mode === 'existing' && candidates.some((candidate) => candidate.yearOff) && <p className="pz-hint">{t("Une année en couleur n'est pas celle de ce résultat.")}</p>}
                      {picker.nothingNew && <p className="pz-hint">{t('Rien de nouveau pour {name} : ses dates et ses lieux sont déjà remplis.', { name: picker.nothingNew })}</p>}
                      {picker.failed && <p className="pz-error">{(picker.mode === 'new' && createError) || t("L'ajout n'a pas marché. Réessayez.")}</p>}
                      {picker.mode === 'new' ? (
                        <>
                          <div className="sp-create">
                            <button type="button" className="pz-btn pz-btn--primary pz-btn--sm" disabled={!picker.relative || picker.saving} onClick={handleCreate}>
                              <PzBusy busy={picker.saving}>{t('Créer {name}', { name: result.firstName.split(' ')[0] || result.lastName })}</PzBusy>
                            </button>
                          </div>
                          <p className="pz-hint">{picker.relative
                            ? t('{name}, {link} {relative}. Ses dates, ses lieux et la source sont repris, et la fiche passe « à vérifier ».', { name: `${result.firstName} ${result.lastName}`.trim(), link: RELATION_LABELS[picker.relationType].toLowerCase(), relative: fullNameLabel(picker.relative) })
                            : t('Choisissez à qui la rattacher dans l’arbre.')}</p>
                        </>
                      ) : (
                        <p className="pz-hint">{t('Seuls les champs vides sont remplis. La personne passe « à vérifier », et la source va dans sa note.')}</p>
                      )}
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
