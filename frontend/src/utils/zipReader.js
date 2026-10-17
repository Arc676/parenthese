// Lecture d'un zip dans le navigateur, sans bibliothèque : la table des matières en fin de fichier, puis
// chaque fichier décompressé à la demande (DecompressionStream). Rien n'est chargé en mémoire tant qu'on ne
// demande pas un fichier, ce qui garde légers les zips de plusieurs centaines de photos.
//
// Pris en charge : fichiers stockés (méthode 0) ou compressés (méthode 8, « deflate »), noms en UTF-8 ou en
// page de code DOS. Refusés avec un message : zip chiffré, zip64 (archives de plus de 4 Go ou de 65 535
// fichiers), autres méthodes de compression.

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const MAX_EOCD_SEARCH = 65_557 // 22 octets + commentaire de 65 535 au plus

export class ZipError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'ZipError'
    this.code = code
  }
}

async function readBytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer())
}

// Page de code 437 (noms de fichiers des zips faits sous Windows sans le drapeau UTF-8) : les accents
// français y ont leur place fixe ; le reste des octets hauts devient un caractère neutre
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '
function decodeName(bytes, utf8) {
  if (utf8) return new TextDecoder('utf-8').decode(bytes)
  let out = ''
  for (const byte of bytes) out += byte < 128 ? String.fromCharCode(byte) : CP437_HIGH[byte - 128]
  return out
}

export function isZipSignature(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06)
}

export async function isZipFile(file) {
  if (!file) return false
  if (/\.(zip|gdz)$/i.test(file.name || '')) return true
  return isZipSignature(await readBytes(file, 0, 4))
}

// Ouvre un zip : renvoie ses fichiers (sans les dossiers) et de quoi lire chacun
export async function openZip(file) {
  const tailStart = Math.max(0, file.size - MAX_EOCD_SEARCH)
  const tail = await readBytes(file, tailStart, file.size)
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) { eocd = i; break }
  }
  if (eocd < 0) throw new ZipError('not_a_zip')

  const count = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new ZipError('zip64')

  const central = await readBytes(file, centralOffset, centralOffset + centralSize)
  const cv = new DataView(central.buffer, central.byteOffset, central.byteLength)
  const entries = []
  let p = 0
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > central.length || cv.getUint32(p, true) !== CENTRAL_SIGNATURE) throw new ZipError('corrupt')
    const flags = cv.getUint16(p + 8, true)
    const method = cv.getUint16(p + 10, true)
    const compressedSize = cv.getUint32(p + 20, true)
    const size = cv.getUint32(p + 24, true)
    const nameLength = cv.getUint16(p + 28, true)
    const extraLength = cv.getUint16(p + 30, true)
    const commentLength = cv.getUint16(p + 32, true)
    const localOffset = cv.getUint32(p + 42, true)
    const path = decodeName(central.subarray(p + 46, p + 46 + nameLength), Boolean(flags & 0x0800)).replace(/\\/g, '/')
    p += 46 + nameLength + extraLength + commentLength
    if (path.endsWith('/')) continue
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError('zip64')
    entries.push({ path, name: path.split('/').pop(), size, compressedSize, method, flags, localOffset })
  }

  const read = async (entry) => {
    if (entry.flags & 0x0001) throw new ZipError('encrypted')
    const local = await readBytes(file, entry.localOffset, entry.localOffset + 30)
    const lv = new DataView(local.buffer, local.byteOffset, local.byteLength)
    if (lv.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipError('corrupt')
    const dataStart = entry.localOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true)
    const raw = file.slice(dataStart, dataStart + entry.compressedSize)
    if (entry.method === 0) return raw
    if (entry.method !== 8) throw new ZipError('unsupported_method')
    return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()
  }

  return { entries, read }
}

const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
}

export const extensionOf = (name) => (String(name).match(/\.([a-z0-9]{1,5})$/i)?.[1] || '').toLowerCase()
export const mimeTypeOf = (name) => MIME_BY_EXTENSION[extensionOf(name)] || ''

// Fichier du zip qu'on peut rapprocher comme un fichier de dossier (nom, chemin), et ne lire qu'au moment
// de l'envoyer : toFile() le décompresse et renvoie un vrai File
export function lazyZipFile(zip, entry) {
  return {
    name: entry.name,
    size: entry.size,
    type: mimeTypeOf(entry.name),
    webkitRelativePath: entry.path,
    async toFile() {
      const blob = await zip.read(entry)
      return new File([blob], entry.name, { type: mimeTypeOf(entry.name) || blob.type || '' })
    },
  }
}

// Un fichier venu d'un dossier reste tel quel, un fichier du zip est lu à ce moment-là
export async function materializeFile(file) {
  return file && typeof file.toFile === 'function' ? file.toFile() : file
}
