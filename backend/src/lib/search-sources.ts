import { env } from '../config/env.js'

// Sources publiques interrogées par le panneau « Chercher quelqu'un » (SEARCH_SOURCES). Chaque source
// reçoit la même question et rend des résultats au même format, que le front affiche sans savoir d'où
// ils viennent. Ajouter une source : un objet de plus dans SOURCES, avec ce qu'elle envoie au service.

export type SearchQuery = {
  firstName: string
  lastName: string
  birthYear?: number
  place?: string
}

export type SearchEvent = { date: string | null; place: string | null }

export type SearchResult = {
  id: string
  firstName: string
  lastName: string
  sex: 'M' | 'F' | null
  birth: SearchEvent
  death: SearchEvent
  url: string
  // good : prénom, nom, année et lieu de naissance concordent
  match: 'good' | 'partial'
}

type Source = {
  id: string
  search: (query: SearchQuery) => Promise<SearchResult[]>
}

export class SearchSourceUnavailableError extends Error {}

const TIMEOUT_MS = 10_000
const MAX_RESULTS = 10
const USER_AGENT = 'Parenthese (+https://parenthese.io)'

export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()
}

// « 18980824 » ou « 1898-08-24 » → « 1898-08-24 » ; « 0000-00-00 » ou mois inconnu → année seule
function toIsoDate(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/-/g, '')
  if (!/^\d{8}$/.test(digits) || digits.startsWith('0000')) return null
  const [year, month, day] = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)]
  if (month === '00') return year
  if (day === '00') return `${year}-${month}`
  return `${year}-${month}-${day}`
}

function yearOf(date: string | null): number | null {
  return date ? Number(date.slice(0, 4)) : null
}

function grade(query: SearchQuery, result: Omit<SearchResult, 'match'>): SearchResult['match'] {
  const sameLast = normalizeName(result.lastName) === normalizeName(query.lastName)
  const firstNames = normalizeName(result.firstName).split(' ')
  const sameFirst = firstNames.includes(normalizeName(query.firstName).split(' ')[0] ?? '')
  const birthYear = yearOf(result.birth.date)
  const sameYear = !query.birthYear || (birthYear !== null && Math.abs(birthYear - query.birthYear) <= 1)
  // Sans lieu, un nom et une année courants ramènent des homonymes : seul le lieu de naissance départage
  const samePlace = Boolean(query.place && result.birth.place
    && normalizeName(result.birth.place).startsWith(normalizeName(query.place)))
  return sameLast && sameFirst && sameYear && samePlace ? 'good' : 'partial'
}

async function fetchJson(url: URL, headers: Record<string, string> = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new SearchSourceUnavailableError('unreachable')
  }
  // matchID répond 401 ou 422 quand la recherche sans jeton est épuisée ou que le jeton a expiré
  if (response.status === 401 || response.status === 422) throw new SearchSourceUnavailableError('quota')
  if (!response.ok) throw new SearchSourceUnavailableError(`http_${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new SearchSourceUnavailableError('invalid_json')
  }
}

// matchID demande une recherche par seconde au plus : les appels de toute l'instance passent l'un après l'autre
let matchIdQueue: Promise<unknown> = Promise.resolve()
const MATCHID_INTERVAL_MS = 1100

function throttled<T>(run: () => Promise<T>): Promise<T> {
  const next = matchIdQueue.then(run, run)
  matchIdQueue = next.then(
    () => new Promise((resolve) => setTimeout(resolve, MATCHID_INTERVAL_MS)),
    () => new Promise((resolve) => setTimeout(resolve, MATCHID_INTERVAL_MS)),
  )
  return next
}

type MatchIdLocation = { city?: string | string[]; departmentCode?: string; country?: string }
type MatchIdPerson = {
  id: string
  name?: { first?: string[] | string; last?: string }
  sex?: string
  birth?: { date?: string; location?: MatchIdLocation }
  death?: { date?: string; location?: MatchIdLocation }
}

function matchIdPlace(location: MatchIdLocation | undefined): string | null {
  if (!location) return null
  const city = Array.isArray(location.city) ? location.city[0] : location.city
  if (!city) return location.country || null
  if (location.country && location.country !== 'France') return `${city}, ${location.country}`
  return location.departmentCode ? `${city} (${location.departmentCode})` : city
}

// Décès en France depuis 1970 : fichier de l'INSEE, cherché par matchID (deces.matchid.io)
const deces: Source = {
  id: 'deces',
  search: (query) => throttled(async () => {
    const url = new URL('https://deces.matchid.io/deces/api/v1/search')
    url.searchParams.set('firstName', query.firstName)
    url.searchParams.set('lastName', query.lastName)
    if (query.birthYear) url.searchParams.set('birthDate', String(query.birthYear))
    url.searchParams.set('size', String(MAX_RESULTS))
    const headers: Record<string, string> = env.MATCHID_TOKEN ? { Authorization: `Bearer ${env.MATCHID_TOKEN}` } : {}
    const payload = await fetchJson(url, headers) as { response?: { persons?: MatchIdPerson[] } }
    const persons = payload?.response?.persons ?? []
    return persons.map((person) => {
      const first = person.name?.first
      const base: Omit<SearchResult, 'match'> = {
        id: person.id,
        firstName: Array.isArray(first) ? first.join(' ') : first ?? '',
        lastName: person.name?.last ?? '',
        sex: person.sex === 'M' || person.sex === 'F' ? person.sex : null,
        birth: { date: toIsoDate(person.birth?.date), place: matchIdPlace(person.birth?.location) },
        death: { date: toIsoDate(person.death?.date), place: matchIdPlace(person.death?.location) },
        url: `https://deces.matchid.io/id/${encodeURIComponent(person.id)}`,
      }
      return { ...base, match: grade(query, base) }
    })
  }),
}

