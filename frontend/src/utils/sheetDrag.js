// Geste « feuille » : une feuille du bas (fiche de personne, menu de la barre) se ferme en glissant vers le bas.
// Logique pure, sans React ni DOM, testée dans sheetDrag.test.js. Le hook qui l'utilise est hooks/useSheetDrag.js.

// Téléphone ou pointeur grossier : même règle pour la barre et pour la fiche
export const PHONE_QUERY = '(max-width: 767px), (pointer: coarse)'
// Même seuil que la feuille CSS de la fiche (PersonCard.css) : au-delà, la fiche est un panneau flottant
export const SHEET_WIDTH_QUERY = '(max-width: 768px)'

// Distance avant de trancher entre glisser vertical, horizontal et tap
export const DIRECTION_LOCK_PX = 8
// Lâcher rapide vers le bas : vitesse en px/ms, et course minimale pour qu'il compte
export const FLICK_VELOCITY = 0.6
export const FLICK_MIN_OFFSET = 24
// Deux points plus espacés que ça ne donnent pas une vitesse fiable
const VELOCITY_WINDOW_MS = 120

// Champs de saisie et libellés : jamais le point de départ d'un glisser
export const NO_DRAG_SELECTOR = 'input, textarea, select, label, [contenteditable]:not([contenteditable="false"]), [data-sheet-no-drag]'

/**
 * Le glisser peut-il partir de cette cible ?
 * `zoneSelector` : les seuls endroits de la feuille qui déclenchent le geste (poignée, en-tête).
 * `selectionText` : texte sélectionné au moment de l'appui, auquel cas rien ne bouge.
 */
export function canStartSheetDrag(target, zoneSelector, selectionText = '') {
  if (!target || typeof target.closest !== 'function') return false
  if (selectionText) return false
  if (!target.closest(zoneSelector)) return false
  return !target.closest(NO_DRAG_SELECTOR)
}

/** Intention du mouvement depuis l'appui : 'pending' (encore trop petit), 'down' ou 'up' (glisser vertical), 'other' (horizontal) */
export function sheetDragIntent(dx, dy) {
  if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return 'pending'
  if (Math.abs(dy) < Math.abs(dx)) return 'other'
  return dy > 0 ? 'down' : 'up'
}

// Au-dessus de sa position de repos, la feuille cède de moins en moins, sans jamais dépasser ce plafond (px)
export const RUBBER_MAX_PX = 40
const RUBBER_SOFTNESS_PX = 120

/** Décalage de la feuille pour un déplacement du doigt : suit vers le bas, résiste vers le haut (négatif, borné) */
export function sheetOffset(dy) {
  if (dy >= 0) return dy
  return -RUBBER_MAX_PX * (1 - 1 / (1 + -dy / RUBBER_SOFTNESS_PX))
}

/** Vitesse (px/ms, positive vers le bas) entre deux points {y, t}. Zéro si les points sont trop éloignés dans le temps. */
export function velocityBetween(from, to) {
  if (!from || !to) return 0
  const dt = to.t - from.t
  if (dt <= 0 || dt > VELOCITY_WINDOW_MS) return 0
  return (to.y - from.y) / dt
}

/** Au lâcher : fermer si la course dépasse un tiers de la hauteur, ou si le lâcher est rapide vers le bas */
export function shouldCloseSheet({ offset, height, velocity = 0 }) {
  if (height > 0 && offset >= height / 3) return true
  return velocity >= FLICK_VELOCITY && offset >= FLICK_MIN_OFFSET
}
