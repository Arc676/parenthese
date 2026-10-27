import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiRequest } from './client'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('une requête qui ne répond pas finit en erreur lisible', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('trop long', 'TimeoutError')))
    await expect(apiRequest('/trees')).rejects.toMatchObject({
      name: 'ApiError', message: 'Le serveur ne répond pas. Vérifiez la connexion et réessayez.', status: 0, payload: { error: 'request_timeout' },
    })
    expect(timeout).toHaveBeenCalledWith(30_000)
  })

  it('un envoi de fichier a plus de temps, et un délai demandé passe devant', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"ok":true}', { status: 200 })))
    await apiRequest('/upload', { method: 'POST', body: 'x'.repeat(200_000) })
    expect(timeout).toHaveBeenLastCalledWith(5 * 60_000)
    await apiRequest('/import', { method: 'POST', body: '{}', timeoutMs: 1234 })
    expect(timeout).toHaveBeenLastCalledWith(1234)
    expect(fetch.mock.calls[1][1]).not.toHaveProperty('timeoutMs')
  })

  it('une autre panne réseau remonte telle quelle', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await apiRequest('/trees').catch((e) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect(error).not.toBeInstanceOf(ApiError)
  })
})

// Clé d'idempotence : gardée tant que l'envoi n'a pas abouti, libérée par une réussite
describe('apiRequest, envois idempotents', () => {
  const keysSent = []
  const respond = (ok) => vi.fn(async (_url, init) => {
    keysSent.push(init.headers['Idempotency-Key'])
    if (ok === 'network') throw new TypeError('Failed to fetch')
    return new Response('{}', { status: ok ? 201 : 503 })
  })
  const send = (body = '{"a":1}') => apiRequest('/trees/t/annotation-photos', { method: 'POST', idempotent: true, body })

  afterEach(() => {
    keysSent.length = 0
  })

  it('un envoi refait après une coupure ou une erreur garde la même clé', async () => {
    vi.stubGlobal('fetch', respond('network'))
    await expect(send()).rejects.toThrow()
    vi.stubGlobal('fetch', respond(false))
    await expect(send()).rejects.toThrow()
    vi.stubGlobal('fetch', respond(true))
    await send()
    expect(keysSent).toHaveLength(3)
    expect(new Set(keysSent).size).toBe(1)
    expect(keysSent[0]).toMatch(/^[0-9a-f]{32}$/)
  })

  it('après une réussite, le même contenu repart avec une clé neuve', async () => {
    vi.stubGlobal('fetch', respond(true))
    await send('{"b":2}')
    await send('{"b":2}')
    expect(keysSent[0]).not.toBe(keysSent[1])
  })

  it('un autre contenu a sa propre clé, et un appel ordinaire n’en envoie pas', async () => {
    vi.stubGlobal('fetch', respond('network'))
    await expect(send('{"c":3}')).rejects.toThrow()
    await expect(send('{"c":4}')).rejects.toThrow()
    await expect(apiRequest('/trees/t', { method: 'POST', body: '{}' })).rejects.toThrow()
    expect(keysSent[0]).not.toBe(keysSent[1])
    expect(keysSent[2]).toBeUndefined()
  })

  it('l’option idempotent ne part pas dans fetch', async () => {
    vi.stubGlobal('fetch', respond(true))
    await send('{"d":5}')
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('idempotent')
  })
})
