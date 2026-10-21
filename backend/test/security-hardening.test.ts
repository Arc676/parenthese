import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import { sanitizeAnnotationContentForRead, sanitizeAnnotationContentForWrite } from '../src/lib/annotation-content.js'
import { isMimeAllowedForType, sanitizeImage, scrubMp4Location, sniffMimeType } from '../src/lib/media-files.js'
import { matchSharePassword } from '../src/lib/password-variants.js'
import {
  isTreeUnlockLocked,
  recordTreeUnlockFailure,
  reserveTreeUnlockAttempt,
  resetTreeUnlockGuard,
  serializePasswordCheck,
} from '../src/lib/unlock-guard.js'

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')

function accepted(buf: Buffer, type: Parameters<typeof sniffMimeType>[1], fileName = ''): string | null {
  const mime = sniffMimeType(buf, type, fileName)
  return mime && isMimeAllowedForType(type, mime) ? mime : null
}

describe('fichiers envoyés : type lu dans les octets', () => {
  it('refuse un SVG envoyé comme photo', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(accepted(svg, 'photo', 'chat.svg')).toBeNull()
  })

  it('refuse du HTML déguisé en PNG', () => {
    expect(accepted(Buffer.from('<html><script>alert(1)</script></html>'), 'photo', 'photo.png')).toBeNull()
  })

  it('reconnaît une vraie photo PNG quel que soit le nom', () => {
    expect(accepted(PNG_1PX, 'photo', 'photo.jpg')).toBe('image/png')
  })

  it('accepte un tracé GPX et refuse un document XHTML envoyé comme GPX', () => {
    expect(accepted(Buffer.from('<?xml version="1.0"?>\n<gpx version="1.1"></gpx>'), 'gpx')).toBe('application/gpx+xml')
    expect(accepted(Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><script>1</script></html>'), 'gpx')).toBeNull()
  })

  it('refuse un document texte qui commence par une balise', () => {
    expect(accepted(Buffer.from('<!doctype html><script>1</script>'), 'document', 'note.txt')).toBeNull()
    expect(accepted(Buffer.from('Souvenir de la ferme'), 'document', 'note.txt')).toBe('text/plain')
  })

  it('refuse une image envoyée comme GeoJSON', () => {
    expect(accepted(PNG_1PX, 'geojson')).toBeNull()
    expect(accepted(Buffer.from('{"type":"FeatureCollection","features":[]}'), 'geojson')).toBe('application/geo+json')
  })
})

// Boîte ftyp minimale : taille, « ftyp », marque principale
function ftypBox(brand: string): Buffer {
  const box = Buffer.alloc(24)
  box.writeUInt32BE(24, 0)
  box.write('ftyp', 4, 'latin1')
  box.write(brand, 8, 'latin1')
  return box
}

describe('HEIC et AVIF : reconnus, jamais pris pour une vidéo', () => {
  it.each(['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'])('marque %s : image/heic, refusée à l’envoi', (brand) => {
    expect(sniffMimeType(ftypBox(brand), 'photo', 'IMG_0001.HEIC')).toBe('image/heic')
    expect(accepted(ftypBox(brand), 'photo', 'IMG_0001.HEIC')).toBeNull()
    expect(accepted(ftypBox(brand), 'video', 'IMG_0001.MOV')).toBeNull()
  })

  it('marque avif : image/avif, refusée à l’envoi (pas de conversion)', () => {
    expect(sniffMimeType(ftypBox('avif'), 'photo')).toBe('image/avif')
    expect(accepted(ftypBox('avif'), 'photo')).toBeNull()
  })

  it('marque hevc : image/heic quand l’envoi se déclare photo, vidéo MP4 sinon (une vidéo HEVC reste acceptée)', () => {
    expect(sniffMimeType(ftypBox('hevc'), 'photo')).toBe('image/heic')
    expect(accepted(ftypBox('hevc'), 'video')).toBe('video/mp4')
  })

  it('les vidéos MP4 et QuickTime ne changent pas', () => {
    expect(accepted(ftypBox('isom'), 'video')).toBe('video/mp4')
    expect(accepted(ftypBox('mp42'), 'video')).toBe('video/mp4')
    expect(accepted(ftypBox('qt  '), 'video')).toBe('video/quicktime')
    expect(accepted(ftypBox('M4A '), 'audio')).toBe('audio/mp4')
  })

  it('une image HEIC n’entre dans aucun type de média autorisé', () => {
    expect(isMimeAllowedForType('photo', 'image/heic')).toBe(false)
    expect(isMimeAllowedForType('photo', 'image/avif')).toBe(false)
  })
})

describe('photos : métadonnées retirées, rotation appliquée', () => {
  it('retire le GPS et tourne les pixels selon l orientation du téléphone', async () => {
    const withGps = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 60 } } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '50/1 37/1 5/1' } })
      .toBuffer()
    expect((await sharp(withGps).metadata()).exif).toBeDefined()

    const cleaned = await sanitizeImage(withGps, 'image/jpeg')
    const meta = await sharp(cleaned).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.width).toBe(48)
    expect(meta.height).toBe(64)
  })

  it('refuse une image illisible', async () => {
    await expect(sanitizeImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]), 'image/jpeg')).rejects.toThrow('invalid_image')
  })
})

