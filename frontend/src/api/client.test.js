import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from './client.js'

// Clé d'idempotence : gardée tant que l'envoi n'a pas abouti, libérée par une réussite
const keysSent = []
const respond = (ok) => vi.fn(async (_url, init) => {
  keysSent.push(init.headers['Idempotency-Key'])
  if (ok === 'network') throw new TypeError('Failed to fetch')
  return { ok, status: ok ? 201 : 503, text: async () => '{}' }
})

afterEach(() => {
  keysSent.length = 0
  vi.unstubAllGlobals()
})

const send = (body = '{"a":1}') => apiRequest('/trees/t/annotation-photos', { method: 'POST', idempotent: true, body })

describe('apiRequest, envois idempotents', () => {
  it('un envoi refait après une coupure garde la même clé', async () => {
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
})
