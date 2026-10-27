// Ouverture d'un souvenir depuis sa vignette : la vignette touchée est retenue un court instant, puis la visionneuse
// part de là et grandit jusqu'à sa place (transform seul, pas de fondu). Sans vignette retenue, rien ne change.
// Le calcul est pur et testé dans openOrigin.test.js ; le branchement est dans PersonCard.jsx et MediaViewer.jsx.

// Au-delà, l'origine retenue est périmée (la visionneuse s'ouvre juste après le clic, bien avant)
const ORIGIN_TTL_MS = 1000

let origin = null

/** Retient le rectangle de l'élément touché (une vignette) pour la prochaine ouverture */
export function rememberOrigin(element, now = Date.now()) {
  const rect = element?.getBoundingClientRect?.()
  origin = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, at: now } : null
}

/** Rend l'origine retenue une seule fois, ou null si elle manque ou a vieilli */
export function takeOrigin(now = Date.now()) {
  const taken = origin
  origin = null
  if (!taken || now - taken.at > ORIGIN_TTL_MS) return null
  return taken
}

/**
 * Départ d'une carte posée sur l'origine, même largeur : { transform, origin } à appliquer à la carte.
 * La hauteur de la carte change quand l'image arrive : on part donc du point de la carte qui ne bouge pas.
 * - anchor 'center' (fenêtre centrée, ordinateur) : le centre de la carte est celui de l'écran ;
 * - anchor 'bottom' (fenêtre collée en bas, téléphone) : le milieu du bord bas est le bas de l'écran.
 */
export function growFromTransform(from, cardWidth, viewport, anchor = 'center') {
  if (!from || !(cardWidth > 0) || !(from.width > 0)) return null
  const scale = from.width / cardWidth
  const dx = from.left + from.width / 2 - viewport.width / 2
  const dy = anchor === 'bottom'
    ? from.top + from.height - viewport.height
    : from.top + from.height / 2 - viewport.height / 2
  return {
    transform: `translate(${round(dx)}px, ${round(dy)}px) scale(${round(scale, 4)})`,
    origin: anchor === 'bottom' ? '50% 100%' : '50% 50%',
  }
}

const round = (n, digits = 2) => Number(n.toFixed(digits))
