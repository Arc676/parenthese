// Langue de l'interface : français, anglais, ou toute langue déclarée dans LANGUAGES.
//
// Le texte français sert de clé : t('Mot de passe incorrect.') renvoie la phrase telle quelle en
// français, et sa traduction du dictionnaire de la langue (./en pour l'anglais) ailleurs. Une clé
// absente du dictionnaire retombe sur l'anglais, puis sur le français, jamais sur une chaîne vide.
//
// Variables entre accolades : t('{n} personnes', { n: 3 }).
//
// La langue est fixée au chargement de la page : choix mémorisé, sinon langue du navigateur.
// Changer de langue recharge la page, ce qui permet d'appeler t() partout, y compris hors React
// (dessin de l'arbre sur canvas, données de la démo, messages d'erreur).

import en from './en/index.js'
import de from './de/index.js'
import zh from './zh/index.js'

// Langues de l'interface, dans l'ordre du bouton de choix.
//   name : le nom de la langue écrit dans la langue même, il ne se traduit pas
//   region : la région des dates quand le navigateur n'en donne pas dans cette langue
//   dictionary : les traductions, indexées sur le français (aucune pour le français, qui sert de clé)
// Ajouter une langue : un dossier ./<code>/ sur le modèle de ./en, une ligne ici, et ses noms de
// liens de parenté dans utils/kinship (l'anglais sinon).
export const LANGUAGES = {
  fr: { name: 'Français', region: 'fr-FR' },
  en: { name: 'English', region: 'en-GB', dictionary: en },
  de: { name: 'Deutsch', region: 'de-DE', dictionary: de },
  zh: { name: '中文', region: 'zh-CN', dictionary: zh },
}
export const LOCALES = Object.keys(LANGUAGES)
// Langue de repli : celle d'un navigateur dont aucune langue n'est connue, et celle d'un texte
// pas encore traduit dans la langue choisie
export const FALLBACK_LOCALE = 'en'
const STORAGE_KEY = 'pz-locale'

const browserLanguages = () => (typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]))

// ?lang= dans l'adresse, sinon le choix mémorisé, sinon la première langue du navigateur que l'appli
// connaît, l'anglais mis à part : il sert de repli, et « en-US, fr » donne le français.
export function pickLocale({ fromUrl, stored, languages = [] } = {}) {
  if (LOCALES.includes(fromUrl)) return fromUrl
  if (LOCALES.includes(stored)) return stored
  const known = languages
    .map((lang) => String(lang).toLowerCase().split(/[-_]/)[0])
    .find((code) => code !== FALLBACK_LOCALE && LOCALES.includes(code))
  return known || FALLBACK_LOCALE
}

function detectLocale() {
  // ?lang=en dans l'adresse l'emporte (liens partagés vers la démo en anglais) et devient le choix mémorisé.
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (LOCALES.includes(fromUrl)) {
    try { window.localStorage.setItem(STORAGE_KEY, fromUrl) } catch { /* rien */ }
    return fromUrl
  }
  let stored = null
  try { stored = window.localStorage.getItem(STORAGE_KEY) } catch { /* stockage indisponible : on suit le navigateur */ }
  return pickLocale({ stored, languages: browserLanguages() })
}

export const locale = typeof window === 'undefined' ? 'fr' : detectLocale()

// Pour toLocaleDateString et consorts : la région du navigateur dans la langue de l'interface (en-US, fr-CA…),
// sinon celle de LANGUAGES (fr-FR, en-GB…). Elle décide de l'ordre jour, mois, année et du séparateur (issue #152).
function regionalDateLocale() {
  const fallback = LANGUAGES[locale].region
  const regional = browserLanguages().find((lang) => new RegExp(`^${locale}-[a-z]{2}$`, 'i').test(String(lang)))
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
// remplacement des variables, qui gardent leurs espaces (noms, adresses). Les dictionnaires
// restent indexés sur le français tel qu'écrit dans le code.
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

const has = (dictionary, key) => Boolean(dictionary) && Object.prototype.hasOwnProperty.call(dictionary, key)

// Texte d'une clé dans une langue : son dictionnaire, sinon celui de la langue de repli, sinon le français
export function translate(lang, fr) {
  if (lang === 'fr') return frenchTypography(fr)
  const own = LANGUAGES[lang]?.dictionary
  if (has(own, fr)) return own[fr]
  if (import.meta.env?.DEV && !missing.has(fr)) {
    missing.add(fr)
    console.warn(`[i18n] traduction manquante (${lang}) : ${JSON.stringify(fr)}`)
  }
  const fallback = LANGUAGES[FALLBACK_LOCALE].dictionary
  return has(fallback, fr) ? fallback[fr] : fr
}

export function t(fr, vars) {
  const text = translate(locale, fr)
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
