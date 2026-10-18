import './SearchResultsDropdown.css'
import { t } from '../../i18n/index.js'
import { firstNameLabel } from '../../utils/personName.js'

// Raison du match renvoyée par usePersonSearch (valeur française), traduite à l'affichage
const REASON_LABELS = {
  Nom: t('Nom'),
  Profession: t('Profession'),
  Lieu: t('Lieu'),
  Date: t('Date'),
  Contenu: t('Contenu'),
}

/**
 * Dropdown de résultats de recherche
 * Affiche jusqu'à 10 résultats triés par score
 *
 * @param {Object} props
 * @param {Array} props.results - Résultats [{person, score, reason}]
 * @param {string} props.query - Requête de recherche
 * @param {Function} props.onResultClick - Handler clic résultat
 * @param {Function} props.onResultHover - Handler hover résultat
 * @param {Function} props.onResultHoverEnd - Handler fin hover
 */
function SearchResultsDropdown({
  results = [],
  query = '',
  onResultClick,
  onResultHover,
  onResultHoverEnd,
}) {
  // Limiter à 10 résultats affichés
  const displayedResults = results.slice(0, 10)

  if (displayedResults.length === 0) {
    return (
      <div className="search-results-dropdown">
        <div className="search-result-empty">
          {t("Personne ne s'appelle « {query} » dans cet arbre", { query })}
        </div>
      </div>
    )
  }

  return (
    <div className="search-results-dropdown">
      <div className="search-results-list">
        {displayedResults.map(({ person, reason, matchDetail }) => (
          <button
            key={person.id}
            type="button"
            className="search-result-item"
            onClick={() => onResultClick?.(person)}
            onMouseEnter={() => onResultHover?.(person)}
            onMouseLeave={() => onResultHoverEnd?.()}
          >
            {/* Photo miniature */}
            <div className="search-result-thumb">
              {person.photo ? (
                <img src={person.photo} alt="" />
              ) : (
                <div className="search-result-initials">
                  {person.firstName?.[0] || '?'}
                </div>
              )}
            </div>

            {/* Info personne */}
            <div className="search-result-info">
              <div className="search-result-name">
                {firstNameLabel(person)} <span className="search-result-lastname">{person.lastName}</span>
              </div>
              <div className="search-result-meta">
                {person.birthYear && <span className="search-result-year">{person.birthYear}{person.deathYear ? `–${person.deathYear}` : ''}</span>}
                {reason && reason.toLowerCase() !== 'nom' && <span className="search-result-badge">{REASON_LABELS[reason] || reason}</span>}
                {matchDetail && matchDetail !== `${person.firstName} ${person.lastName}` && (
                  <span className="search-result-match-detail">{matchDetail}</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {results.length > 10 && (
        <div className="search-results-footer">
          {t('{n} autres résultats, précisez la recherche', { n: results.length - 10 })}
        </div>
      )}
    </div>
  )
}

export default SearchResultsDropdown
