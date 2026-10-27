import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { decode, isBlurhashValid } from 'blurhash'
import { describe, expect, it } from 'vitest'
import { computeBlurhash } from '../src/lib/blurhash.js'

// Aperçu flou calculé à l'envoi d'une photo : une chaîne valide, aux couleurs de la photo
const demo = (name: string) => fileURLToPath(new URL(`../../frontend/public/demo/${name}`, import.meta.url))

describe('computeBlurhash', () => {
  it('donne un aperçu valide pour une vraie photo', async () => {
    const hash = await computeBlurhash(await readFile(demo('souvenir-mariage-1918.webp')))
    expect(hash).toBeTruthy()
    expect(isBlurhashValid(hash as string).result).toBe(true)
    // 4 × 3 composantes : 4 + 2 × 4 × 3 - 2 = 28 caractères
    expect(hash).toHaveLength(28)
    // Photo en noir et blanc : l'aperçu reste gris (rouge, vert et bleu proches)
    const px = decode(hash as string, 8, 8)
    const [r, g, b] = [px[0], px[1], px[2]]
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24)
  })

  it('renvoie null pour un fichier qui n’est pas une image', async () => {
    expect(await computeBlurhash(Buffer.from('pas une image'))).toBeNull()
  })
})
