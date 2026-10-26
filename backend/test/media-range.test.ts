import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../src/lib/media-files.js'

// Plages demandées par les navigateurs pour lire une vidéo (Safari ne lit rien sans elles)
describe('parseByteRange', () => {
  it('lit les plages que demandent Safari et Chrome', () => {
    expect(parseByteRange('bytes=0-1', 1000)).toEqual({ start: 0, end: 1 })
    expect(parseByteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseByteRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('borne la fin à la taille du fichier', () => {
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('refuse une plage hors du fichier', () => {
    expect(parseByteRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=5-2', 1000)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-5', 0)).toBe('unsatisfiable')
  })

  it('envoie tout sans plage lisible', () => {
    expect(parseByteRange(undefined, 1000)).toBeNull()
    expect(parseByteRange('bytes=-', 1000)).toBeNull()
    expect(parseByteRange('bytes=0-1,5-9', 1000)).toBeNull()
    expect(parseByteRange('items=0-1', 1000)).toBeNull()
  })
})
