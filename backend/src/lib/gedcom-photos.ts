// Photos et documents cités par un fichier GEDCOM. Le fichier ne contient pas les fichiers, seulement leur
// chemin sur l'ordinateur de la personne (« C:\Généalogie\Photos\jean.jpg »). L'import renvoie ces chemins
// pour chaque personne, et l'app les relie aux fichiers du dossier que la personne choisit, sans rien
// garder en base : le portrait devient la photo de la fiche, le reste des souvenirs.

export type GedcomPhotoNode = {
  xref?: string
  tag: string
  value: string
  rawValue?: string
  children: GedcomPhotoNode[]
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif'])
const MAX_PATH_LENGTH = 500

function child(node: GedcomPhotoNode | undefined, tag: string): GedcomPhotoNode | undefined {
  return node?.children.find((c) => c.tag === tag)
}

function isImagePath(value: string): boolean {
  if (!value || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false
  const name = value.split(/[\\/]/).pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

// Un OBJE est soit écrit sous la personne (« 1 OBJE » puis « 2 FILE »), soit un renvoi (« 1 OBJE @M1@ »)
// vers un enregistrement « 0 @M1@ OBJE » en fin de fichier. Les logiciels marquent la photo principale
// par _PRIM Y (sous OBJE ou sous FILE) : elle passe devant, sinon la première image citée.
export function photoPathForPerson(
  indi: GedcomPhotoNode,
  objeByXref: Map<string, GedcomPhotoNode>,
): string | null {
  // Family Tree Maker désigne la photo principale par « 1 _PHOTO @O1@ » sous la personne
  const photoPointer = child(indi, '_PHOTO')?.value.match(/^@([^@]+)@$/)?.[1]
  const flagged = photoPointer ? objeByXref.get(photoPointer) : undefined
  for (const file of flagged?.children.filter((c) => c.tag === 'FILE') ?? []) {
    const filePath = file.value.trim()
    if (isImagePath(filePath) && filePath.length <= MAX_PATH_LENGTH) return filePath
  }
  let first: string | null = null
  for (const ref of indi.children) {
    if (ref.tag !== 'OBJE') continue
    const pointer = ref.value.match(/^@([^@]+)@$/)
    const obje = pointer ? objeByXref.get(pointer[1]) : ref
    if (!obje) continue
    const isPrimary = (node: GedcomPhotoNode | undefined) => child(node, '_PRIM')?.value?.toUpperCase().startsWith('Y')
    for (const file of obje.children.filter((c) => c.tag === 'FILE')) {
      const filePath = file.value.trim()
      if (!isImagePath(filePath) || filePath.length > MAX_PATH_LENGTH) continue
      if (isPrimary(ref) || isPrimary(obje) || isPrimary(file)) return filePath
      first ??= filePath
    }
  }
  return first
}

export function indexObjeRecords(roots: GedcomPhotoNode[]): Map<string, GedcomPhotoNode> {
  const map = new Map<string, GedcomPhotoNode>()
  for (const node of roots) {
    if (node.tag === 'OBJE' && node.xref) map.set(node.xref, node)
  }
  return map
}

// ---------- Souvenirs : tous les fichiers cités pour une personne ----------
// Un logiciel de généalogie accroche ses fichiers à plusieurs endroits : sous la personne (« 1 OBJE »), sous
// un événement (« 1 BIRT » / « 2 OBJE »), sous une source citée (« 2 SOUR @S1@ » / « 3 OBJE »), dans la
// source elle-même (« 0 @S1@ SOUR » / « 1 OBJE ») ou sous la famille (actes de mariage). On les ramasse
// tous, comme Gramps (libgedcom.py), pour que les actes, registres et photos de famille deviennent des
// souvenirs. Le portrait reste à part (photoPathForPerson).

export type GedcomMediaRef = { file: string; caption: string | null; source: string | null }

const MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  'pdf', 'txt',
  'mp4', 'mov', 'm4v', 'webm', 'avi',
  'mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac',
])
const MAX_MEDIA_PER_PERSON = 60
const MAX_CAPTION_LENGTH = 280
const MAX_SOURCE_LENGTH = 500

export type GedcomRecords = {
  obje: Map<string, GedcomPhotoNode>
  sour: Map<string, GedcomPhotoNode>
  note: Map<string, GedcomPhotoNode>
  fam: Map<string, GedcomPhotoNode>
}

export function indexGedcomRecords(roots: GedcomPhotoNode[]): GedcomRecords {
  const records: GedcomRecords = { obje: new Map(), sour: new Map(), note: new Map(), fam: new Map() }
  for (const node of roots) {
    if (!node.xref) continue
    if (node.tag === 'OBJE') records.obje.set(node.xref, node)
    else if (node.tag === 'SOUR') records.sour.set(node.xref, node)
    else if (node.tag === 'NOTE') records.note.set(node.xref, node)
    else if (node.tag === 'FAM') records.fam.set(node.xref, node)
  }
  return records
}

function pointerOf(value: string): string | null {
  return value.match(/^@([^@]+)@$/)?.[1] ?? null
}

// Chemin local d'un fichier cité : les adresses web ne sont pas des fichiers de l'ordinateur ;
// « file:///C:/… » (GEDCOM 7) redevient un chemin ordinaire.
export function localMediaPath(value: string): string | null {
  let path = value.trim()
  if (!path || path.length > MAX_PATH_LENGTH) return null
  if (/^file:\/\//i.test(path)) {
    path = path.replace(/^file:\/\/(localhost)?/i, '')
    if (/^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1)
    try { path = decodeURIComponent(path) } catch { /* chemin laissé tel quel */ }
  } else if (/^[a-z][a-z0-9+.-]+:/i.test(path)) {
    return null
  }
  const name = path.split(/[\\/]/).pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && MEDIA_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) ? path : null
}

