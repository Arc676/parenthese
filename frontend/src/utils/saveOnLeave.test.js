import { describe, expect, it, vi } from 'vitest'
import { runOnce } from './saveOnLeave.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('runOnce (enregistrement de fiche)', () => {
  it('un second appel pendant l’envoi reçoit le même résultat, sans second envoi', async () => {
    const ref = { current: null }
    const send = vi.fn(async () => { await tick(); return 'saved' })
    const first = runOnce(ref, send)
    const second = runOnce(ref, send)
    expect(second).toBe(first)
    expect(await first).toBe('saved')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('une fois l’envoi terminé, un nouvel appel enregistre à nouveau (nouvelle modification)', async () => {
    const ref = { current: null }
    const send = vi.fn(async () => 'saved')
    await runOnce(ref, send)
    expect(ref.current).toBeNull()
    await runOnce(ref, send)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('un échec se propage au résultat et libère le verrou pour une nouvelle tentative', async () => {
    const ref = { current: null }
    const send = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('réseau') })
      .mockImplementationOnce(async () => 'saved')
    await expect(runOnce(ref, send)).rejects.toThrow('réseau')
    expect(ref.current).toBeNull()
    expect(await runOnce(ref, send)).toBe('saved')
  })
})
