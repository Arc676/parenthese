import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadImmichMemory, fetchImmichAsset, listImmichAssets } from './immichApi.js'

afterEach(() => vi.unstubAllGlobals())
describe('Recherche et aperçus Immich', () => {
  it('importe une photo HEIC via la preview et adapte son nom au JPEG reçu', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('jpeg', { headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const file = await downloadImmichMemory('tree', { id: 'photo', name: 'IMG_1234.HEIC', type: 'IMAGE' }, 'token', controller.signal)
    expect(fetch.mock.calls[0][0]).toMatch(/\/assets\/photo\/preview$/)
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
    expect(file.name).toBe('IMG_1234.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(await file.text()).toBe('jpeg')
  })
  it('importe la vidéo originale sans changer son nom', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('video', { headers: { 'content-type': 'video/quicktime' } }))
    vi.stubGlobal('fetch', fetch)
    const file = await downloadImmichMemory('tree', { id: 'video', name: 'film.MOV', type: 'VIDEO' }, 'token')
    expect(fetch.mock.calls[0][0]).toMatch(/\/assets\/video\/original$/)
    expect(file.name).toBe('film.MOV')
    expect(file.type).toBe('video/quicktime')
  })
  it('refuse une réponse vidéo pour une photo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('heic', { headers: { 'content-type': 'video/mp4' } })))
    await expect(downloadImmichMemory('tree', { id: 'photo', type: 'IMAGE' }, 'token')).rejects.toMatchObject({ payload: { error: 'invalid_immich_media' } })
  })
  it('encode le contexte et conserve le visage, la page et l’annulation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"assets":[],"hasNextPage":false}'))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    await listImmichAssets('arbre/1', 'token', 3, 'IMAGE', { query: ' été & mer ', personId: 'face-1', signal: controller.signal })
    const [url, options] = fetch.mock.calls[0]
    const parsed = new URL(url, 'http://localhost')
    expect(parsed.pathname).toContain('arbre%2F1')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ page: '3', type: 'IMAGE', q: 'été & mer', personId: 'face-1' })
    expect(options.signal).toBe(controller.signal)
    expect(options.headers.Authorization).toBe('Bearer token')
  })
  it('ouvre un aperçu sans télécharger l’original', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetch)
    const blob = await fetchImmichAsset('tree', 'photo', 'token', 'preview')
    expect(fetch.mock.calls[0][0]).toMatch(/\/assets\/photo\/preview$/)
    expect(blob.type).toBe('image/jpeg')
  })
})
