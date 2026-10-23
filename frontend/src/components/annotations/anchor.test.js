import { describe, it, expect } from 'vitest'
import { anchorLegacy, layoutCenters, nearestAnchor, placeAnnotations, readAnchor, withAnchor } from './anchor'

// Portrait de 100 × 100 posé en (x, y) : centre en (x + 50, y + 50)
const node = (personId, x, y) => ({ id: `p-${personId}`, _type: 'person', _data: { id: personId }, x, y, width: 100, height: 100 })

// Deux onglets d'un même arbre : a et b dans la famille Combro, c et d dans la famille des Bois,
// b est la charnière (dessinée des deux côtés, ailleurs à chaque fois)
const combro = { children: [node('a', 0, 0), node('b', 300, 0), { id: 'u-1', _type: 'union', x: 200, y: 40, width: 10, height: 10 }] }
const desBois = { children: [node('b', 900, 500), node('c', 1200, 500), node('d', 1500, 500)] }

describe('ancrage des annotations', () => {
  it('rattache à la personne la plus proche, avec le décalage à son portrait', () => {
    expect(nearestAnchor(30, -40, layoutCenters(combro))).toEqual({ personId: 'a', dx: -20, dy: -90 })
    expect(nearestAnchor(330, 60, layoutCenters(combro))).toEqual({ personId: 'b', dx: -20, dy: 10 })
    expect(nearestAnchor(0, 0, new Map())).toBeNull()
  })

  it('ne compte que les personnes et suit le glissement d’un portrait en cours', () => {
    const centers = layoutCenters(combro, new Map([['p-a', { x: 40 }]]))
    expect([...centers.keys()]).toEqual(['a', 'b'])
    expect(centers.get('a')).toEqual({ cx: 90, cy: 50 })
  })

  it('garde les autres clés du style', () => {
    const style = withAnchor({ color: '#93402A', fontSize: 18 }, 30, -40, layoutCenters(combro))
    expect(style).toEqual({ color: '#93402A', fontSize: 18, anchor: { personId: 'a', dx: -20, dy: -90 } })
  })

  it('n’affiche un texte que dans l’onglet où sa personne est dessinée', () => {
    const texte = { id: 't1', type: 'text', x: 30, y: -40, content: 'Combro', style: { anchor: { personId: 'a', dx: -20, dy: -90 } } }
    expect(placeAnnotations([texte], layoutCenters(combro))).toMatchObject([{ id: 't1', x: 30, y: -40 }])
    expect(placeAnnotations([texte], layoutCenters(desBois))).toEqual([])
  })

  it('suit sa personne quand le placement change (charnière des deux côtés)', () => {
    const texte = { id: 't2', type: 'text', x: 0, y: 0, content: 'b', style: { anchor: { personId: 'b', dx: -20, dy: 10 } } }
    expect(placeAnnotations([texte], layoutCenters(combro))[0]).toMatchObject({ x: 330, y: 60 })
    expect(placeAnnotations([texte], layoutCenters(desBois))[0]).toMatchObject({ x: 930, y: 560 })
  })

  it('laisse à ses coordonnées une annotation sans ancre', () => {
    const libre = { id: 't3', type: 'text', x: 5, y: 6, content: 'x', style: {} }
    expect(placeAnnotations([libre], layoutCenters(desBois))).toEqual([libre])
  })

  it('refuse une ancre incomplète', () => {
    expect(readAnchor({ style: { anchor: { personId: 'a', dx: 1 } } })).toBeNull()
    expect(readAnchor({ style: { anchor: { personId: 7, dx: 1, dy: 2 } } })).toEqual({ personId: '7', dx: 1, dy: 2 })
  })
})

describe('ancrage à la volée des anciennes annotations', () => {
  it('rattache dans le placement de l’onglet de départ, sans toucher au reste', () => {
    const ancienne = { id: 'old', type: 'sticker', x: 330, y: 60, content: '⭐', style: { fontSize: 40, rotation: 0.1 }, zIndex: 10 }
    const [ancree] = anchorLegacy([ancienne], layoutCenters(combro))
    expect(ancree).toEqual({ ...ancienne, style: { fontSize: 40, rotation: 0.1, anchor: { personId: 'b', dx: -20, dy: 10 } } })
    // Puis elle s'affiche au même point dans l'onglet de départ
    expect(placeAnnotations([ancree], layoutCenters(combro))[0]).toMatchObject({ x: 330, y: 60 })
  })

  it('ne repasse pas sur une annotation déjà ancrée', () => {
    const ancree = { id: 'a1', type: 'text', x: 0, y: 0, content: 'x', style: { anchor: { personId: 'a', dx: 0, dy: 0 } } }
    expect(anchorLegacy([ancree], layoutCenters(desBois))).toEqual([])
  })

  it('n’ancre rien dans un placement sans personne', () => {
    expect(anchorLegacy([{ id: 'x', x: 0, y: 0, style: {} }], new Map())).toEqual([])
  })
})
