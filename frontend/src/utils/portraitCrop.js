// Cadrage d'un portrait. Un cadrage = { x, y, zoom } : centre en proportion de l'image (0 à 1) et zoom
// (1 = l'image entière recouvre le cadre, 4 = gros plan). Null = cadrage par défaut (centré, zoom 1).
// Ce module ne fait que des calculs : l'éditeur, la fiche et le canevas s'y réfèrent tous.

export const CROP_MAX_ZOOM = 4
export const DEFAULT_CROP = { x: 0.5, y: 0.5, zoom: 1 }

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// Forme du cadre dans le canevas : même règle que resolveFrameType et drawFrame (renderers.js).
// Une photo très large ou très haute change la forme ; sinon le cadre tiré pour la personne (frameType) reste.
export function resolveFrameKind(frameType, imageRatio) {
  if (imageRatio >= 1.28) return 'rect'
  if (imageRatio <= 0.78) return 'polaroid'
  return frameType || 'round'
}

// Rapport largeur / hauteur de la zone visible, comme drawFrame le dessine.
export function frameAspect(frameKind, imageRatio) {
  if (frameKind === 'rect') {
    // Paysage : 80 x 40 ; portrait : 60 x 68 (renderers.js, drawFrame)
    return imageRatio > 1.05 ? 2 : 60 / 68
  }
  // round, polaroid et square : la zone photo est carrée
  return 1
}

// Cadrage lu depuis l'API ou le canevas : valeurs bornées, défaut si absent ou invalide.
export function normalizeCrop(crop) {
  if (!crop || typeof crop !== 'object') return DEFAULT_CROP
  const x = Number(crop.x)
  const y = Number(crop.y)
  const zoom = Number(crop.zoom)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return DEFAULT_CROP
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1), zoom: clamp(zoom, 1, CROP_MAX_ZOOM) }
}

// Zone de l'image visible dans le cadre, en pixels de l'image. Le centre est borné pour qu'il n'y ait jamais
// de vide dans le cadre : la zone reste entièrement sur la photo.
export function cropViewport(imageW, imageH, aspect, crop) {
  const c = normalizeCrop(crop)
  const imageRatio = imageW / imageH
  // Zone de base : le plus grand rectangle de rapport `aspect` tenu dans l'image (cover)
  let baseW = imageW
  let baseH = imageH
  if (imageRatio > aspect) baseW = imageH * aspect
  else baseH = imageW / aspect
  const w = baseW / c.zoom
  const h = baseH / c.zoom
  const cx = clamp(c.x * imageW, w / 2, imageW - w / 2)
  const cy = clamp(c.y * imageH, h / 2, imageH - h / 2)
  return { sx: cx - w / 2, sy: cy - h / 2, sw: w, sh: h }
}

// Cadrage borné et ramené aux proportions : ce qu'on enregistre et ce qu'on affiche sont identiques.
export function clampCrop(imageW, imageH, aspect, crop) {
  const c = normalizeCrop(crop)
  const v = cropViewport(imageW, imageH, aspect, c)
  return {
    x: (v.sx + v.sw / 2) / imageW,
    y: (v.sy + v.sh / 2) / imageH,
    zoom: c.zoom,
  }
}

// Place l'image dans un conteneur carré, en pourcentages. `windowW` et `windowH` sont la taille de la zone
// visible en fraction du conteneur (centrée). La fiche, carrée, prend 1 et 1.
export function imagePlacement(imageW, imageH, aspect, crop, windowW = 1, windowH = 1) {
  const v = cropViewport(imageW, imageH, aspect, crop)
  const kx = windowW / v.sw
  const ky = windowH / v.sh
  return {
    left: ((1 - windowW) / 2 - v.sx * kx) * 100,
    top: ((1 - windowH) / 2 - v.sy * ky) * 100,
    width: imageW * kx * 100,
    height: imageH * ky * 100,
  }
}

// Ce qu'il faut à l'enregistrement : null pour le cadrage par défaut, sinon le cadrage borné.
export function cropForSave(imageW, imageH, aspect, crop) {
  const c = clampCrop(imageW, imageH, aspect, crop)
  const round = (value) => Math.round(value * 10000) / 10000
  const normalized = { x: round(c.x), y: round(c.y), zoom: round(c.zoom) }
  if (normalized.x === 0.5 && normalized.y === 0.5 && normalized.zoom === 1) return null
  return normalized
}
