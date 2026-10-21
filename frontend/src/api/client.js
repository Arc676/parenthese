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

async function apiRequest(path, options = {}) {
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options
  const providedHeaders = options.headers || {}
  const hasExplicitContentType = Object.keys(providedHeaders).some((key) => key.toLowerCase() === 'content-type')

  const headers = {
    ...(options.body !== undefined && !hasExplicitContentType ? { 'Content-Type': 'application/json' } : {}),
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

  return payload
}

export { ApiError, API_BASE_URL, apiRequest }
