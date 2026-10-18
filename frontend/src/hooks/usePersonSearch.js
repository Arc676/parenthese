import { useState, useMemo, useCallback } from 'react'

/**
 * Système de scoring pour la pertinence de recherche
 */
const SCORE_WEIGHTS = {
  // Poids 100 : Ultra pertinent
  NAME_EXACT: 100,
  FIRSTNAME_EXACT: 100,
  LASTNAME_EXACT: 100,

  // Poids 80 : Très pertinent
  NAME_STARTS_WITH: 80,
  NICKNAME_STARTS_WITH: 80,
  FIRSTNAME_STARTS_WITH: 80,
  LASTNAME_STARTS_WITH: 80,
  PROFESSION_EXACT: 80,
  BIRTH_PLACE_EXACT: 80,

  // Poids 50 : Moyennement pertinent
  NAME_CONTAINS: 50,
  PROFESSION_CONTAINS: 50,
  BIRTH_YEAR_MATCH: 50,
  DEATH_YEAR_MATCH: 50,
  REGION_MATCH: 50,
  NICKNAME_CONTAINS: 50,

  // Poids 20 : Peu pertinent
  NOTE_CONTAINS: 20,
}

/**
 * Seuil minimum de score pour afficher un résultat
 */
const MIN_SCORE_THRESHOLD = 30

/**
 * Calcule le score de pertinence pour une personne
 * @param {string} query - Requête de recherche (normalisée lowercase)
 * @param {Object} person - Objet personne
 * @returns {number} Score de pertinence
 */
function calculateScore(query, person) {
  let score = 0
  const q = query.toLowerCase().trim()

  if (!q || q.length < 2) return 0

  // Normaliser les données de la personne
  const firstName = (person.firstName || '').toLowerCase()
  const lastName = (person.lastName || '').toLowerCase()
  const fullName = `${firstName} ${lastName}`
  const profession = (person.profession || '').toLowerCase()
  const birthPlace = (person.birthPlace || '').toLowerCase()
  const region = (person.region || '').toLowerCase()
  const note = (person.note || '').toLowerCase()
  const nickname = (person.nickname || '').toLowerCase()
  const birthYear = person.birthYear?.toString() || ''
  const deathYear = person.deathYear?.toString() || ''

  // === NOM/PRÉNOM ===

  // Exact match nom complet
  if (fullName === q) {
    score += SCORE_WEIGHTS.NAME_EXACT
  }

  // Exact match prénom
  if (firstName === q) {
    score += SCORE_WEIGHTS.FIRSTNAME_EXACT
  }

  // Exact match nom
  if (lastName === q) {
    score += SCORE_WEIGHTS.LASTNAME_EXACT
  }

  // Starts with prénom
  if (firstName.startsWith(q)) {
    score += SCORE_WEIGHTS.FIRSTNAME_STARTS_WITH
  }

  // Starts with nom
  if (lastName.startsWith(q)) {
    score += SCORE_WEIGHTS.LASTNAME_STARTS_WITH
  }

  // Starts with nom complet
  if (fullName.startsWith(q)) {
    score += SCORE_WEIGHTS.NAME_STARTS_WITH
  }

  // Contains dans nom complet (mais pas déjà compté)
  if (fullName.includes(q) && !fullName.startsWith(q) && fullName !== q) {
    score += SCORE_WEIGHTS.NAME_CONTAINS
  }

  // === PROFESSION ===

  if (profession) {
    if (profession === q) {
      score += SCORE_WEIGHTS.PROFESSION_EXACT
    } else if (profession.includes(q)) {
      score += SCORE_WEIGHTS.PROFESSION_CONTAINS
    }
  }

  // === SURNOM ===

  if (nickname && nickname.includes(q)) {
    score += nickname.startsWith(q) ? SCORE_WEIGHTS.NICKNAME_STARTS_WITH : SCORE_WEIGHTS.NICKNAME_CONTAINS
  }

  // === LIEUX ===

  if (birthPlace && birthPlace === q) {
    score += SCORE_WEIGHTS.BIRTH_PLACE_EXACT
  }

  if (region && region.includes(q)) {
    score += SCORE_WEIGHTS.REGION_MATCH
  }

  // === DATES/ÂGES ===

  if (birthYear && birthYear.includes(q)) {
    score += SCORE_WEIGHTS.BIRTH_YEAR_MATCH
  }

  if (deathYear && deathYear.includes(q)) {
    score += SCORE_WEIGHTS.DEATH_YEAR_MATCH
  }

  // === CONTENU (notes, etc.) ===

  if (note && note.includes(q)) {
    score += SCORE_WEIGHTS.NOTE_CONTAINS
  }

  return score
}

/**
 * Détermine la raison principale du match (pour affichage badge)
 * @param {string} query
 * @param {Object} person
 * @returns {string} Raison du match
 */
