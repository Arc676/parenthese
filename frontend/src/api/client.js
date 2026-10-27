import { t } from '../i18n/index.js'

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL
const defaultApiBaseUrl = import.meta.env.DEV ? 'http://localhost:4000' : ''
const API_BASE_URL = (rawApiBaseUrl ?? defaultApiBaseUrl).replace(/\/$/, '')

class ApiError extends Error {
  constructor(message, status, payload = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

async function safeParseJson(text) {
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Sans limite, un réseau mobile qui décroche laisse l'arbre « en chargement » pour toujours.
// Un corps de plus de 100 Ko est un envoi de fichier : il a plus de temps sur une connexion lente.
const DEFAULT_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 5 * 60_000
const LARGE_BODY_CHARS = 100_000

function timeoutSignal(options) {
  if (options.signal) return options.signal
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined
  const isLargeBody = typeof options.body === 'string' && options.body.length > LARGE_BODY_CHARS
  return AbortSignal.timeout(options.timeoutMs ?? (isLargeBody ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS))
}

// Envois sans doublon (backend/src/lib/idempotency.ts). Un envoi qui n'a pas abouti (délai dépassé, réseau coupé,
// erreur) garde sa clé, et le même envoi refait (même adresse, même contenu) la réutilise : si le premier avait en
// fait abouti, le serveur renvoie sa réponse au lieu de tout recréer. Une réussite libère la clé, et renvoyer le même
// contenu plus tard (un souvenir supprimé puis remis) est un nouvel envoi.
const unsettledKeys = new Map()

// Empreinte rapide du contenu (cyrb53) : crypto.subtle n'existe pas hors HTTPS (auto-hébergement en réseau local)
function fingerprint(text) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${text.length}:${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`
}

// getRandomValues existe aussi hors HTTPS, contrairement à crypto.randomUUID
function newIdempotencyKey() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function apiRequest(path, options = {}) {
  const { timeoutMs: _timeoutMs, idempotent = false, ...fetchOptions } = options
  const providedHeaders = options.headers || {}
  const hasExplicitContentType = Object.keys(providedHeaders).some((key) => key.toLowerCase() === 'content-type')

  const print = idempotent ? `${path}|${fingerprint(typeof options.body === 'string' ? options.body : '')}` : null
  if (print && !unsettledKeys.has(print)) unsettledKeys.set(print, newIdempotencyKey())

  const headers = {
    ...(options.body !== undefined && !hasExplicitContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(print ? { 'Idempotency-Key': unsettledKeys.get(print) } : {}),
    ...providedHeaders,
  }

  let response
  let text
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal: timeoutSignal(options),
    })
    text = await response.text()
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ApiError(t('Le serveur ne répond pas. Vérifiez la connexion et réessayez.'), 0, { error: 'request_timeout' })
    }
    throw error
  }
  const payload = await safeParseJson(text)

  if (!response.ok) {
    throw new ApiError(payload?.error || `request_failed_${response.status}`, response.status, payload)
  }
  if (print) unsettledKeys.delete(print)

  return payload
}

export { ApiError, API_BASE_URL, apiRequest }
