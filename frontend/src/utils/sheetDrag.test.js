import { describe, expect, it } from 'vitest'
import {
  NO_DRAG_SELECTOR,
  RUBBER_MAX_PX,
  canStartSheetDrag,
  shouldCloseSheet,
  sheetDragIntent,
  sheetOffset,
  velocityBetween,
} from './sheetDrag'

const ZONE = '.pc-grab, .pc-head, .pc-close'

// Cible factice : `closest` ne répond que pour la zone et les champs demandés
function target({ inZone = true, inField = false } = {}) {
  return {
    closest(selector) {
      if (selector === ZONE) return inZone ? {} : null
      if (selector === NO_DRAG_SELECTOR) return inField ? {} : null
      return null
    },
  }
}

describe('canStartSheetDrag (zones autorisées)', () => {
  it('part de la poignée, de l\'en-tête ou de la croix', () => {
    expect(canStartSheetDrag(target(), ZONE)).toBe(true)
  })

  it('ne part pas du contenu hors zone (onglets, sections)', () => {
    expect(canStartSheetDrag(target({ inZone: false }), ZONE)).toBe(false)
  })

  it('ne part jamais d\'un champ de saisie ou d\'un libellé de l\'en-tête', () => {
    expect(canStartSheetDrag(target({ inField: true }), ZONE)).toBe(false)
  })

  it('ne part pas pendant une sélection de texte', () => {
    expect(canStartSheetDrag(target(), ZONE, 'Marie')).toBe(false)
    expect(canStartSheetDrag(target(), ZONE, '')).toBe(true)
  })

  it('refuse une cible sans closest (pas un élément DOM)', () => {
    expect(canStartSheetDrag(null, ZONE)).toBe(false)
    expect(canStartSheetDrag({}, ZONE)).toBe(false)
  })
})

describe('sheetDragIntent (direction)', () => {
  it('attend un mouvement suffisant avant de trancher', () => {
    expect(sheetDragIntent(0, 0)).toBe('pending')
    expect(sheetDragIntent(3, 5)).toBe('pending')
  })

  it('reconnaît un glisser vers le bas', () => {
    expect(sheetDragIntent(0, 20)).toBe('down')
    expect(sheetDragIntent(10, 20)).toBe('down')
  })

  it('reconnaît un glisser vers le haut', () => {
    expect(sheetDragIntent(0, -20)).toBe('up')
    expect(sheetDragIntent(-10, -20)).toBe('up')
  })

  it('rejette l\'horizontal', () => {
    expect(sheetDragIntent(30, 20)).toBe('other')
    expect(sheetDragIntent(-30, -20)).toBe('other')
  })
})

describe('sheetOffset (résistance au-dessus du repos)', () => {
  it('suit le doigt vers le bas', () => {
    expect(sheetOffset(0)).toBe(0)
    expect(sheetOffset(120)).toBe(120)
  })

  it('cède de moins en moins vers le haut, sans dépasser le plafond', () => {
    const a = sheetOffset(-60)
    const b = sheetOffset(-120)
    const c = sheetOffset(-2000)
    expect(a).toBeLessThan(0)
    expect(b).toBeLessThan(a)
    expect(-b).toBeLessThan(120)
    expect(b - c).toBeLessThan(0 - b)
    expect(c).toBeGreaterThan(-RUBBER_MAX_PX)
  })
})

describe('shouldCloseSheet (seuil et vitesse)', () => {
  it('ferme au-delà d\'un tiers de la hauteur', () => {
    expect(shouldCloseSheet({ offset: 100, height: 300 })).toBe(true)
    expect(shouldCloseSheet({ offset: 99, height: 300 })).toBe(false)
  })

  it('ferme sur un lâcher rapide vers le bas, même petit', () => {
    expect(shouldCloseSheet({ offset: 30, height: 600, velocity: 0.7 })).toBe(true)
  })

  it('ne ferme pas sur un lâcher rapide mais trop court', () => {
    expect(shouldCloseSheet({ offset: 10, height: 600, velocity: 2 })).toBe(false)
  })

  it('ne ferme pas sur une course lente et courte', () => {
    expect(shouldCloseSheet({ offset: 60, height: 600, velocity: 0.1 })).toBe(false)
  })

  it('ne ferme jamais sans déplacement vers le bas', () => {
    expect(shouldCloseSheet({ offset: 0, height: 300, velocity: 5 })).toBe(false)
  })
})

describe('velocityBetween', () => {
  it('donne la vitesse vers le bas en px/ms', () => {
    expect(velocityBetween({ y: 100, t: 0 }, { y: 160, t: 60 })).toBe(1)
  })

  it('est nulle si les points manquent, ne se suivent pas ou sont trop espacés', () => {
    expect(velocityBetween(null, { y: 1, t: 1 })).toBe(0)
    expect(velocityBetween({ y: 0, t: 10 }, { y: 50, t: 10 })).toBe(0)
    expect(velocityBetween({ y: 0, t: 0 }, { y: 50, t: 500 })).toBe(0)
  })
})
