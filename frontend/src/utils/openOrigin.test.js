import { describe, expect, it } from 'vitest'
import { growFromTransform, rememberOrigin, takeOrigin } from './openOrigin'

const element = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height }) })

describe('rememberOrigin / takeOrigin', () => {
  it('rend l\'origine une seule fois', () => {
    rememberOrigin(element(10, 20, 100, 100), 1000)
    expect(takeOrigin(1100)).toMatchObject({ left: 10, top: 20, width: 100 })
    expect(takeOrigin(1100)).toBe(null)
  })

  it('oublie une origine trop vieille', () => {
    rememberOrigin(element(10, 20, 100, 100), 1000)
    expect(takeOrigin(2500)).toBe(null)
  })

  it('ne retient rien sans élément mesurable', () => {
    rememberOrigin(null, 1000)
    expect(takeOrigin(1000)).toBe(null)
  })
})

describe('growFromTransform', () => {
  const viewport = { width: 1000, height: 800 }

  it('pose la carte sur la vignette : même centre, même largeur', () => {
    // Vignette de 72 px centrée en (136, 636), carte de 720 px centrée dans l'écran
    expect(growFromTransform({ left: 100, top: 600, width: 72, height: 72 }, 720, viewport))
      .toEqual({ transform: 'translate(-364px, 236px) scale(0.1)', origin: '50% 50%' })
  })

  it('fenêtre collée en bas : pose le bord bas de la carte sur celui de la vignette', () => {
    // Vignette de 72 px, bord bas à 672 ; écran de 800 px de haut
    expect(growFromTransform({ left: 100, top: 600, width: 72, height: 72 }, 720, viewport, 'bottom'))
      .toEqual({ transform: 'translate(-364px, -128px) scale(0.1)', origin: '50% 100%' })
  })

  it('ne part de rien sans origine ou sans largeur', () => {
    expect(growFromTransform(null, 720, viewport)).toBe(null)
    expect(growFromTransform({ left: 0, top: 0, width: 72, height: 72 }, 0, viewport)).toBe(null)
    expect(growFromTransform({ left: 0, top: 0, width: 0, height: 0 }, 720, viewport)).toBe(null)
  })
})
