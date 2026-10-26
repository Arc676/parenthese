// Langue de l'interface : français ou anglais.
//
// Le texte français sert de clé : t('Mot de passe incorrect.') renvoie la phrase telle quelle en
// français, et sa traduction du dictionnaire anglais (./en) en anglais. Une clé absente du
// dictionnaire retombe sur le français, jamais sur une chaîne vide.
//
// Variables entre accolades : t('{n} personnes', { n: 3 }).
//
// La langue est fixée au chargement de la page : choix mémorisé, sinon langue du navigateur.
// Changer de langue recharge la page, ce qui permet d'appeler t() partout, y compris hors React
// (dessin de l'arbre sur canvas, données de la démo, messages d'erreur).

import en from './en/index.js'

export const LOCALES = ['fr', 'en']
const STORAGE_KEY = 'pz-locale'

function detectLocale() {
  // ?lang=en dans l'adresse l'emporte (liens partagés vers la démo en anglais) et devient le choix mémorisé.
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (LOCALES.includes(fromUrl)) {
    try { window.localStorage.setItem(STORAGE_KEY, fromUrl) } catch { /* rien */ }
    return fromUrl
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (LOCALES.includes(stored)) return stored
  } catch { /* stockage indisponible : on suit le navigateur */ }
  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language])
  return languages.some((lang) => String(lang).toLowerCase().startsWith('fr')) ? 'fr' : 'en'
}

export const locale = typeof window === 'undefined' ? 'fr' : detectLocale()

// Pour toLocaleDateString et consorts : la région du navigateur dans la langue de l'interface (en-US, fr-CA…),
// sinon fr-FR ou en-GB. Elle décide de l'ordre jour, mois, année et du séparateur (issue #152).
function regionalDateLocale() {
  const fallback = locale === 'fr' ? 'fr-FR' : 'en-GB'
  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language])
  const regional = languages.find((lang) => new RegExp(`^${locale}-[a-z]{2}$`, 'i').test(String(lang)))
  if (!regional) return fallback
  try { return Intl.DateTimeFormat.supportedLocalesOf(regional)[0] || fallback } catch { return fallback }
}
export const dateLocale = regionalDateLocale()

// Une date en chiffres dans cette région : ordre ('dmy', 'mdy' ou 'ymd') et séparateur (« / », « - », « . »)
export const dateFormat = (() => {
  try {
    const parts = new Intl.DateTimeFormat(dateLocale, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(Date.UTC(2026, 9, 25)))
    const order = parts.filter((p) => ['day', 'month', 'year'].includes(p.type)).map((p) => p.type[0]).join('')
    const sep = parts.find((p) => p.type === 'literal')?.value.trim() || '/'
    return ['dmy', 'mdy', 'ymd'].includes(order) ? { order, sep } : { order: 'dmy', sep: '/' }
  } catch { return { order: 'dmy', sep: '/' } }
})()

if (typeof document !== 'undefined') document.documentElement.lang = locale

const missing = new Set()

// Typographie française : espace fine insécable avant ? ! ;, insécable avant : et à l'intérieur
// des « », insécable entre un nombre (ou une variable) et son unité. Appliquée au texte avant le
// remplacement des variables, qui gardent leurs espaces (noms, adresses). Le dictionnaire anglais
// reste indexé sur le français tel qu'écrit dans le code.
const NNBSP = '\u202F'
const NBSP = '\u00A0'
const typoCache = new Map()
export function frenchTypography(text) {
  if (typeof text !== 'string') return text
  let out = typoCache.get(text)
  if (out !== undefined) return out
  out = text
    .replace(/(?<=[^\s\u00A0\u202F])[ \u00A0](?=[?!;])/g, NNBSP)
    .replace(/(?<=[^\s\u00A0\u202F])[ \u202F](?=:)/g, NBSP)
    .replace(/«[ \u202F]?(?!\u00A0)/g, `«${NBSP}`)
    .replace(/(?<!\u00A0)[ \u202F]?»/g, `${NBSP}»`)
    .replace(/(?<=[\d}]) (?=(?:%|€|km|kg|cm|mm|Mo|Go|Ko|ko|min|px|h)(?![\p{L}\d]))/gu, NBSP)
  typoCache.set(text, out)
  return out
}

export function t(fr, vars) {
  let text = locale === 'fr' ? frenchTypography(fr) : fr
  if (locale === 'en') {
    if (Object.prototype.hasOwnProperty.call(en, fr)) text = en[fr]
    else if (import.meta.env?.DEV && !missing.has(fr)) {
      missing.add(fr)
      console.warn(`[i18n] traduction anglaise manquante : ${JSON.stringify(fr)}`)
    }
  }
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
}

export function setLocale(next) {
  if (!LOCALES.includes(next) || next === locale) return
  // Passe par l'adresse, pour que le choix tienne même sans stockage local.
  const url = new URL(window.location.href)
  url.searchParams.set('lang', next)
  window.location.assign(url.toString())
}
