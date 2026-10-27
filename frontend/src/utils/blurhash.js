import { decode, isBlurhashValid } from 'blurhash'

// Aperçus flous (BlurHash, calculés par l'API, backend/src/lib/blurhash.ts) : une image floue aux couleurs de la
// photo, montrée pendant que la vraie se charge. Pas de fondu : la photo remplace l'aperçu d'un coup.

const SIZE = 32
const canvases = new Map()

// Petit canvas de l'aperçu, gardé par chaîne ; null si la chaîne est absente ou invalide
export function blurhashCanvas(hash) {
  if (!hash || typeof document === 'undefined') return null
  if (canvases.has(hash)) return canvases.get(hash)
  let canvas = null
  if (isBlurhashValid(hash).result) {
    canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const image = ctx.createImageData(SIZE, SIZE)
      image.data.set(decode(hash, SIZE, SIZE))
      ctx.putImageData(image, 0, 0)
    } else {
      canvas = null
    }
  }
  if (canvases.size > 500) canvases.delete(canvases.keys().next().value)
  canvases.set(hash, canvas)
  return canvas
}

const urls = new Map()

// Props d'une balise <img> : l'aperçu en fond tant que la photo n'est pas là. fit suit l'object-fit de l'image
// (cover pour une vignette, contain pour la visionneuse). Le fond est retiré au chargement, pour une photo
// transparente.
export function blurPlaceholder(hash, fit = 'cover') {
  const canvas = blurhashCanvas(hash)
  if (!canvas) return {}
  if (!urls.has(hash)) urls.set(hash, canvas.toDataURL())
  return {
    style: { backgroundImage: `url(${urls.get(hash)})`, backgroundSize: fit === 'contain' ? 'contain' : 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' },
    onLoad: (event) => { event.currentTarget.style.backgroundImage = 'none' },
  }
}
