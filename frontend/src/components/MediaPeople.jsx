import { useMemo, useState } from 'react'
import { Check, Search, UserPlus, X } from 'lucide-react'
import { t } from '../i18n/index.js'
import { firstNameLabel, fullNameLabel } from '../utils/personName.js'
import './MediaPeople.css'

const MAX_RESULTS = 6

const normalize = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function PersonAvatar({ person }) {
  return person?.photo
    ? <img className="mp-avatar" src={person.photo} alt="" />
    : <span className="mp-avatar mp-avatar--initial" aria-hidden="true">{person?.firstName?.[0] || '?'}</span>
}

// Ronds posés sur les visages, cachés tant qu'on ne les demande pas (survol de la photo, photo touchée, prénom survolé
// dessous : `hotId`). En identification, ils restent visibles et le rond de la personne choisie est mis en avant.
export function MediaPeopleMarkers({ people, getPerson, activeId = null, hotId = null, onOpenPerson }) {
  return people.filter((tag) => tag.x != null && tag.y != null).map((tag) => {
    const person = getPerson(tag.personId)
    if (!person) return null
    const name = firstNameLabel(person)
    return (
      <button
        key={tag.personId}
        type="button"
        className={`mp-marker${activeId === tag.personId ? ' is-active' : ''}${hotId === tag.personId ? ' is-hot' : ''}`}
        style={{ left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}
        onClick={(event) => { event.stopPropagation(); onOpenPerson?.(tag.personId) }}
        aria-label={t('Voir la fiche de {name}', { name })}
      >
        <span className="mp-marker-name">{name}</span>
      </button>
    )
  })
}

// « Sur la photo » : les personnes identifiées, chacune ouvre sa fiche. En identification : retirer, ajouter,
// choisir la personne dont on place le point.
export function MediaPeopleList({
  people,
  getPerson,
  allPersons = [],
  editing = false,
  canPlace = false,
  activeId = null,
  onActivate,
  onAdd,
  onRemove,
  onOpenPerson,
  onHover,
}) {
  const [query, setQuery] = useState('')
  const taken = useMemo(() => new Set(people.map((tag) => tag.personId)), [people])
  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return []
    return allPersons
      .filter((person) => !taken.has(person.id))
      .filter((person) => normalize(`${person.firstName || ''} ${person.lastName || ''} ${person.nickname || ''}`).includes(q))
      .slice(0, MAX_RESULTS)
  }, [allPersons, query, taken])

  const known = people.map((tag) => ({ tag, person: getPerson(tag.personId) })).filter((entry) => entry.person)

  if (!editing) {
    if (!known.length) return null
    return (
      <div className="mp-list" aria-label={t('Sur la photo')}>
        <span className="mp-list-label">{t('Sur la photo')}</span>
        {known.map(({ person }) => (
          <button
            key={person.id}
            type="button"
            className="mp-chip"
            onClick={() => onOpenPerson?.(person.id)}
            onPointerEnter={() => onHover?.(person.id)}
            onPointerLeave={() => onHover?.(null)}
            onFocus={() => onHover?.(person.id)}
            onBlur={() => onHover?.(null)}
          >
            <PersonAvatar person={person} />
            <span>{firstNameLabel(person)}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="mp-edit">
      {known.length > 0 && (
        <ul className="mp-edit-list">
          {known.map(({ tag, person }) => {
            const active = activeId === person.id
            const placed = tag.x != null
            return (
              <li key={person.id} className={`mp-edit-row${active ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="mp-edit-pick"
                  onClick={() => onActivate?.(active ? null : person.id)}
                  aria-pressed={canPlace ? active : undefined}
                  disabled={!canPlace}
                >
                  <PersonAvatar person={person} />
                  <span className="mp-edit-name">{fullNameLabel(person)}</span>
                  {canPlace && (
                    <span className="mp-edit-state">
                      {active ? t('Touchez son visage') : placed ? <><Check size={13} strokeWidth={2.4} aria-hidden="true" /> {t('Placé')}</> : t('Placer')}
                    </span>
                  )}
                </button>
                <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon mp-edit-remove" onClick={() => onRemove?.(person.id)} aria-label={t('Retirer {name}', { name: firstNameLabel(person) })}>
                  <X size={15} strokeWidth={2} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mp-search">
        <Search size={15} strokeWidth={2} aria-hidden="true" />
        <input
          type="search"
          className="mp-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Qui est sur la photo ?')}
          aria-label={t('Chercher une personne de l’arbre')}
        />
      </div>
      {results.length > 0 && (
        <ul className="mp-results" role="listbox" aria-label={t('Personnes trouvées')}>
          {results.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                className="mp-result"
                onClick={() => { onAdd?.(person.id); setQuery('') }}
              >
                <UserPlus size={15} strokeWidth={2} aria-hidden="true" />
                <PersonAvatar person={person} />
                <span>{fullNameLabel(person)}</span>
                {person.birthYear && <span className="mp-result-year">{person.birthYear}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
