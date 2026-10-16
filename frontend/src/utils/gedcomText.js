// Lire un fichier GEDCOM avec le bon encodage. Le navigateur lit tout en UTF-8 par défaut, alors que beaucoup
// de logiciels écrivent autre chose : Heredis PC en « ANSI » (Windows-1252), les anciens logiciels en ANSEL,
// Heredis Mac en « MACINTOSH ». Lus en UTF-8, leurs accents deviennent « Ã© » ou « � ».
//
// Ordre : marque d'octets (BOM) ; UTF-8 si le fichier en est un valide (certains logiciels déclarent ANSI
// alors qu'ils écrivent de l'UTF-8) ; sinon l'encodage déclaré par la ligne « 1 CHAR » ; sinon Windows-1252.

const ANSEL_SPECIALS = {
  0xa1: 'Ł', 0xa2: 'Ø', 0xa3: 'Đ', 0xa4: 'Þ', 0xa5: 'Æ', 0xa6: 'Œ', 0xa7: 'ʹ', 0xa8: '·', 0xa9: '♭',
  0xaa: '®', 0xab: '±', 0xac: 'Ơ', 0xad: 'Ư', 0xae: 'ʼ', 0xb0: 'ʻ', 0xb1: 'ł', 0xb2: 'ø', 0xb3: 'đ',
  0xb4: 'þ', 0xb5: 'æ', 0xb6: 'œ', 0xb7: 'ʺ', 0xb8: 'ı', 0xb9: '£', 0xba: 'ð', 0xbc: 'ơ', 0xbd: 'ư',
  0xc0: '°', 0xc1: 'ℓ', 0xc2: '℗', 0xc3: '©', 0xc4: '♯', 0xc5: '¿', 0xc6: '¡', 0xc7: 'ß', 0xc8: '€',
}

// Diacritiques ANSEL : écrits AVANT la lettre, rendus par un caractère combinant APRÈS elle
const ANSEL_COMBINING = {
  0xe0: '̉', 0xe1: '̀', 0xe2: '́', 0xe3: '̂', 0xe4: '̃', 0xe5: '̄',
  0xe6: '̆', 0xe7: '̇', 0xe8: '̈', 0xe9: '̌', 0xea: '̊', 0xeb: '︠',
  0xec: '︡', 0xed: '̕', 0xee: '̋', 0xef: '̐', 0xf0: '̧', 0xf1: '̨',
  0xf2: '̣', 0xf3: '̤', 0xf4: '̥', 0xf5: '̳', 0xf6: '̲', 0xf7: '̦',
  0xf8: '̜', 0xf9: '̮', 0xfa: '︢', 0xfb: '︣', 0xfe: '̓',
}

export function decodeAnsel(bytes) {
  let out = ''
  let pending = ''
  for (const byte of bytes) {
    if (ANSEL_COMBINING[byte]) {
      pending += ANSEL_COMBINING[byte]
      continue
    }
    const char = byte < 0x80 ? String.fromCharCode(byte) : (ANSEL_SPECIALS[byte] ?? '�')
    out += char + pending
    pending = ''
  }
  return (out + pending).normalize('NFC')
}

function declaredCharset(bytes) {
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 8192))
  const match = head.match(/^\s*1\s+CHAR\s+([^\r\n]+)/m)
  return match ? match[1].trim().toUpperCase() : ''
}

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

export function decodeGedcomBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  // UTF-16 sans marque : « 0 HEAD » commence par « 0 » suivi d'un octet nul
  if (bytes[0] === 0x30 && bytes[1] === 0x00) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' }
  if (bytes[0] === 0x00 && bytes[1] === 0x30) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' }

  const declared = declaredCharset(bytes)
  if (declared === 'ANSEL') return { text: decodeAnsel(bytes), encoding: 'ansel' }
  if (isValidUtf8(bytes)) return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' }
  if (declared.startsWith('MAC')) return { text: new TextDecoder('macintosh').decode(bytes), encoding: 'macintosh' }
  return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
}

export async function readGedcomFile(file) {
  return decodeGedcomBytes(new Uint8Array(await file.arrayBuffer()))
}
