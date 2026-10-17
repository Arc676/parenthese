import { Buffer } from 'node:buffer'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readGedcomBundle, zipErrorMessage } from './gedcomBundle.js'
import { materializeFile, openZip } from './zipReader.js'
import { matchPhotoFiles } from './photoImport.js'

// Petit fabricant de zip pour les tests : fichiers stockés ou compressés, noms UTF-8 ou DOS
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { path, data, deflate = true, utf8 = true, nameBytes } of files) {
    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const body = deflate ? deflateRawSync(raw) : raw
    const name = nameBytes || new TextEncoder().encode(path)
    const flags = utf8 ? 0x0800 : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, Buffer.from(name), Buffer.from(body))
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(crc32(raw), 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, Buffer.from(name))
    offset += 30 + name.length + body.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return new File([Buffer.concat([...locals, centralBuf, eocd])], 'export.zip', { type: 'application/zip' })
}

const GED = '0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME Louis /Martin/\n1 OBJE\n2 FILE C:\\Généalogie\\Médias\\louis.jpg\n0 TRLR\n'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 0xff, 0xd9])

describe('import d’un zip', () => {
  it('un .ged seul passe tel quel', async () => {
    const file = new File([GED], 'arbre.ged', { type: 'text/plain' })
    const bundle = await readGedcomBundle(file)
    expect(bundle).toMatchObject({ gedcomFile: file, bundledFiles: [], fromZip: false })
  })

  it('trouve le .ged et les photos, laisse de côté les fichiers parasites', async () => {
    const zip = makeZip([
      { path: 'Export/Famille Martin.ged', data: GED },
      { path: 'Export/Médias/louis.jpg', data: JPEG, deflate: false },
      { path: 'Export/Médias/acte-naissance.pdf', data: '%PDF-1.4 vide' },
      { path: 'Export/notes.txt', data: 'rien' },
      { path: '__MACOSX/Export/._louis.jpg', data: 'x' },
      { path: 'Export/.DS_Store', data: 'x' },
    ])
    const bundle = await readGedcomBundle(zip)
    expect(bundle.fromZip).toBe(true)
    expect(bundle.gedcomFile.name).toBe('Famille Martin.ged')
    expect(await bundle.gedcomFile.text()).toBe(GED)
    expect(bundle.bundledFiles.map((f) => f.webkitRelativePath)).toEqual(['Export/Médias/louis.jpg', 'Export/Médias/acte-naissance.pdf'])

    // Rapprochés avec les chemins cités par le logiciel, comme un dossier, puis lus au moment de l'envoi
    const { matches } = matchPhotoFiles([{ personId: 'p1', file: 'C:\\Généalogie\\Médias\\louis.jpg' }], bundle.bundledFiles)
    expect(matches).toHaveLength(1)
    const file = await materializeFile(matches[0].file)
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG)
  })

  it('GEDZIP : gedcom.ged à la racine plutôt qu’un .ged rangé plus bas', async () => {
    const bundle = await readGedcomBundle(makeZip([
      { path: 'sauvegardes/ancien.ged', data: '0 HEAD\n0 TRLR\n' },
      { path: 'gedcom.ged', data: GED },
    ]))
    expect(bundle.gedcomFile.name).toBe('gedcom.ged')
  })

  it('noms de fichiers d’un zip Windows sans UTF-8 (page de code DOS)', async () => {
    // « Médias/é.jpg » en CP437 : é = 0x82
    const nameBytes = new Uint8Array([...new TextEncoder().encode('M'), 0x82, ...new TextEncoder().encode('dias/photo.jpg')])
    const zip = makeZip([{ path: 'arbre.ged', data: GED }, { path: '', nameBytes, data: JPEG, utf8: false }])
    const { entries } = await openZip(zip)
    expect(entries.map((e) => e.path)).toEqual(['arbre.ged', 'Médias/photo.jpg'])
  })

  it('dit clairement ce qui ne va pas', async () => {
    await expect(readGedcomBundle(makeZip([{ path: 'photo.jpg', data: JPEG }]))).rejects.toMatchObject({ code: 'no_gedcom' })
    expect(zipErrorMessage({ code: 'encrypted' })).toMatch(/mot de passe/)
    expect(zipErrorMessage({ code: 'zip64' })).toMatch(/4\sGo/)
    expect(zipErrorMessage(new Error('x'))).toMatch(/n’a pas pu être lu/)
  })
})