type WikiTreeMatch = {
  Id: number
  Name: string
  FirstName?: string
  MiddleName?: string
  LastNameAtBirth?: string
  Gender?: string
  BirthDate?: string
  DeathDate?: string
  BirthLocation?: string
  DeathLocation?: string
}

// WikiTree : arbre mondial tenu par ses membres, profils publics seulement (api.wikitree.com)
const wikitree: Source = {
  id: 'wikitree',
  search: async (query) => {
    const url = new URL('https://api.wikitree.com/api.php')
    url.searchParams.set('action', 'searchPerson')
    url.searchParams.set('appId', 'parenthese')
    url.searchParams.set('FirstName', query.firstName)
    url.searchParams.set('LastName', query.lastName)
    if (query.birthYear) {
      url.searchParams.set('BirthDate', `${query.birthYear}-01-01`)
      url.searchParams.set('dateSpread', '2')
    }
    url.searchParams.set('limit', String(MAX_RESULTS))
    const payload = await fetchJson(url) as [{ matches?: WikiTreeMatch[] }] | undefined
    const matches = Array.isArray(payload) ? payload[0]?.matches ?? [] : []
    // La recherche de WikiTree est floue (« du Pont » pour Dupont, autres prénoms) : même nom de famille seulement
    const wantedLast = normalizeName(query.lastName).replace(/ /g, '')
    return matches.filter((match) => normalizeName(match.LastNameAtBirth ?? '').replace(/ /g, '') === wantedLast).map((match) => {
      const base: Omit<SearchResult, 'match'> = {
        id: String(match.Id),
        firstName: [match.FirstName, match.MiddleName].filter(Boolean).join(' '),
        lastName: match.LastNameAtBirth ?? '',
        sex: match.Gender === 'Male' ? 'M' : match.Gender === 'Female' ? 'F' : null,
        birth: { date: toIsoDate(match.BirthDate), place: match.BirthLocation || null },
        death: { date: toIsoDate(match.DeathDate), place: match.DeathLocation || null },
        url: `https://www.wikitree.com/wiki/${encodeURIComponent(match.Name)}`,
      }
      return { ...base, match: grade(query, base) }
    })
  },
}

const SOURCES: Source[] = [deces, wikitree]

// Sources allumées par l'opérateur, dans l'ordre de SOURCES ; un nom inconnu est signalé puis ignoré
export function enabledSearchSources(): string[] {
  const wanted = env.SEARCH_SOURCES.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  for (const name of wanted) {
    if (!SOURCES.some((source) => source.id === name)) console.warn(`SEARCH_SOURCES : source inconnue ignorée : ${name}`)
  }
  return SOURCES.filter((source) => wanted.includes(source.id)).map((source) => source.id)
}

export async function searchSource(id: string, query: SearchQuery): Promise<SearchResult[]> {
  const source = SOURCES.find((candidate) => candidate.id === id)
  if (!source) throw new SearchSourceUnavailableError('unknown_source')
  const results = await source.search(query)
  // Les meilleures concordances d'abord, l'ordre du service ensuite
  return results.slice(0, MAX_RESULTS).sort((a, b) => Number(b.match === 'good') - Number(a.match === 'good'))
}