export function joinedText(node: GedcomPhotoNode | undefined): string {
  if (!node) return ''
  let text = node.rawValue ?? node.value
  for (const c of node.children) {
    if (c.tag === 'CONT') text += `\n${c.rawValue ?? c.value}`
    else if (c.tag === 'CONC') text += c.rawValue ?? c.value
  }
  return text
}

// Heredis Mac écrit certaines notes en RTF : on n'en garde que le texte
export function plainNoteText(raw: string): string {
  let text = raw
  if (/^\s*\{\\rtf/.test(text)) {
    text = text
      .replace(/\{\\\*[^{}]*\}/g, '')
      .replace(/\{\\(fonttbl|colortbl|stylesheet|info)[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
      .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(hex, 16)])))
      .replace(/\\par[d]?\b ?/g, '\n')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
  }
  return text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

// Une note ou une source partagée est citée par des milliers de fiches : son texte se calcule une fois
// par import (les nœuds sont neufs à chaque import, la WeakMap se vide avec eux)
const noteTextCache = new WeakMap<GedcomPhotoNode, string>()
const recordTitleCache = new WeakMap<GedcomPhotoNode, string>()
const hasMediaCache = new WeakMap<GedcomPhotoNode, boolean>()
const MAX_RECORD_DEPTH = 200
const MAX_WALKED_NODES_PER_PERSON = 5000

export function noteText(node: GedcomPhotoNode | undefined, records: GedcomRecords): string {
  if (!node) return ''
  const pointer = pointerOf(node.value)
  const target = pointer ? records.note.get(pointer) : node
  if (!target) return ''
  let text = noteTextCache.get(target)
  if (text === undefined) {
    text = plainNoteText(joinedText(target))
    noteTextCache.set(target, text)
  }
  return text
}

function recordTitle(record: GedcomPhotoNode): string {
  let title = recordTitleCache.get(record)
  if (title === undefined) {
    title = joinedText(child(record, 'TITL')) || joinedText(child(record, 'ABBR'))
    recordTitleCache.set(record, title)
  }
  return title
}

// Un nœud mène-t-il à un fichier (OBJE), directement ou par une source ou une union citée ?
// Un renvoi en boucle compte pour non pendant le calcul.
function hasMedia(node: GedcomPhotoNode, records: GedcomRecords, depth = 0): boolean {
  const known = hasMediaCache.get(node)
  if (known !== undefined) return known
  if (depth > MAX_RECORD_DEPTH) return false
  hasMediaCache.set(node, false)
  let found = false
  for (const c of node.children) {
    const pointer = pointerOf(c.value)
    const linked = !pointer ? undefined : c.tag === 'SOUR' ? records.sour.get(pointer) : c.tag === 'FAMS' ? records.fam.get(pointer) : undefined
    if (c.tag === 'OBJE' || hasMedia(c, records, depth + 1) || (linked && hasMedia(linked, records, depth + 1))) { found = true; break }
  }
  hasMediaCache.set(node, found)
  return found
}

function clipText(value: string, max: number): string | null {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function baseNameWithoutExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

// Titre d'une source citée : son titre (ou son abréviation), puis la page ou le détail de la citation
export function sourceLabel(citation: GedcomPhotoNode, records: GedcomRecords): string | null {
  const pointer = pointerOf(citation.value)
  const record = pointer ? records.sour.get(pointer) : null
  const title = (record ? recordTitle(record) : '') || (pointer ? '' : citation.value)
  const page = joinedText(child(citation, 'PAGE'))
  return clipText([title, page].filter(Boolean).join(', '), MAX_SOURCE_LENGTH)
}

export function mediaRefsForPerson(indi: GedcomPhotoNode, records: GedcomRecords, portraitPath: string | null = null): GedcomMediaRef[] {
  const refs: GedcomMediaRef[] = []
  const seenPaths = new Set<string>()
  if (portraitPath) seenPaths.add(portraitPath.toLowerCase())
  const visitedRecords = new Set<GedcomPhotoNode>()

  const addObje = (ref: GedcomPhotoNode, source: string | null) => {
    const pointer = pointerOf(ref.value)
    const obje = pointer ? records.obje.get(pointer) : ref
    if (!obje) return
    const objeTitle = joinedText(child(obje, 'TITL')) || joinedText(child(ref, 'TITL'))
    const objeNote = noteText(child(obje, 'NOTE'), records) || noteText(child(ref, 'NOTE'), records)
    const form = (child(obje, 'FORM')?.value || '').toLowerCase()
    if (form === 'url') return
    for (const file of obje.children.filter((c) => c.tag === 'FILE')) {
      if ((child(file, 'FORM')?.value || '').toLowerCase() === 'url') continue
      const path = localMediaPath(file.value)
      if (!path || seenPaths.has(path.toLowerCase()) || refs.length >= MAX_MEDIA_PER_PERSON) continue
      seenPaths.add(path.toLowerCase())
      const title = joinedText(child(file, 'TITL')) || objeTitle || objeNote
      refs.push({
        file: path,
        caption: clipText(title || baseNameWithoutExtension(path), MAX_CAPTION_LENGTH),
        source,
      })
    }
  }

  let budget = MAX_WALKED_NODES_PER_PERSON
  const walk = (node: GedcomPhotoNode, source: string | null, depth: number) => {
    if (depth > MAX_RECORD_DEPTH) return
    for (const c of node.children) {
      if (--budget < 0 || refs.length >= MAX_MEDIA_PER_PERSON) return
      if (c.tag === 'OBJE') {
        addObje(c, source)
      } else if (c.tag === 'SOUR') {
        const pointer = pointerOf(c.value)
        const record = pointer ? records.sour.get(pointer) : null
        const recordToWalk = record && !visitedRecords.has(record) && hasMedia(record, records) ? record : null
        if (!hasMedia(c, records) && !recordToWalk) continue
        const label = sourceLabel(c, records) ?? source
        walk(c, label, depth + 1)
        if (recordToWalk) {
          visitedRecords.add(recordToWalk)
          walk(recordToWalk, label, depth + 1)
        }
      } else if (c.tag === 'FAMS') {
        const pointer = pointerOf(c.value)
        const fam = pointer ? records.fam.get(pointer) : null
        if (fam && !visitedRecords.has(fam) && hasMedia(fam, records)) {
          visitedRecords.add(fam)
          walk({ ...fam, children: fam.children.filter((f) => !['HUSB', 'WIFE', 'CHIL'].includes(f.tag)) }, source, depth + 1)
        }
      } else if (!pointerOf(c.value) && c.children.length > 0 && hasMedia(c, records)) {
        walk(c, source, depth + 1)
      }
    }
  }

  walk(indi, null, 0)
  return refs
}
