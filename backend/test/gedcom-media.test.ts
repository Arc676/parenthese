import { describe, expect, it } from 'vitest'

import { indexGedcomRecords, localMediaPath, mediaRefsForPerson, photoPathForPerson, plainNoteText } from '../src/lib/gedcom-photos'
import { parseGedcom } from '../src/routes/gedcom'

// Pour chaque personne : son portrait et ses souvenirs, tels que l'import les renvoie
function mediaOf(text: string) {
  const roots = parseGedcom(text)
  const records = indexGedcomRecords(roots)
  const out: Record<string, { portrait: string | null; media: ReturnType<typeof mediaRefsForPerson> }> = {}
  for (const indi of roots.filter((n) => n.tag === 'INDI' && n.xref)) {
    const portrait = photoPathForPerson(indi, records.obje)
    out[indi.xref!] = { portrait, media: mediaRefsForPerson(indi, records, portrait) }
  }
  return out
}

describe('souvenirs cités par un GEDCOM', () => {
  it('Heredis PC : média sous la source citée d\u2019un événement, titre dans la note', () => {
    const text = [
      '0 HEAD',
      '1 SOUR Heredis PC2023',
      '0 @I1@ INDI',
      '1 NAME Louis Eugène Lucien /RAGOT/',
      '1 BIRT',
      '2 DATE 1879',
      '2 SOUR @S1@',
      '3 PAGE Acte n° 12',
      '3 OBJE @O1@',
      '0 @S1@ SOUR',
      '1 TITL Registre des naissances, Vendée',
      '0 @O1@ OBJE',
      '1 FILE C:/Users/Moi/Documents/Heredis/Médias/Naissance Ragot Louis Eugène Lucien.jpg',
      '2 FORM JPG',
      '1 NOTE Naissance Ragot Louis Eugène Lucien',
    ].join('\n')
    expect(mediaOf(text).I1).toEqual({
      portrait: null,
      media: [{
        file: 'C:/Users/Moi/Documents/Heredis/Médias/Naissance Ragot Louis Eugène Lucien.jpg',
        caption: 'Naissance Ragot Louis Eugène Lucien',
        source: 'Registre des naissances, Vendée, Acte n° 12',
      }],
    })
  })

  it('Heredis : média accroché à la fiche de la source elle-même', () => {
    const text = [
      '0 @I1@ INDI',
      '1 NAME Louis /RAGOT/',
      '1 EVEN',
      '2 TYPE Militaire',
      '2 SOUR @S2@',
      '0 @S2@ SOUR',
      '1 TITL Fiche matriculaire',
      '1 OBJE @O2@',
      '0 @O2@ OBJE',
      '1 FILE D:\\Généalogie\\Ragot Louis fiche matriculaire.pdf',
      '2 FORM PDF',
    ].join('\n')
    expect(mediaOf(text).I1.media).toEqual([{
      file: 'D:\\Généalogie\\Ragot Louis fiche matriculaire.pdf',
      caption: 'Ragot Louis fiche matriculaire',
      source: 'Fiche matriculaire',
    }])
  })

  it('Heredis Mac : note de titre en RTF', () => {
    expect(plainNoteText([
      '{\\rtf1\\ansi\\ansicpg1252\\cocoartf1561\\cocoasubrtf400',
      '{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}',
      '{\\colortbl;\\red255\\green255\\blue255;}',
      '{\\*\\expandedcolortbl;;}',
      '\\pard\\tx560\\tx1120\\pardirnatural\\partightenfactor0',
      '',
      "\\f0\\fs24 \\cf0 acte mariage Th\\'e9ophane V\\'c9NIEN avec Emma JEANDOT}",
    ].join('\n'))).toBe('acte mariage Théophane VÉNIEN avec Emma JEANDOT')
  })

  it('Gramps : renvoi sous un événement, titre sous FILE (GEDCOM 5.5.1)', () => {
    const text = [
      '0 @I1@ INDI',
      '1 NAME Marie /Martin/',
      '1 OBJE @M1@',
      '1 MARR',
      '2 OBJE @M2@',
      '0 @M1@ OBJE',
      '1 FILE photos/marie.jpg',
      '2 FORM jpg',
      '0 @M2@ OBJE',
      '1 FILE photos/mariage 1950.png',
      '2 FORM png',
      '2 TITL Mariage de Marie et Paul',
    ].join('\n')
    expect(mediaOf(text).I1).toEqual({
      portrait: 'photos/marie.jpg',
      media: [{ file: 'photos/mariage 1950.png', caption: 'Mariage de Marie et Paul', source: null }],
    })
  })

  it('RootsMagic : OBJE écrit sous la personne, le portrait _PRIM n\u2019est pas repris en souvenir', () => {
    const text = [
      '0 @I1@ INDI',
      '1 OBJE',
      '2 FILE C:\\RootsMagic\\Media\\jean portrait.jpg',
      '2 FORM jpg',
      '2 TITL Jean',
      '2 _PRIM Y',
      '1 OBJE',
      '2 FILE C:\\RootsMagic\\Media\\recensement 1906.jpg',
      '2 FORM jpg',
      '2 TITL Recensement de 1906',
      '2 _TYPE PHOTO',
    ].join('\n')
    expect(mediaOf(text).I1).toEqual({
      portrait: 'C:\\RootsMagic\\Media\\jean portrait.jpg',
      media: [{ file: 'C:\\RootsMagic\\Media\\recensement 1906.jpg', caption: 'Recensement de 1906', source: null }],
    })
  })

  it('Family Tree Maker : _PHOTO désigne le portrait, les autres deviennent des souvenirs', () => {
    const text = [
      '0 @I1@ INDI',
      '1 _PHOTO @O2@',
      '1 OBJE @O1@',
      '1 OBJE @O2@',
      '0 @O1@ OBJE',
      '1 FILE C:\\FTM\\Media\\groupe 1930.jpg',
      '2 FORM jpg',
      '2 TITL Toute la famille en 1930',
      '0 @O2@ OBJE',
      '1 FILE C:\\FTM\\Media\\portrait.jpg',
      '2 FORM jpg',
    ].join('\n')
    expect(mediaOf(text).I1).toEqual({
      portrait: 'C:\\FTM\\Media\\portrait.jpg',
      media: [{ file: 'C:\\FTM\\Media\\groupe 1930.jpg', caption: 'Toute la famille en 1930', source: null }],
    })
  })

  it('Ancestry, MyHeritage : les adresses web ne sont pas des fichiers de l\u2019ordinateur', () => {
    const text = [
      '0 @I1@ INDI',
      '1 OBJE',
      '2 FILE https://mediasvc.ancestry.com/v2/image/namespaces/1093/media/abc.jpg',
      '2 FORM jpg',
      '1 OBJE',
      '2 FORM url',
      '2 FILE www.exemple.org/acte',
    ].join('\n')
    expect(mediaOf(text).I1.media).toEqual([])
  })

  it('GEDCOM 7 : chemin en file://, type MIME et titre sous FILE', () => {
    const text = [
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 OBJE @O1@',
      '0 @O1@ OBJE',
      '1 FILE file:///C:/Archives/acte%20de%20d%C3%A9c%C3%A8s.pdf',
      '2 FORM application/pdf',
      '2 TITL Acte de décès',
    ].join('\n')
    expect(mediaOf(text).I1.media).toEqual([{ file: 'C:/Archives/acte de décès.pdf', caption: 'Acte de décès', source: null }])
  })

  it('acte de mariage accroché à la famille : souvenir des deux conjoints', () => {
    const text = [
      '0 @I1@ INDI',
      '1 NAME Paul /Durand/',
      '1 FAMS @F1@',
      '0 @I2@ INDI',
      '1 NAME Jeanne /Petit/',
      '1 FAMS @F1@',
      '0 @I3@ INDI',
      '1 NAME Enfant /Durand/',
      '1 FAMC @F1@',
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 WIFE @I2@',
      '1 CHIL @I3@',
      '1 MARR',
      '2 DATE 1922',
      '2 SOUR Registre des mariages de Lille',
      '3 OBJE',
      '4 FILE mariages/durand-petit 1922.jpg',
      '4 FORM jpg',
    ].join('\n')
    const out = mediaOf(text)
    const expected = [{ file: 'mariages/durand-petit 1922.jpg', caption: 'durand-petit 1922', source: 'Registre des mariages de Lille' }]
    expect(out.I1.media).toEqual(expected)
    expect(out.I2.media).toEqual(expected)
    expect(out.I3.media).toEqual([])
  })

  it('un fichier cité deux fois n\u2019est gardé qu\u2019une fois', () => {
    const text = [
      '0 @I1@ INDI',
      '1 BIRT',
      '2 OBJE @O1@',
      '1 BAPM',
      '2 OBJE @O1@',
      '1 OBJE',
      '2 FILE C:\\medias\\ACTE.PDF',
      '0 @O1@ OBJE',
      '1 FILE C:\\medias\\acte.pdf',
    ].join('\n')
    expect(mediaOf(text).I1.media.map((m) => m.file)).toEqual(['C:\\medias\\acte.pdf'])
  })
})

describe('localMediaPath', () => {
  it('garde les chemins locaux de fichiers connus, écarte le reste', () => {
    expect(localMediaPath('C:\\Photos\\jean.JPG')).toBe('C:\\Photos\\jean.JPG')
    expect(localMediaPath('/Users/moi/Heredis/acte.pdf')).toBe('/Users/moi/Heredis/acte.pdf')
    expect(localMediaPath('file:///home/moi/voix.mp3')).toBe('/home/moi/voix.mp3')
    expect(localMediaPath('https://exemple.org/photo.jpg')).toBeNull()
    expect(localMediaPath('C:\\Photos\\arbre.ged')).toBeNull()
    expect(localMediaPath('')).toBeNull()
  })
})
