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
