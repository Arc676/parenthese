// Photos citées par un fichier GEDCOM. Le fichier ne contient pas les images, seulement leur chemin sur
// l'ordinateur de la personne (« C:\Généalogie\Photos\jean.jpg »). L'import renvoie ce chemin pour chaque
// personne, et l'app les relie aux fichiers du dossier que la personne choisit, sans rien garder en base.

export type GedcomPhotoNode = {
  xref?: string
  tag: string
  value: string
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
