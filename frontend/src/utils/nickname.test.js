import { describe, expect, it } from 'vitest'
import { fitNickname } from './nickname.js'

// Mesure fictive : 7 px par caractère, suffisant pour tester la règle de coupe
const ctx = { measureText: (text) => ({ width: text.length * 7 }) }

describe('fitNickname', () => {
  it('garde le surnom entier quand il tient', () => {
    expect(fitNickname(ctx, 'Loulou', 150)).toBe('Loulou')
  })

  it('coupe avec … sans dépasser la largeur', () => {
    const out = fitNickname(ctx, 'Tonton Jojo de Brive', 70)
    expect(out.endsWith('…')).toBe(true)
    expect(ctx.measureText(out).width).toBeLessThanOrEqual(70)
  })
})
