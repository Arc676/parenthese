// Fichier choisi pour l'import : un .ged seul, ou un zip qui contient le .ged et ses photos (un export
// « avec médias », un GEDZIP .gdz de GEDCOM 7, ou un dossier compressé à la main).

import { t } from '../i18n/index.js'
import { ZipError, extensionOf, isZipFile, lazyZipFile, openZip } from './zipReader.js'

const MEDIA_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'tif', 'tiff', 'bmp', 'pdf', 'mp4', 'mov', 'm4v', 'webm', 'avi', 'mp3', 'm4a', 'wav', 'ogg'])

// Fichiers sans intérêt glissés par macOS ou Windows dans un zip
const isJunk = (path) => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i.test(path) || /(^|\/)\._/.test(path)

const ZIP_MESSAGES = {
  encrypted: () => t('Ce zip est protégé par un mot de passe. Refaites-le sans mot de passe, puis réessayez.'),
  zip64: () => t('Ce zip est trop gros pour être lu ici (plus de 4 Go). Importez le fichier .ged seul, puis ajoutez les photos depuis leur dossier.'),
  unsupported_method: () => t('Ce zip utilise une compression que le navigateur ne sait pas lire. Refaites-le avec l’outil de compression de votre ordinateur.'),
}

export function zipErrorMessage(error) {
  return ZIP_MESSAGES[error?.code]?.() || t('Ce zip n’a pas pu être lu. Vérifiez qu’il s’ouvre sur votre ordinateur, puis réessayez.')
}

/**
 * @returns { gedcomFile: File, bundledFiles: lazy files du zip (photos, actes, vidéos), fromZip: boolean }
 */
export async function readGedcomBundle(file) {
  if (!(await isZipFile(file))) return { gedcomFile: file, bundledFiles: [], fromZip: false }

  const zip = await openZip(file)
  const usable = zip.entries.filter((entry) => !isJunk(entry.path))
  // Le .ged le plus haut dans l'arborescence : « gedcom.ged » d'un GEDZIP, ou celui du dossier exporté
  const gedcoms = usable
    .filter((entry) => extensionOf(entry.name) === 'ged')
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || b.size - a.size)
  if (gedcoms.length === 0) throw new ZipError('no_gedcom', t('Ce zip ne contient pas de fichier .ged. Il faut l’export GEDCOM de votre logiciel, avec ses photos à côté.'))

  const blob = await zip.read(gedcoms[0])
  const gedcomFile = new File([blob], gedcoms[0].name, { type: 'text/plain' })
  const bundledFiles = usable
    .filter((entry) => entry !== gedcoms[0] && MEDIA_EXTENSIONS.has(extensionOf(entry.name)) && entry.size > 0)
    .map((entry) => lazyZipFile(zip, entry))
  return { gedcomFile, bundledFiles, fromZip: true }
}
