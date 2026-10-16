// Dates GEDCOM : « 15 JAN 1900 », mais aussi « ABT 1900 » (vers), « BEF », « AFT », « BET 1794 AND 1796 »,
// « FROM … TO … », « INT 1900 (texte) », les doubles années « 12 FEB 1700/01 », le calendrier julien
// (« @#DJULIAN@ 1563 ») et le calendrier républicain (« @#DFRENCH R@ 18 BRUM 8 », converti en grégorien).
// On renvoie une date ISO (année, année-mois ou jour), sa précision et le texte d'origine.

export type GedcomDatePrecision = 'exact' | 'about' | 'estimated' | 'calculated' | 'before' | 'after' | 'between' | 'from' | 'to' | 'interpreted'

export type ParsedGedcomDate = {
  iso: string
  precision: GedcomDatePrecision
  endIso: string | null
  text: string
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

// Calendrier républicain : début de chaque année (an I à XIV), années sextiles III, VII et XI
const FRENCH_YEAR_START: Record<number, string> = {
  1: '1792-09-22', 2: '1793-09-22', 3: '1794-09-22', 4: '1795-09-23', 5: '1796-09-22', 6: '1797-09-22',
  7: '1798-09-22', 8: '1799-09-23', 9: '1800-09-23', 10: '1801-09-23', 11: '1802-09-23', 12: '1803-09-24',
  13: '1804-09-23', 14: '1805-09-23',
}
const FRENCH_MONTHS: Record<string, number> = {
  VEND: 1, BRUM: 2, FRIM: 3, NIVO: 4, PLUV: 5, VENT: 6, GERM: 7, FLOR: 8, PRAI: 9, MESS: 10, THER: 11, FRUC: 12, COMP: 13,
}

const pad = (n: number) => String(n).padStart(2, '0')

function frenchToIso(day: number | null, month: number | null, year: number): string | null {
  const start = FRENCH_YEAR_START[year]
  if (!start) return null
  if (!month) return start.slice(0, 4)
  const offset = (month - 1) * 30 + ((day ?? 1) - 1)
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  const iso = date.toISOString().slice(0, 10)
  return day ? iso : iso.slice(0, 7)
}

// Une date simple, après le qualificatif : jour, mois, année, avec son calendrier
function parseSimple(raw: string): string | null {
  let text = raw.trim().toUpperCase()
  let calendar = 'GREGORIAN'
  const escape = text.match(/^@#D([A-Z ]+?)@\s*/)
  if (escape) {
    calendar = escape[1].trim()
    text = text.slice(escape[0].length)
  }
  text = text.replace(/\s+B\.?C\.?$/, '').trim()
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 3) return null

  if (calendar === 'FRENCH R') {
    const year = Number(parts[parts.length - 1])
    const month = parts.length >= 2 ? FRENCH_MONTHS[parts[parts.length - 2]] ?? null : null
    const day = parts.length === 3 ? Number(parts[0]) : null
    if (!Number.isInteger(year) || (parts.length >= 2 && !month) || (day !== null && !(day >= 1 && day <= 30))) return null
    return frenchToIso(day, month, year)
  }
  if (calendar !== 'GREGORIAN' && calendar !== 'JULIAN') return null

  // Double année : « 1700/01 » = 1701 en style moderne
  const yearMatch = parts[parts.length - 1].match(/^(\d{3,4})(?:\/(\d{1,2}))?$/)
  if (!yearMatch) return null
  let year = Number(yearMatch[1])
  if (yearMatch[2]) {
    const suffix = yearMatch[2]
    year = Number(String(year).slice(0, String(year).length - suffix.length) + suffix)
    if (year < Number(yearMatch[1])) year += 10 ** suffix.length
  }
  const yearText = String(year).padStart(4, '0')
  if (parts.length === 1) return yearText
  const month = MONTHS[parts[parts.length - 2]]
  if (!month) return null
  if (parts.length === 2) return `${yearText}-${pad(month)}`
  const day = Number(parts[0])
  if (!(day >= 1 && day <= 31)) return null
  return `${yearText}-${pad(month)}-${pad(day)}`
}

export function parseGedcomDate(value: string | null | undefined): ParsedGedcomDate | null {
  const text = (value ?? '').trim()
  if (!text) return null
  const upper = text.toUpperCase()

  const range = upper.match(/^BET\s+(.+?)\s+AND\s+(.+)$/) ?? upper.match(/^FROM\s+(.+?)\s+TO\s+(.+)$/)
  if (range) {
    const iso = parseSimple(range[1])
    const endIso = parseSimple(range[2])
    if (!iso && !endIso) return null
    return { iso: (iso ?? endIso)!, endIso: iso ? endIso : null, precision: upper.startsWith('BET') ? 'between' : 'from', text }
  }

  const qualifiers: Record<string, GedcomDatePrecision> = {
    ABT: 'about', EST: 'estimated', CAL: 'calculated', BEF: 'before', AFT: 'after', FROM: 'from', TO: 'to', INT: 'interpreted',
  }
  const qualified = upper.match(/^(ABT|EST|CAL|BEF|AFT|FROM|TO|INT)\.?\s+(.+)$/)
  if (qualified) {
    const rest = qualified[1] === 'INT' ? qualified[2].replace(/\s*\(.*\)\s*$/, '') : qualified[2]
    const iso = parseSimple(rest)
    return iso ? { iso, endIso: null, precision: qualifiers[qualified[1]], text } : null
  }

  const iso = parseSimple(upper.replace(/\s*\(.*\)\s*$/, ''))
  return iso ? { iso, endIso: null, precision: 'exact', text } : null
}