describe('vidéos : position ISO 6709 remise à zéro dans moov seulement', () => {
  function box(type: string, payload: Buffer): Buffer {
    const header = Buffer.alloc(8)
    header.writeUInt32BE(8 + payload.length, 0)
    header.write(type, 4, 'latin1')
    return Buffer.concat([header, payload])
  }

  it('efface les coordonnées de moov sans toucher à mdat', () => {
    const ftyp = box('ftyp', Buffer.from('isom0000'))
    const mdat = box('mdat', Buffer.from('+50.6300+003.0600/ donnees'))
    const moov = box('moov', Buffer.from('udta xyz +50.6300+003.0600+025.000/ fin'))
    const scrubbed = scrubMp4Location(Buffer.concat([ftyp, mdat, moov])).toString('latin1')
    expect(scrubbed).toContain('+00.0000+000.0000+000.000/ fin')
    expect(scrubbed).toContain('+50.6300+003.0600/ donnees')
  })
})

describe('annotations photo : jamais d adresse enregistrée', () => {
  const treeId = 'tree-1'

  it('retire l adresse (et la session qu elle portait) à l écriture', () => {
    const content = JSON.stringify({ photoPath: `/trees/${treeId}/annotation-photos/abc-123`, url: '/api/x?token=SESSION', w: 1, h: 1 })
    const stored = sanitizeAnnotationContentForWrite(content, treeId)
    expect(stored).not.toContain('token')
    expect(JSON.parse(stored)).toEqual({ photoPath: `/trees/${treeId}/annotation-photos/abc-123`, w: 1, h: 1 })
  })

  it('refuse un chemin de photo d un autre arbre ou une adresse externe', () => {
    expect(() => sanitizeAnnotationContentForWrite(JSON.stringify({ photoPath: '/trees/autre/annotation-photos/abc' }), treeId)).toThrow()
    expect(() => sanitizeAnnotationContentForWrite(JSON.stringify({ url: 'https://pisteur.example/pixel.gif' }), treeId)).toThrow()
  })

  it('nettoie les anciennes valeurs à la lecture et laisse le reste intact', () => {
    expect(sanitizeAnnotationContentForRead(JSON.stringify({ photoPath: '/p', url: '/x?token=S' }))).toBe(JSON.stringify({ photoPath: '/p' }))
    expect(sanitizeAnnotationContentForRead('Mamie à 20 ans')).toBe('Mamie à 20 ans')
    expect(sanitizeAnnotationContentForRead(JSON.stringify({ paths: [] }))).toBe(JSON.stringify({ paths: [] }))
  })
})

