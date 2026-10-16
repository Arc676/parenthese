// Photos après un import GEDCOM : relier les chemins cités par le logiciel d'origine aux fichiers du dossier
// choisi par la personne, et choisir les premiers visages à demander.

import { MAX_IMAGE_BYTES } from './mediaUpload.js'

const MAX_SIDE = 2000
const JPEG_QUALITY = 0.88

function normalizeName(value) {
  return String(value || '').normalize('NFC').toLowerCase()
}

// Dernier élément d'un chemin Windows, macOS ou Linux
export function baseNameOf(filePath) {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || ''
}

function pathParts(filePath) {
  return normalizeName(filePath).split(/[\\/]/).filter(Boolean)
}

// Nombre de dossiers communs en partant du nom de fichier : départage deux « portrait.jpg »
function commonSuffixLength(a, b) {
  const pa = pathParts(a)
  const pb = pathParts(b)
  let n = 0
  while (n < pa.length && n < pb.length && pa[pa.length - 1 - n] === pb[pb.length - 1 - n]) n += 1
  return n
}

// photoRefs : [{ personId, file }] renvoyé par l'import. files : les File du dossier choisi
// (webkitRelativePath renseigné). Renvoie les paires trouvées et les références sans fichier.
export function matchPhotoFiles(photoRefs, files) {
  const byName = new Map()
  for (const file of files || []) {
    const key = normalizeName(file.name)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(file)
  }

  const matches = []
  const missing = []
  for (const ref of photoRefs || []) {
    const candidates = byName.get(normalizeName(baseNameOf(ref.file))) || []
    if (candidates.length === 0) {
      missing.push(ref)
      continue
    }
    let best = candidates[0]
    let bestScore = -1
    for (const candidate of candidates) {
      const score = commonSuffixLength(ref.file, candidate.webkitRelativePath || candidate.name)
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
    // Les autres champs de la référence (légende, source d'un souvenir) suivent le fichier retrouvé
    matches.push({ ...ref, file: best, sourcePath: ref.file })
  }
  return { matches, missing }
}

// Les premiers visages à demander : la famille proche de « Moi » si on la connaît, sinon les générations
// les plus récentes, dont les photos sont sous la main. Seulement des personnes sans portrait.
export function pickFirstFaces({ persons, selfId = null, getParents, getChildren, getPartners, limit = 5 }) {
  const withoutPhoto = (persons || []).filter((p) => !p.photo)
  if (withoutPhoto.length === 0) return []
  const wanted = new Set(withoutPhoto.map((p) => String(p.id)))
  const byId = new Map((persons || []).map((p) => [String(p.id), p]))

  const picked = []
  if (selfId && byId.has(String(selfId))) {
    const seen = new Set([String(selfId)])
    let frontier = [String(selfId)]
    if (wanted.has(String(selfId))) picked.push(byId.get(String(selfId)))
    while (frontier.length > 0 && picked.length < limit) {
      const next = []
      for (const id of frontier) {
        const around = [
          ...(getParents?.(id) || []),
          ...(getPartners?.(id) || []),
          ...(getChildren?.(id) || []),
        ]
        for (const person of around) {
          const key = String(person?.id ?? '')
          if (!key || seen.has(key)) continue
          seen.add(key)
          next.push(key)
        }
      }
      const ring = next
        .filter((key) => wanted.has(key))
        .map((key) => byId.get(key))
        .sort(byRecentBirth)
      for (const person of ring) {
        if (picked.length >= limit) break
        picked.push(person)
      }
      frontier = next
    }
  }

  if (picked.length < limit) {
    const already = new Set(picked.map((p) => String(p.id)))
    const rest = withoutPhoto.filter((p) => !already.has(String(p.id))).sort(byRecentBirth)
    picked.push(...rest.slice(0, limit - picked.length))
  }
  return picked
}

function byRecentBirth(a, b) {
  const ya = Number.isFinite(a?.birthYear) ? a.birthYear : -Infinity
  const yb = Number.isFinite(b?.birthYear) ? b.birthYear : -Infinity
  if (ya !== yb) return yb - ya
  if (Boolean(a?.isAlive) !== Boolean(b?.isAlive)) return a?.isAlive ? -1 : 1
  return 0
}

// Une photo de téléphone dépasse souvent 5 Mo : elle est réduite à 2000 px en JPEG avant l'envoi.
// Un format que le navigateur ne sait pas lire (HEIC sur Chrome) part tel quel, le serveur tranche.
export async function prepareImageForUpload(file) {
  if (!file || !String(file.type || '').startsWith('image/') || file.type === 'image/gif') return file
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file
  }
  const largest = Math.max(bitmap.width, bitmap.height)
  const isSimpleFormat = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  if (largest <= MAX_SIDE && file.size <= MAX_IMAGE_BYTES && isSimpleFormat) {
    bitmap.close?.()
    return file
  }
  const ratio = Math.min(1, MAX_SIDE / largest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) return file
  const name = baseNameOf(file.name).replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' })
}

// Les chemins de l'import, gardés sur l'appareil pour rouvrir l'étape plus tard (rien côté serveur)
const REFS_KEY = (treeId) => `parenthese_photo_refs:${treeId}`

export function savePhotoRefs(treeId, refs) {
  if (!treeId) return
  try {
    if (refs?.length) localStorage.setItem(REFS_KEY(treeId), JSON.stringify(refs))
    else localStorage.removeItem(REFS_KEY(treeId))
  } catch {
    // Stockage plein ou indisponible : l'étape ne se rouvrira pas, l'import reste fait
  }
}

// Les autres fichiers cités (actes, photos de famille) : gardés à part, pour rouvrir l'étape plus tard
const MEDIA_REFS_KEY = (treeId) => `parenthese_media_refs:${treeId}`

export function saveMediaRefs(treeId, refs) {
  if (!treeId) return
  try {
    if (refs?.length) localStorage.setItem(MEDIA_REFS_KEY(treeId), JSON.stringify(refs))
    else localStorage.removeItem(MEDIA_REFS_KEY(treeId))
  } catch {
    // Stockage plein ou indisponible : l'étape ne se rouvrira pas, l'import reste fait
  }
}

export function loadMediaRefs(treeId) {
  if (!treeId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(MEDIA_REFS_KEY(treeId)) || '[]')
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.personId && r.file) : []
  } catch {
    return []
  }
}

export function loadPhotoRefs(treeId) {
  if (!treeId) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(REFS_KEY(treeId)) || '[]')
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.personId && r.file) : []
  } catch {
    return []
  }
}

// Effectifs arrondis pour PostHog : un ordre de grandeur, jamais un compte exact d'un arbre
export function sizeBucket(n) {
  if (!n) return '0'
  if (n < 10) return '1-9'
  if (n < 50) return '10-49'
  if (n < 200) return '50-199'
  if (n < 1000) return '200-999'
  return '1000+'
}
