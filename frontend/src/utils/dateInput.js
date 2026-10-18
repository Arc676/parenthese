// Saisie d'une date dans la fiche : une année seule (« 1950 ») ou une date complète (« 12/03/1950 »).
// L'année seule se range au 1er janvier, la convention de toute l'appli (issue #77).

const pad = (n) => String(n).padStart(2, '0')

// Valeur stockée (« 1950-01-01 », « 1950 », « 1950-03-12 ») vers le texte du champ
export function dateToInputText(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const full = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (full) return full[2] === '01' && full[3] === '01' ? full[1] : `${full[3]}/${full[2]}/${full[1]}`
  const year = raw.match(/^(\d{4})$/)
  return year ? year[1] : raw
}

// Chiffres seuls au-delà d'une année (5 à 8 chiffres) : on pose les barres, « 12031950 » → « 12/03/1950 »
export function formatDigitsAsDate(text) {
  const raw = String(text ?? '')
  if (!/^\d{5,8}$/.test(raw)) return raw
  return `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`
}

// Texte du champ vers la valeur stockée : '' si vide, « AAAA-MM-JJ » si valable, undefined si on ne comprend pas
export function parseDateInput(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`
  let day
  let month
  let year
  const dmy = raw.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/)
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dmy) [, day, month, year] = dmy
  else if (iso) [, year, month, day] = iso
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