describe('mot de passe de partage', () => {
  it('ne compare qu une fois quand les deux colonnes portent le même hash', async () => {
    const verify = vi.fn(async () => false)
    await matchSharePassword('abcdefgh', ['h1', 'h1'], verify)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('verrouille un arbre après 30 échecs dans la fenêtre, puis le libère', () => {
    resetTreeUnlockGuard()
    const now = Date.now()
    for (let i = 0; i < 29; i += 1) recordTreeUnlockFailure('tree-x', now)
    expect(isTreeUnlockLocked('tree-x', now)).toBe(false)
    recordTreeUnlockFailure('tree-x', now)
    expect(isTreeUnlockLocked('tree-x', now)).toBe(true)
    expect(isTreeUnlockLocked('tree-autre', now)).toBe(false)
    expect(isTreeUnlockLocked('tree-x', now + 16 * 60 * 1000)).toBe(false)
  })

  it('compte l essai avant la vérification : une rafale simultanée ne dépasse pas le plafond', () => {
    resetTreeUnlockGuard()
    const now = Date.now()
    const reservations = Array.from({ length: 60 }, () => reserveTreeUnlockAttempt('tree-rafale', now))
    expect(reservations.filter(Boolean)).toHaveLength(30)
    expect(isTreeUnlockLocked('tree-rafale', now)).toBe(true)
  })

  it('rend la place d un essai réussi', () => {
    resetTreeUnlockGuard()
    const now = Date.now()
    for (let i = 0; i < 29; i += 1) reserveTreeUnlockAttempt('tree-ok', now)
    const release = reserveTreeUnlockAttempt('tree-ok', now)
    expect(isTreeUnlockLocked('tree-ok', now)).toBe(true)
    release?.()
    expect(isTreeUnlockLocked('tree-ok', now)).toBe(false)
  })

  it('refuse au-delà de 20 comparaisons en attente au lieu d allonger la file', async () => {
    let unblock: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { unblock = resolve })
    const runs = Array.from({ length: 25 }, () => serializePasswordCheck(() => gate.then(() => true)))
    expect(runs.filter((run) => run === null)).toHaveLength(5)
    unblock()
    await Promise.all(runs.filter(Boolean))
    expect(serializePasswordCheck(async () => true)).not.toBeNull()
  })
})

describe('vidéos : position effacée en temps linéaire', () => {
  it('traite un faux MP4 de 2 Mo piégé pour l expression régulière en moins d une seconde', () => {
    const body = Buffer.from('+1+1CRS'.repeat(300_000), 'latin1')
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length + 8, 0)
    head.write('moov', 4, 'latin1')
    const started = Date.now()
    scrubMp4Location(Buffer.concat([head, body]))
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('efface toujours une position avec altitude et système de coordonnées', () => {
    const position = '+48.8584+002.2945+035.000CRSWGS_84/'
    const head = Buffer.alloc(8)
    head.writeUInt32BE(position.length + 8, 0)
    head.write('moov', 4, 'latin1')
    const out = scrubMp4Location(Buffer.concat([head, Buffer.from(position, 'latin1')]))
    expect(out.subarray(8).toString('latin1')).toBe('+00.0000+000.0000+000.000CRSWGS_00/')
  })
})

describe('GIF', () => {
  it('réencode un GIF et retire ses blocs de commentaire', async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#808080' } }).gif().toBuffer()
    const comment = Buffer.concat([Buffer.from([0x21, 0xfe, 0x0b]), Buffer.from('secret-XMP!'), Buffer.from([0x00])])
    const withComment = Buffer.concat([gif.subarray(0, gif.length - 1), comment, Buffer.from([0x3b])])
    const out = await sanitizeImage(withComment, 'image/gif')
    expect(out.subarray(0, 6).toString('latin1')).toMatch(/^GIF8[79]a$/)
    expect(out.includes(Buffer.from('secret-XMP!'))).toBe(false)
  })
})
