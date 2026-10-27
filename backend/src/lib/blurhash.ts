import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { encode } from 'blurhash'
import sharp from 'sharp'
import type { FastifyInstance } from 'fastify'

// Aperçus flous (BlurHash) : une courte chaîne par photo, que le navigateur décode en image floue aux bonnes
// couleurs pendant que la vraie se charge. Les photos partent en taille réelle, sans miniature : sur un réseau
// lent, une vignette restait un carré vide.
//
// Calculé à l'envoi d'une photo ou d'un portrait (routes/media.ts). Les autres chemins (Immich, import GEDCOM,
// propositions acceptées) et les photos d'avant cette version sont rattrapés en tâche de fond. Une image
// illisible reçoit une chaîne vide, pour ne pas être relue à chaque passage.

// Assez petit pour un calcul rapide ; l'aperçu garde les proportions de la photo
const SAMPLE_MAX = 32
const COMPONENTS_X = 4
const COMPONENTS_Y = 3

export async function computeBlurhash(buf: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error' })
      .rotate()
      .resize(SAMPLE_MAX, SAMPLE_MAX, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return encode(new Uint8ClampedArray(data), info.width, info.height, COMPONENTS_X, COMPONENTS_Y)
  } catch {
    return null
  }
}

async function hashStoredFile(storageRoot: string, relativePath: string): Promise<string> {
  const absolutePath = path.resolve(storageRoot, relativePath)
  if (!absolutePath.startsWith(storageRoot + path.sep)) return ''
  const buf = await readFile(absolutePath).catch(() => null)
  return (buf && await computeBlurhash(buf)) || ''
}

const BATCH = 25
const PAUSE_MS = 60_000

// Un lot de photos puis de portraits sans aperçu ; renvoie le nombre traité
export async function fillMissingBlurhashes(app: FastifyInstance, storageRoot: string): Promise<number> {
  const medias = await app.prisma.mediaItem.findMany({
    where: { type: 'photo', blurhash: null, deletedAt: null, NOT: { mimeType: 'video/youtube' } },
    select: { id: true, filePath: true },
    take: BATCH,
  })
  for (const media of medias) {
    const blurhash = await hashStoredFile(storageRoot, media.filePath)
    await app.prisma.mediaItem.updateMany({ where: { id: media.id, blurhash: null }, data: { blurhash } })
  }

  const persons = await app.prisma.person.findMany({
    where: { avatarPath: { not: null }, avatarBlurhash: null, deletedAt: null },
    select: { id: true, avatarPath: true },
    take: BATCH,
  })
  for (const person of persons) {
    const avatarBlurhash = await hashStoredFile(storageRoot, person.avatarPath as string)
    // Le portrait a pu changer pendant le calcul : on n'écrit que s'il est toujours le même
    await app.prisma.person.updateMany({ where: { id: person.id, avatarPath: person.avatarPath, avatarBlurhash: null }, data: { avatarBlurhash } })
  }

  return medias.length + persons.length
}

// Tâche de fond : enchaîne les lots tant qu'il en reste, puis repasse toutes les minutes
export function startBlurhashFiller(app: FastifyInstance, storageRoot: string) {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  const run = async () => {
    let done = 0
    try {
      done = await fillMissingBlurhashes(app, storageRoot)
    } catch (error) {
      app.log.warn({ err: error }, 'aperçus flous : lot en échec')
    }
    if (!stopped) {
      timer = setTimeout(run, done >= BATCH ? 0 : PAUSE_MS)
      timer.unref()
    }
  }
  timer = setTimeout(run, 5_000)
  timer.unref()
  app.addHook('onClose', async () => {
    stopped = true
    if (timer) clearTimeout(timer)
  })
}
