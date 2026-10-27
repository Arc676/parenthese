import type { Annotation, MediaItem, MediaPersonTag, ParentChildLink, Person, Union } from '../generated/prisma/client.js'

import { sanitizeAnnotationContentForRead } from '../lib/annotation-content.js'
import { readAvatarCrop, type AvatarCrop } from '../lib/avatar-crop.js'
import { isImmichAvatarPath } from '../lib/media-files.js'
import { sexOrNull } from '../lib/person-sex.js'

export type GraphPayload = {
  persons: Array<{
    id: string
    firstName: string
    lastName: string
    birthName: string | null
    nickname: string | null
    birthDate: string | null
    deathDate: string | null
    isDeceased: boolean
    toVerify: boolean
    birthPlace: string | null
    deathPlace: string | null
    profession: string | null
    region: string | null
    nationality: string | null
    avatarUrlPath: string | null
    sex: string | null
    notes: string | null
    avatarFromImmich: boolean
    avatarCrop: AvatarCrop | null
    avatarBlurhash: string | null
  }>
  unions: Array<{
    id: string
    partner1PersonId: string
    partner2PersonId: string | null
    unionType: string | null
    startDate: string | null
    endDate: string | null
    displayOrder: number
  }>
  filiations: Array<{
    id: string
    parentPersonId: string
    childPersonId: string
    viaUnionId: string | null
    parentageType: string | null
    displayOrder: number
  }>
  medias: Array<{
    id: string
    personId: string
    type: string
    mimeType: string
    urlPath: string
    caption: string | null
    source: string | null
    displayOrder: number
    isFeatured: boolean
    blurhash: string | null
    // Personnes identifiées sur le souvenir, point facultatif sur le visage (0 à 1)
    people: Array<{ personId: string; x: number | null; y: number | null }>
  }>
  annotations: Array<{
    id: string
    type: string
    x: number
    y: number
    content: string
    style: unknown
    zIndex: number
    createdBy: string | null
  }>
}

function formatDate(value: Date | null): string | null {
  if (!value) {
    return null
  }

  return value.toISOString().split('T')[0]
}

export function buildGraphPayload(
  treeId: string,
  persons: Person[],
  unions: Union[],
  links: ParentChildLink[],
  medias: MediaItem[] = [],
  annotations: Annotation[] = [],
  mediaPeople: Pick<MediaPersonTag, 'mediaId' | 'personId' | 'x' | 'y'>[] = [],
): GraphPayload {
  // Une personne supprimée n'est plus montrée sur les photos où elle était identifiée
  const livingIds = new Set(persons.map((person) => person.id))
  const peopleByMedia = new Map<string, Array<{ personId: string; x: number | null; y: number | null }>>()
  for (const tag of mediaPeople) {
    if (!livingIds.has(tag.personId)) continue
    const list = peopleByMedia.get(tag.mediaId) ?? []
    list.push({ personId: tag.personId, x: tag.x, y: tag.y })
    peopleByMedia.set(tag.mediaId, list)
  }
  // Keep DB order from route queries to preserve sibling and union ordering semantics.
  return {
    persons: persons.map((person) => ({
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        birthName: person.birthName,
        nickname: person.nickname,
        birthDate: formatDate(person.birthDate),
        deathDate: formatDate(person.deathDate),
        isDeceased: Boolean(person.isDeceased) && !person.deathDate,
        toVerify: Boolean(person.toVerify),
        birthPlace: person.birthPlace,
        deathPlace: person.deathPlace,
        profession: person.profession,
        region: person.region,
        nationality: person.nationality,
        avatarUrlPath: person.avatarPath ? `/trees/${treeId}/persons/${person.id}/avatar` : null,
        sex: sexOrNull(person.sex),
        notes: person.notes,
        avatarFromImmich: isImmichAvatarPath(person.avatarPath),
        avatarCrop: person.avatarPath ? readAvatarCrop(person.avatarCrop) : null,
        avatarBlurhash: (person.avatarPath && person.avatarBlurhash) || null,
      })),
    unions: unions.map((union) => ({
        id: union.id,
        partner1PersonId: union.partner1PersonId,
        partner2PersonId: union.partner2PersonId,
        unionType: union.unionType,
        startDate: formatDate(union.startDate),
        endDate: formatDate(union.endDate),
        displayOrder: union.displayOrder,
      })),
    filiations: links.map((link) => ({
        id: link.id,
        parentPersonId: link.parentPersonId,
        childPersonId: link.childPersonId,
        viaUnionId: link.viaUnionId,
        parentageType: link.parentageType,
        displayOrder: link.displayOrder,
      })),
    medias: medias.map((media) => ({
        id: media.id,
        personId: media.personId,
        type: media.type,
        mimeType: media.mimeType,
        urlPath: media.mimeType === 'video/youtube' ? media.filePath : `/trees/${treeId}/media/${media.id}`,
        caption: media.caption,
        source: media.source,
        displayOrder: media.displayOrder,
        isFeatured: media.isFeatured,
        blurhash: media.blurhash || null,
        people: peopleByMedia.get(media.id) ?? [],
      })),
    annotations: annotations.map((ann) => ({
        id: ann.id,
        type: ann.type,
        x: ann.x,
        y: ann.y,
        content: sanitizeAnnotationContentForRead(ann.content),
        style: ann.style,
        zIndex: ann.zIndex,
        createdBy: ann.createdBy,
      })),
  }
}
