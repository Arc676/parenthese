import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CROP,
  clampCrop,
  cropForSave,
  cropViewport,
  frameAspect,
  imagePlacement,
  normalizeCrop,
  resolveFrameKind,
  shapeOfKind,
} from './portraitCrop.js'

// Le cadrage visible ne sort jamais de la photo : aucun vide dans le cadre
function insideImage(v, w, h) {
  return v.sx >= -1e-9 && v.sy >= -1e-9 && v.sx + v.sw <= w + 1e-9 && v.sy + v.sh <= h + 1e-9
}

describe('portraitCrop', () => {
  it('le cadrage par défaut reprend le recouvrement centré (cover)', () => {
    // Photo 800x400 dans un cadre carré : on garde le centre, 400x400
    expect(cropViewport(800, 400, 1, null)).toEqual({ sx: 200, sy: 0, sw: 400, sh: 400 })
    // Photo 400x800 dans un cadre carré : on garde le centre, 400x400 aussi
    expect(cropViewport(400, 800, 1, DEFAULT_CROP)).toEqual({ sx: 0, sy: 200, sw: 400, sh: 400 })
  })

  it('le zoom réduit la zone visible autour du centre', () => {
    const v = cropViewport(800, 800, 1, { x: 0.5, y: 0.5, zoom: 2 })
    expect(v.sw).toBeCloseTo(400)
    expect(v.sh).toBeCloseTo(400)
    expect(v.sx).toBeCloseTo(200)
  })

  it('borne le centre pour ne jamais laisser de vide, même avec des valeurs extrêmes', () => {
    const corners = [
      { x: 0, y: 0, zoom: 4 },
      { x: 1, y: 1, zoom: 4 },
      { x: 0, y: 1, zoom: 3 },
      { x: 1, y: 0, zoom: 1.5 },
    ]
    for (const crop of corners) {
      for (const [w, h, aspect] of [[1200, 800, 1], [800, 1200, 1], [1200, 800, 2], [800, 1200, 60 / 68]]) {
        const v = cropViewport(w, h, aspect, crop)
        expect(insideImage(v, w, h)).toBe(true)
        expect(v.sw / v.sh).toBeCloseTo(aspect, 6)
      }
    }
  })

  it('clampCrop ramène un centre hors photo sur le bord, sans toucher au zoom', () => {
    const c = clampCrop(800, 400, 1, { x: 0.99, y: 0.01, zoom: 2 })
    expect(c.zoom).toBe(2)
    // zone de 200 px de large : le centre ne peut pas dépasser 700 px ni descendre sous 100 px
    expect(c.x * 800).toBeCloseTo(700)
    expect(c.y * 400).toBeCloseTo(100)
  })

  it('normalizeCrop borne le zoom entre 1 et 4 et ignore les valeurs absentes', () => {
    expect(normalizeCrop({ x: 0.2, y: 0.3, zoom: 9 })).toEqual({ x: 0.2, y: 0.3, zoom: 4 })
    expect(normalizeCrop({ x: 0.2, y: 0.3, zoom: 0.2 })).toEqual({ x: 0.2, y: 0.3, zoom: 1 })
    expect(normalizeCrop({ x: 'n', y: 0.3, zoom: 1 })).toEqual(DEFAULT_CROP)
    expect(normalizeCrop(undefined)).toEqual(DEFAULT_CROP)
  })

  it('cropForSave enregistre null pour le cadrage par défaut et arrondit sinon', () => {
    expect(cropForSave(800, 800, 1, { x: 0.5, y: 0.5, zoom: 1 })).toBeNull()
    // Centre 0,456789 à zoom 2 : rien n'est borné, seul l'arrondi à 4 décimales compte
    expect(cropForSave(800, 800, 1, { x: 0.456789, y: 0.5, zoom: 2 })).toEqual({ x: 0.4568, y: 0.5, zoom: 2 })
  })

  it('imagePlacement couvre toujours la fenêtre visible (pas de vide en pourcentages)', () => {
    const p = imagePlacement(800, 400, 1, { x: 0, y: 0, zoom: 1 }, 0.8, 0.8)
    // La photo commence au bord gauche de la fenêtre et couvre au moins sa hauteur
    expect(p.left).toBeLessThanOrEqual(10 + 1e-9)
    expect(p.top).toBeCloseTo(10)
    expect(p.height).toBeGreaterThanOrEqual(80 - 1e-9)
    expect(p.width).toBeGreaterThanOrEqual(80 - 1e-9)
  })

  it('la forme du cadre suit le canevas (renderers.js)', () => {
    expect(resolveFrameKind('round', 1)).toBe('round')
    expect(resolveFrameKind('round', 2)).toBe('rect')
    expect(resolveFrameKind('rect', 0.5)).toBe('polaroid')
    expect(frameAspect('round', 1)).toBe(1)
    expect(frameAspect('polaroid', 1)).toBe(1)
    expect(frameAspect('rect', 1.5)).toBe(2)
    expect(frameAspect('rect', 1)).toBeCloseTo(60 / 68)
  })
})

describe('forme choisie au recadrage', () => {
  it('l emporte sur le format de la photo et sur le tirage de la personne', () => {
    // Photo très large : cadre couché par défaut, rond si on le choisit
    expect(resolveFrameKind('polaroid', 1.6)).toBe('rect')
    expect(resolveFrameKind('polaroid', 1.6, 'round')).toBe('round')
    expect(frameAspect(resolveFrameKind('polaroid', 1.6, 'round'), 1.6, 'round')).toBe(1)
    // Vertical choisi sur une photo couchée : la zone visible est debout
    expect(resolveFrameKind('round', 1.6, 'portrait')).toBe('rect')
    expect(frameAspect('rect', 1.6, 'portrait')).toBeCloseTo(60 / 68)
    expect(frameAspect('rect', 0.7, 'landscape')).toBe(2)
  })

  it('le sélecteur montre la forme en cours quand rien n est choisi', () => {
    expect(shapeOfKind('rect', 1.6)).toBe('landscape')
    expect(shapeOfKind('rect', 1)).toBe('portrait')
    expect(shapeOfKind('polaroid', 0.7)).toBe('polaroid')
  })

  it('est gardée à la lecture et à l enregistrement, même sans recadrage', () => {
    expect(normalizeCrop({ x: 0.2, y: 0.3, zoom: 2, shape: 'square' })).toEqual({ x: 0.2, y: 0.3, zoom: 2, shape: 'square' })
    expect(normalizeCrop({ x: 0.2, y: 0.3, zoom: 2, shape: 'hexagone' })).toEqual({ x: 0.2, y: 0.3, zoom: 2 })
    expect(cropForSave(400, 400, 1, DEFAULT_CROP)).toBeNull()
    expect(cropForSave(400, 400, 1, DEFAULT_CROP, 'round')).toEqual({ x: 0.5, y: 0.5, zoom: 1, shape: 'round' })
  })
})
