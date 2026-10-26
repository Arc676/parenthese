// Saisie d'une date dans la fiche : une année seule (« 1950 ») ou une date complète (« 12/03/1950 »).
// L'année seule se range au 1er janvier, la convention de toute l'appli (issue #77).
// L'ordre et le séparateur suivent la région du navigateur : « 03/12/1950 » en en-US, « 1950-03-12 » en fr-CA
// (issue #152). Le mois s'écrit aussi en lettres, en français ou en anglais : « 12 mars 1950 », « March 12, 1950 ».
import { dateFormat } from '../i18n/index.js'

const pad = (n) => String(n).padStart(2, '0')

// Valeur stockée (« 1950-01-01 », « 1950 », « 1950-03-12 ») vers le texte du champ
export function dateToInputText(value, { order, sep } = dateFormat) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const full = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (full) {
    const [, y, m, d] = full
    if (m === '01' && d === '01') return y
    const parts = { d, m, y }
    return order.split('').map((k) => parts[k]).join(sep)
  }
  const year = raw.match(/^(\d{4})$/)
  return year ? year[1] : raw
}

// Chiffres seuls au-delà d'une année (5 à 8 chiffres) : on pose les séparateurs, « 12031950 » → « 12/03/1950 »
export function formatDigitsAsDate(text, { order, sep } = dateFormat) {
  const raw = String(text ?? '')
  if (!/^\d{5,8}$/.test(raw)) return raw
  if (order === 'ymd') return [raw.slice(0, 4), raw.slice(4, 6), raw.slice(6)].filter(Boolean).join(sep)
  return `${raw.slice(0, 2)}${sep}${raw.slice(2, 4)}${sep}${raw.slice(4)}`
}

// Noms des mois sans accents, en minuscules, dans les deux langues de l'appli
const MONTHS = [
  ['janvier', 'january'], ['fevrier', 'february'], ['mars', 'march'], ['avril', 'april'], ['mai', 'may'], ['juin', 'june'],
  ['juillet', 'july'], ['aout', 'august'], ['septembre', 'september'], ['octobre', 'october'], ['novembre', 'november'], ['decembre', 'december'],
]
const normalize = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// « juin », « June », « sept. », « févr » : un mois si le mot (3 lettres au moins) n'en désigne qu'un
function monthFromWord(word) {
  const w = normalize(word).replace(/\.$/, '')
  if (w.length < 3 || !/^[a-z]+$/.test(w)) return undefined
  const found = new Set(MONTHS.flatMap((names, i) => (names.some((n) => n.startsWith(w)) ? [i + 1] : [])))
  return found.size === 1 ? [...found][0] : undefined
}

// « 12 juin 1950 », « 1er juin 1950 », « June 12, 1950 », « 12 June 1950 »
function parseWritten(raw) {
  const words = raw.replace(/,/g, ' ').replace(/\b(\d{1,2})(er|st|nd|rd|th)\b/gi, '$1').split(/\s+/).filter(Boolean)
  if (words.length !== 3 || !/^\d{4}$/.test(words[2])) return undefined
  const [a, b, year] = words
  if (/^\d{1,2}$/.test(a) && monthFromWord(b)) return { day: a, month: monthFromWord(b), year }
  if (monthFromWord(a) && /^\d{1,2}$/.test(b)) return { day: b, month: monthFromWord(a), year }
  return undefined
}

// Texte du champ vers la valeur stockée : '' si vide, « AAAA-MM-JJ » si valable, undefined si on ne comprend pas
export function parseDateInput(text, { order } = dateFormat) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`
  let day
  let month
  let year
  const yearLast = raw.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/)
  const yearFirst = raw.match(/^(\d{4})[/.\-\s](\d{1,2})[/.\-\s](\d{1,2})$/)
  const written = yearLast || yearFirst ? undefined : parseWritten(raw)
  // Année en dernier : le mois d'abord seulement dans une région qui l'écrit ainsi (en-US)
  if (yearLast && order === 'mdy') [, month, day, year] = yearLast
  else if (yearLast) [, day, month, year] = yearLast
  else if (yearFirst) [, year, month, day] = yearFirst
  else if (written) ({ day, month, year } = written)
  else return undefined
  const d = Number(day)
  const m = Number(month)
  const y = Number(year)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined
  return `${year}-${pad(m)}-${pad(d)}`
}

// Une année seule (rangée au 1er janvier) se lit « 1950 », pas « 1 janvier 1950 »
export const isYearOnly = (value) => /^\d{4}(-01-01)?$/.test(String(value ?? '').slice(0, 10))
