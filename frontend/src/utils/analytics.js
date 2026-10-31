let ph = null
let initStarted = false
let enabled = false
const queuedEvents = []
const MAX_QUEUED_EVENTS = 100

function flushQueue() {
  if (!ph) return
  while (queuedEvents.length > 0) {
    const next = queuedEvents.shift()
    if (next.type === 'identify' && typeof ph.identify === 'function') {
      ph.identify(next.distinctId, next.properties)
      continue
    }
    if (next.type === 'reset' && typeof ph.reset === 'function') {
      ph.reset()
      continue
    }
    if (next.type === 'capture' && typeof ph.capture === 'function') {
      ph.capture(next.eventName, next.properties)
    }
  }
}

// L'adresse d'un arbre (/arbre/<slug>) vaut clé d'accès en lecture : elle ne quitte jamais le
// navigateur. Toute chaîne envoyée à PostHog ($current_url, $pathname, $referrer,
// $initial_current_url, $session_entry_url, propriétés de personne...) est réécrite en /arbre/:slug.
const TREE_PATH_RE = /\/arbre\/[^/?#\s]+/g
const TREE_PATH_ENCODED_RE = /%2Farbre%2F(?:(?!%2F|%3F|%23)[^&#\s])+/gi

export function scrubTreeSlug(value) {
  if (typeof value === 'string') {
    return value
      .replace(TREE_PATH_RE, '/arbre/:slug')
      .replace(TREE_PATH_ENCODED_RE, '%2Farbre%2F%3Aslug')
  }
  if (Array.isArray(value)) return value.map(scrubTreeSlug)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = scrubTreeSlug(v)
    return out
  }
  return value
}

export function scrubAnalyticsEvent(event) {
  if (!event) return event
  const next = { ...event }
  if (next.properties) next.properties = scrubTreeSlug(next.properties)
  if (next.$set) next.$set = scrubTreeSlug(next.$set)
  if (next.$set_once) next.$set_once = scrubTreeSlug(next.$set_once)
  return next
}

// Source d'arrivée (?source=hn, landing, app-shared...) : lue une fois à l'ouverture et gardée sur
// l'appareil, pour que l'inscription dise d'où vient le visiteur même après quelques clics.
// La première source connue gagne, « direct » ne remplace jamais une vraie source.
const SOURCE_KEY = 'parenthese_source'

// fallback : source donnée par l'app quand l'adresse n'en porte pas (arbre-partage, demo), au même rang
export function rememberSource(fallback = '') {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('source') || fallback
    const clean = String(fromUrl || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)
    if (clean && clean !== 'direct' && !localStorage.getItem(SOURCE_KEY)) {
      localStorage.setItem(SOURCE_KEY, clean)
    }
  } catch {
    // Stockage indisponible : l'inscription partira sans source
  }
}

export function getSource() {
  try {
    return localStorage.getItem(SOURCE_KEY) || 'direct'
  } catch {
    return 'direct'
  }
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase()
}

export function initAppAnalytics() {
  if (initStarted) return
  initStarted = true
  rememberSource()

  const key = import.meta.env.VITE_POSTHOG_KEY
  if (!key) return

  enabled = true
  import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
        cross_subdomain_cookie: true,
        defaults: '2026-01-30',
        person_profiles: 'identified_only',
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
        // Aucun feature flag dans le code. Sans ça, /flags recevrait les propriétés de personne
        // ($initial_current_url...), que before_send ne voit pas.
        advanced_disable_flags: true,
        // Verrouillé dans le code plutôt que laissé au tableau de bord PostHog : clics morts, cartes de chaleur
        // et exceptions enverraient le texte des éléments (des noms de la famille) ou des messages d'erreur, que
        // before_send ne nettoie pas. Aucun script externe (replay, sondages, site apps), la CSP n'en autorise pas.
        capture_dead_clicks: false,
        capture_heatmaps: false,
        capture_exceptions: false,
        capture_performance: false,
        rageclick: false,
        disable_surveys: true,
        disable_product_tours: true,
        disable_web_experiments: true,
        disable_external_dependency_loading: true,
        before_send: scrubAnalyticsEvent,
      })
      ph = posthog
      flushQueue()
    })
    .catch(() => {
      enabled = false
      queuedEvents.length = 0
    })
}

function fnv1aHash(input) {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

export function toOpaqueTreeId(treeId) {
  if (!treeId) return ''
  return fnv1aHash(String(treeId))
}

export function toJourneyRole(rawRole) {
  const role = normalizeRole(rawRole)
  if (role === 'visitor') return 'visitor'
  if (role === 'contributor') return 'contributor_anon'
  return null
}

export function toInteractionMediaType(rawType) {
  const type = String(rawType || '').trim().toLowerCase()
  if (type === 'photo') return 'photo'
  if (type === 'video') return 'video'
  return 'text'
}

export function trackAppEvent(eventName, properties = {}) {
  if (!eventName) return

  if (ph && typeof ph.capture === 'function') {
    ph.capture(eventName, properties)
    return
  }

  if (!enabled) return
  if (queuedEvents.length >= MAX_QUEUED_EVENTS) return
  queuedEvents.push({ type: 'capture', eventName, properties })
}

export function identifyUser(distinctId, properties = {}) {
  const normalizedDistinctId = String(distinctId || '').trim()
  if (!normalizedDistinctId) return

  if (ph && typeof ph.identify === 'function') {
    ph.identify(normalizedDistinctId, properties)
    return
  }

  if (!enabled) return
  if (queuedEvents.length >= MAX_QUEUED_EVENTS) return
  queuedEvents.push({ type: 'identify', distinctId: normalizedDistinctId, properties })
}

export function resetUser() {
  if (ph && typeof ph.reset === 'function') {
    ph.reset()
    return
  }

  if (!enabled) return
  if (queuedEvents.length >= MAX_QUEUED_EVENTS) return
  queuedEvents.push({ type: 'reset' })
}