function getMatchReason(query, person) {
  const q = query.toLowerCase().trim()
  const firstName = (person.firstName || '').toLowerCase()
  const lastName = (person.lastName || '').toLowerCase()
  const fullName = `${firstName} ${lastName}`
  const profession = (person.profession || '').toLowerCase()
  const birthPlace = (person.birthPlace || '').toLowerCase()
  const birthYear = person.birthYear?.toString() || ''

  if (fullName === q || firstName === q || lastName === q) {
    return 'Nom'
  }

  if (firstName.startsWith(q) || lastName.startsWith(q)) {
    return 'Nom'
  }

  if ((person.nickname || '').toLowerCase().includes(q)) {
    return 'Surnom'
  }

  if (profession && profession.includes(q)) {
    return 'Profession'
  }

  if (birthPlace && birthPlace.includes(q)) {
    return 'Lieu'
  }

  if (birthYear && birthYear.includes(q)) {
    return 'Date'
  }

  return 'Contenu'
}

/**
 * Retourne la valeur précise qui a matché (pour affichage à côté du badge)
 * @param {string} query
 * @param {Object} person
 * @returns {string}
 */
function getMatchDetail(query, person) {
  const q = query.toLowerCase().trim()
  if (!q) return ''

  const firstName = person.firstName || ''
  const lastName = person.lastName || ''
  const fullName = `${firstName} ${lastName}`.trim()
  const fullNameNorm = fullName.toLowerCase()
  const firstNameNorm = firstName.toLowerCase()
  const lastNameNorm = lastName.toLowerCase()
  const profession = person.profession || ''
  const birthPlace = person.birthPlace || ''
  const region = person.region || ''
  const note = person.note || ''
  const birthYear = person.birthYear?.toString() || ''
  const deathYear = person.deathYear?.toString() || ''

  if (fullNameNorm.includes(q) || firstNameNorm.includes(q) || lastNameNorm.includes(q)) {
    return fullName
  }

  if ((person.nickname || '').toLowerCase().includes(q)) {
    return person.nickname
  }

  if (profession.toLowerCase().includes(q)) {
    return profession
  }

  if (birthPlace.toLowerCase().includes(q)) {
    return birthPlace
  }

  if (region.toLowerCase().includes(q)) {
    return region
  }

  if (birthYear.includes(q) || deathYear.includes(q)) {
    if (birthYear && deathYear) return `${birthYear}-${deathYear}`
    return birthYear || deathYear
  }

  if (note.toLowerCase().includes(q)) {
    const index = note.toLowerCase().indexOf(q)
    if (index >= 0) {
      const start = Math.max(0, index - 10)
      const end = Math.min(note.length, index + q.length + 18)
      const excerpt = note.slice(start, end).trim()
      return start > 0 ? `...${excerpt}` : excerpt
    }
    return note.length > 28 ? `${note.slice(0, 28)}...` : note
  }

  return ''
}

/**
 * Hook pour la recherche de personnes avec scoring
 *
 * @param {Array} persons - Liste de toutes les personnes
 * @returns {Object} API de recherche
 */
export function usePersonSearch(persons = []) {
  const [query, setQuery] = useState('')
  const [isActive, setIsActive] = useState(false)

  // Calculer les résultats de recherche avec scoring
  const results = useMemo(() => {
    if (!query || query.trim().length < 2) {
      return []
    }

    const scored = persons
      .map(person => ({
        person,
        score: calculateScore(query, person),
        reason: getMatchReason(query, person),
        matchDetail: getMatchDetail(query, person),
      }))
      .filter(item => item.score >= MIN_SCORE_THRESHOLD)
      .sort((a, b) => {
        // Trier par score décroissant, puis alphabétique si égalité
        if (b.score !== a.score) {
          return b.score - a.score
        }
        const nameA = `${a.person.firstName} ${a.person.lastName}`
        const nameB = `${b.person.firstName} ${b.person.lastName}`
        return nameA.localeCompare(nameB)
      })
      .slice(0, 50) // Limiter à 50 résultats max

    return scored
  }, [query, persons])

  // Liste des IDs de personnes matchées (pour highlight galaxie)
  const matchedPersonIds = useMemo(() => {
    return results.map(r => r.person.id)
  }, [results])

  const handleSearch = useCallback((searchQuery) => {
    setQuery(searchQuery)
  }, [])

  const clearSearch = useCallback(() => {
    setQuery('')
    setIsActive(false)
  }, [])

  const activate = useCallback(() => {
    setIsActive(true)
  }, [])

  const deactivate = useCallback(() => {
    setIsActive(false)
    setQuery('')
  }, [])

  return {
    query,
    results,
    matchedPersonIds,
    isActive,
    hasResults: results.length > 0,
    handleSearch,
    clearSearch,
    activate,
    deactivate,
  }
}

export { calculateScore, getMatchReason, MIN_SCORE_THRESHOLD }
