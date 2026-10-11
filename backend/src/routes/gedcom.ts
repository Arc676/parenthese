import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { UPLOAD_BODY_LIMIT } from '../config/env.js'
import { indexObjeRecords, photoPathForPerson } from '../lib/gedcom-photos.js'
import type { MembershipRole } from '../types/auth.js'

const treeIdParamSchema = z.object({
  id: z.string().min(1),
})

const importBodySchema = z.object({
  content: z.string().min(1).max(10 * 1024 * 1024),
})

// Un fichier GEDCOM vient de l'extérieur : longueur des lignes, nombre de fiches et taille des champs
// plafonnés comme partout ailleurs (sinon un seul fichier bloque l'API ou remplit la base)
const MAX_LINE_LENGTH = 4096
const MAX_IMPORTED_PERSONS = 20000
const MAX_IMPORTED_FAMILIES = 20000
// Le parseur construit un objet par ligne : 10 Mo de lignes courtes montaient à 370 Mo de mémoire, et le
// redémarrage pm2 qui suivait effaçait les limites d'essais gardées en mémoire. Au-delà, le fichier est refusé.
const MAX_GEDCOM_NODES = 300_000
const MAX_IMPORTED_LINKS = 60_000

class GedcomTooLargeError extends Error {}

// Un import à la fois sur toute l'instance : chacun tient une connexion de la base pendant sa transaction
let importInProgress = false

function clip(value: string | null, max: number): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

// Export : un champ sur une ligne ne doit jamais en créer une autre (enregistrement injecté)
function oneLine(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ')
}

function hasAdminRight(role: MembershipRole): boolean {
  return role === 'owner' || role === 'admin'
}

// ─── GEDCOM Parser ─────────────────────────────────────────────────────────

type GedcomNode = {
  level: number
  xref?: string
  tag: string
  value: string
  children: GedcomNode[]
}

export function parseGedcom(text: string): GedcomNode[] {
  const lines = text.split(/\r\n|\r|\n/)
  const roots: GedcomNode[] = []
  const stack: GedcomNode[] = []
  let nodeCount = 0

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.length > MAX_LINE_LENGTH) continue
    nodeCount += 1
    if (nodeCount > MAX_GEDCOM_NODES) throw new GedcomTooLargeError()

    const match = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\w+)(?:\s+(.*))?$/)
    if (!match) continue

    const level = parseInt(match[1], 10)
    const xref = match[2] ? match[2].slice(1, -1) : undefined
    const tag = match[3]
    const value = match[4]?.trim() ?? ''

    const node: GedcomNode = { level, xref, tag, value, children: [] }

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }

    stack.push(node)
  }

  return roots
}

function findChild(node: GedcomNode | undefined, tag: string): GedcomNode | undefined {
  return node?.children.find((child) => child.tag === tag)
}

function findAllChildren(node: GedcomNode | undefined, tag: string): GedcomNode[] {
  return node?.children.filter((child) => child.tag === tag) ?? []
}

// ─── Date Conversion ────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

const MONTHS_ARR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function gedcomDateToIso(value: string): string | null {
  if (!value) return null
  // Remove qualifiers (ABT, BEF, AFT, EST, CAL, etc.)
  const cleaned = value.trim().toUpperCase().replace(/^(ABT|BEF|AFT|EST|CAL|INT|FROM|TO|BET|AND)\s+/, '')

  // "15 JAN 1900" → "1900-01-15"
  const ddMmmYyyy = cleaned.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/)
  if (ddMmmYyyy) {
    const month = MONTH_MAP[ddMmmYyyy[2]]
    if (month) return `${ddMmmYyyy[3]}-${month}-${ddMmmYyyy[1].padStart(2, '0')}`
  }

  // "JAN 1900" → "1900-01"
  const mmmYyyy = cleaned.match(/^([A-Z]{3})\s+(\d{4})$/)
  if (mmmYyyy) {
    const month = MONTH_MAP[mmmYyyy[1]]
    if (month) return `${mmmYyyy[2]}-${month}`
  }

  // "1900" → "1900"
  if (/^\d{4}$/.test(cleaned)) return cleaned

  return null
}

function isoDateToDbDate(iso: string | null): Date | null {
  if (!iso) return null
  if (/^\d{4}$/.test(iso)) return new Date(`${iso}-01-01T00:00:00.000Z`)
  if (/^\d{4}-\d{2}$/.test(iso)) return new Date(`${iso}-01T00:00:00.000Z`)
  return new Date(`${iso}T00:00:00.000Z`)
}

function isoToGedcomDate(value: string | Date | null): string | null {
  if (!value) return null
  const str = value instanceof Date ? value.toISOString().split('T')[0] : String(value)

  const full = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (full) {
    const month = MONTHS_ARR[parseInt(full[2], 10) - 1]
    if (month) return `${parseInt(full[3], 10)} ${month} ${full[1]}`
  }

  const partial = str.match(/^(\d{4})-(\d{2})$/)
  if (partial) {
    const month = MONTHS_ARR[parseInt(partial[2], 10) - 1]
    if (month) return `${month} ${partial[1]}`
  }

  if (/^\d{4}$/.test(str)) return str
  return null
}

// ─── Name Parsing ────────────────────────────────────────────────────────────

// « Jean /Dupont/ » : lu par indexOf, l'ancienne expression régulière était quadratique sur les espaces
function parseGedcomName(value: string): { firstName: string; lastName: string } {
  const open = value.indexOf('/')
  const close = open >= 0 ? value.indexOf('/', open + 1) : -1
  if (open >= 0 && close > open) {
    const before = value.slice(0, open).trim()
    const after = value.slice(close + 1).trim()
    return {
      firstName: before || after,
      lastName: value.slice(open + 1, close).trim(),
    }
  }
  return { firstName: value.trim(), lastName: '' }
}

// Réimport : une personne du fichier déjà présente dans l'arbre (même prénom, nom, naissance et décès)
// est reprise au lieu d'être créée une seconde fois
function personKey(firstName: string, lastName: string, birthDate: Date | null, deathDate: Date | null): string {
  const norm = (value: string) => value.normalize('NFC').trim().toLowerCase()
  const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : '')
  return [norm(firstName), norm(lastName), day(birthDate), day(deathDate)].join('|')
}

function pairKey(a: string, b: string | null): string {
  return b ? [a, b].sort().join('|') : `${a}|`
}

function sanitizeXref(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_')
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export const gedcomRoutes: FastifyPluginAsync = async (app) => {
  // Export
  app.get('/trees/:id/export/gedcom', async (request, reply) => {
    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const treeId = params.data.id
    const actor = request.actor

    if (!actor) {
      return reply.code(401).send({ error: 'authentication_required' })
    }

    let treeName = 'arbre'

    if (actor.kind === 'tree_access') {
      if (actor.treeId !== treeId) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      const tree = await app.prisma.tree.findFirst({
        where: { id: treeId, deletedAt: null },
        select: { name: true },
      })
      if (!tree) return reply.code(404).send({ error: 'tree_not_found' })
      treeName = tree.name
    } else {
      const membership = await app.prisma.treeMembership.findUnique({
        where: { treeId_userId: { treeId, userId: actor.userId } },
        include: { tree: { select: { deletedAt: true, name: true } } },
      })

      if (membership && !membership.tree.deletedAt) {
        treeName = membership.tree.name
      } else {
        const shared = await app.prisma.userTreeAccess.findUnique({
          where: { treeId_userId: { treeId, userId: actor.userId } },
          include: { tree: { select: { deletedAt: true, name: true } } },
        })
        if (!shared || shared.tree.deletedAt) {
          return reply.code(403).send({ error: 'forbidden' })
        }
        treeName = shared.tree.name
      }
    }

    const [persons, unions, links] = await Promise.all([
      app.prisma.person.findMany({ where: { treeId, deletedAt: null } }),
      app.prisma.union.findMany({ where: { treeId, deletedAt: null } }),
      app.prisma.parentChildLink.findMany({ where: { treeId, deletedAt: null } }),
    ])

    const personById = new Map(persons.map((p) => [p.id, p]))

    // ── Build all cross-reference maps first (needed for FAMS/FAMC in INDI) ──

    // Map: "parentA|parentB" (sorted) → unionId
    const unionByPair = new Map<string, string>()
    for (const union of unions) {
      if (union.partner1PersonId && union.partner2PersonId) {
        const [a, b] = [union.partner1PersonId, union.partner2PersonId].sort()
        unionByPair.set(`${a}|${b}`, union.id)
      }
    }

    // Map: personId → first unionId where that person is a partner (fallback only)
    const firstUnionOfPerson = new Map<string, string>()
    for (const union of unions) {
      if (union.partner1PersonId && !firstUnionOfPerson.has(union.partner1PersonId)) {
        firstUnionOfPerson.set(union.partner1PersonId, union.id)
      }
      if (union.partner2PersonId && !firstUnionOfPerson.has(union.partner2PersonId)) {
        firstUnionOfPerson.set(union.partner2PersonId, union.id)
      }
    }

    // Gather all parent IDs per child
    const parentsByChild = new Map<string, string[]>()
    for (const link of links) {
      const arr = parentsByChild.get(link.childPersonId) ?? []
      if (!arr.includes(link.parentPersonId)) arr.push(link.parentPersonId)
      parentsByChild.set(link.childPersonId, arr)
    }

    // Assign each child to a union FAM
    const childrenByUnion = new Map<string, Set<string>>()
    for (const link of links) {
      const childId = link.childPersonId
      let unionId: string | undefined

      if (link.viaUnionId) {
        unionId = link.viaUnionId
      } else {
        const parents = parentsByChild.get(childId) ?? []
        for (let i = 0; i < parents.length; i++) {
          for (let j = i + 1; j < parents.length; j++) {
            const [a, b] = [parents[i], parents[j]].sort()
            const found = unionByPair.get(`${a}|${b}`)
            if (found) { unionId = found; break }
          }
          if (unionId) break
        }
        if (!unionId) unionId = firstUnionOfPerson.get(link.parentPersonId)
      }

      if (!unionId) continue
      const set = childrenByUnion.get(unionId) ?? new Set()
      set.add(childId)
      childrenByUnion.set(unionId, set)
    }

    // FAMS: personId → [unionIds where person is a spouse]
    const famsByPerson = new Map<string, string[]>()
    for (const union of unions) {
      for (const pid of [union.partner1PersonId, union.partner2PersonId]) {
        if (!pid) continue
        const arr = famsByPerson.get(pid) ?? []
        arr.push(union.id)
        famsByPerson.set(pid, arr)
      }
    }

    // FAMC: personId → [unionIds where person appears as CHIL]
    const famcByPerson = new Map<string, string[]>()
    for (const [unionId, childSet] of childrenByUnion) {
      for (const childId of childSet) {
        const arr = famcByPerson.get(childId) ?? []
        arr.push(unionId)
        famcByPerson.set(childId, arr)
      }
    }

    // ── Write GEDCOM ──
    const lines: string[] = []
    const now = new Date()
    const nowDate = `${now.getDate()} ${MONTHS_ARR[now.getMonth()]} ${now.getFullYear()}`

    lines.push('0 HEAD')
    lines.push('1 SOUR ArbreGeneralogique')
    lines.push('1 VERS 1.0')
    lines.push(`1 DATE ${nowDate}`)
    lines.push('1 CHAR UTF-8')
    lines.push('1 GEDC')
    lines.push('2 VERS 5.5.1')

    for (const person of persons) {
      const xref = sanitizeXref(person.id)
      lines.push(`0 @I${xref}@ INDI`)
      lines.push(`1 NAME ${oneLine(person.firstName)} /${oneLine(person.lastName).replace(/\//g, '')}/`)

      if (person.sex === 'male' || person.sex === 'M') lines.push('1 SEX M')
      else if (person.sex === 'female' || person.sex === 'F') lines.push('1 SEX F')

      const birthDate = isoToGedcomDate(person.birthDate)
      if (birthDate || person.birthPlace) {
        lines.push('1 BIRT')
        if (birthDate) lines.push(`2 DATE ${birthDate}`)
        if (person.birthPlace) lines.push(`2 PLAC ${oneLine(person.birthPlace)}`)
      }

      const deathDate = isoToGedcomDate(person.deathDate)
      if (deathDate) {
        lines.push('1 DEAT')
        lines.push(`2 DATE ${deathDate}`)
      }

      if (person.profession) lines.push(`1 OCCU ${oneLine(person.profession)}`)

      if (person.notes) {
        const noteLines = person.notes.split(/\r\n|\r|\n/)
        lines.push(`1 NOTE ${noteLines[0]}`)
        for (let i = 1; i < noteLines.length; i++) {
          lines.push(`2 CONT ${noteLines[i]}`)
        }
      }

      // FAMS: links this person to their own family (as spouse)
      for (const uid of famsByPerson.get(person.id) ?? []) {
        lines.push(`1 FAMS @F${sanitizeXref(uid)}@`)
      }

      // FAMC: links this person to their parent family (as child)
      for (const uid of famcByPerson.get(person.id) ?? []) {
        lines.push(`1 FAMC @F${sanitizeXref(uid)}@`)
      }
    }

    // ── Write FAM records ──
    for (const union of unions) {
      const xref = sanitizeXref(union.id)
      lines.push(`0 @F${xref}@ FAM`)

      const p1 = union.partner1PersonId ? personById.get(union.partner1PersonId) : null
      const p2 = union.partner2PersonId ? personById.get(union.partner2PersonId) : null

      const p1IsFemale = p1?.sex === 'female' || p1?.sex === 'F'
      const p1IsMale = p1?.sex === 'male' || p1?.sex === 'M'
      const p2IsMale = p2?.sex === 'male' || p2?.sex === 'M'

      // Swap to HUSB=male if we know p1 is female and p2 is male (or unknown)
      const shouldSwap = p1IsFemale && !p2IsMale === false ? false : p1IsFemale && (p2IsMale || !p1IsMale)
      const husbId = shouldSwap ? union.partner2PersonId : union.partner1PersonId
      const wifeId = shouldSwap ? union.partner1PersonId : union.partner2PersonId

      if (husbId) lines.push(`1 HUSB @I${sanitizeXref(husbId)}@`)
      if (wifeId && wifeId !== husbId) lines.push(`1 WIFE @I${sanitizeXref(wifeId)}@`)

      for (const childId of childrenByUnion.get(union.id) ?? []) {
        lines.push(`1 CHIL @I${sanitizeXref(childId)}@`)
      }

      const marriageDate = isoToGedcomDate(union.startDate)
      if (marriageDate) {
        lines.push('1 MARR')
        lines.push(`2 DATE ${marriageDate}`)
      }
    }

    lines.push('0 TRLR')

    const content = lines.join('\r\n')
    const filename = treeName.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.ged'

    reply.header('Content-Type', 'text/x-gedcom; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    return reply.send(content)
  })

  // Import
  app.post('/trees/:id/import/gedcom', { bodyLimit: UPLOAD_BODY_LIMIT, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const params = treeIdParamSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_tree_id' })
    }

    const body = importBodySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_payload', details: body.error.flatten() })
    }

    const actor = request.actor
    if (!actor || actor.kind !== 'user') {
      return reply.code(401).send({ error: 'authentication_required' })
    }

    const treeId = params.data.id

    const membership = await app.prisma.treeMembership.findUnique({
      where: { treeId_userId: { treeId, userId: actor.userId } },
      include: { tree: { select: { deletedAt: true } } },
    })

    if (!membership || membership.tree.deletedAt) {
      return reply.code(404).send({ error: 'tree_not_found' })
    }

    if (!hasAdminRight(membership.role)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    if (importInProgress) {
      return reply.code(429).send({ error: 'gedcom_import_busy' })
    }

    let roots: GedcomNode[]
    try {
      roots = parseGedcom(body.data.content)
    } catch (error) {
      if (error instanceof GedcomTooLargeError) {
        return reply.code(413).send({ error: 'gedcom_too_large' })
      }
      throw error
    }

    const indiNodes = roots.filter((node) => node.tag === 'INDI' && node.xref)
    const famNodes = roots.filter((node) => node.tag === 'FAM' && node.xref)
    const childLinkCount = famNodes.reduce((total, fam) => total + findAllChildren(fam, 'CHIL').length, 0)

    if (indiNodes.length > MAX_IMPORTED_PERSONS || famNodes.length > MAX_IMPORTED_FAMILIES || childLinkCount > MAX_IMPORTED_LINKS) {
      return reply.code(413).send({ error: 'gedcom_too_large' })
    }

    const xrefToPersonId = new Map<string, string>()
    const objeByXref = indexObjeRecords(roots)
    const photoRefs: Array<{ personId: string; file: string }> = []

    // Ce que l'arbre contient déjà : un second import du même fichier complète l'arbre sans rien doubler.
    // Chaque personne existante ne sert qu'une fois, deux fiches identiques du fichier restent deux personnes.
    const [existingPersons, existingUnions, existingLinks] = await Promise.all([
      app.prisma.person.findMany({
        where: { treeId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, birthDate: true, deathDate: true, avatarPath: true },
      }),
      app.prisma.union.findMany({ where: { treeId, deletedAt: null }, select: { id: true, partner1PersonId: true, partner2PersonId: true } }),
      app.prisma.parentChildLink.findMany({ where: { treeId, deletedAt: null }, select: { parentPersonId: true, childPersonId: true } }),
    ])
    const reusablePersons = new Map<string, Array<{ id: string; hasAvatar: boolean }>>()
    for (const person of existingPersons) {
      const key = personKey(person.firstName, person.lastName, person.birthDate, person.deathDate)
      if (!reusablePersons.has(key)) reusablePersons.set(key, [])
      reusablePersons.get(key)!.push({ id: person.id, hasAvatar: Boolean(person.avatarPath) })
    }
    const unionByPair = new Map(existingUnions.map((u) => [pairKey(u.partner1PersonId, u.partner2PersonId), u.id]))
    const linkKeys = new Set(existingLinks.map((l) => `${l.parentPersonId}:${l.childPersonId}`))

    let personsCreated = 0
    let personsReused = 0
    let unionsCreated = 0
    let linksCreated = 0

    importInProgress = true
    try {
    await app.prisma.$transaction(async (tx) => {
      for (const indi of indiNodes) {
        const nameNode = findChild(indi, 'NAME')
        const { firstName, lastName } = nameNode
          ? parseGedcomName(nameNode.value)
          : { firstName: '?', lastName: '' }

        const sexNode = findChild(indi, 'SEX')
        const sex = sexNode?.value === 'M' ? 'male' : sexNode?.value === 'F' ? 'female' : null

        const birtNode = findChild(indi, 'BIRT')
        const birthDateIso = gedcomDateToIso(findChild(birtNode, 'DATE')?.value ?? '')
        const birthPlace = clip(findChild(birtNode, 'PLAC')?.value ?? null, 200)

        const deatNode = findChild(indi, 'DEAT')
        const deathDateIso = gedcomDateToIso(findChild(deatNode, 'DATE')?.value ?? '')

        const profession = clip(findChild(indi, 'OCCU')?.value ?? null, 200)

        const noteNode = findChild(indi, 'NOTE')
        let notes: string | null = null
        if (noteNode?.value) {
          const contLines = findAllChildren(noteNode, 'CONT').map((n) => n.value)
          notes = clip([noteNode.value, ...contLines].join('\n'), 2000)
        }

        const personFirstName = (firstName || '?').slice(0, 120)
        const personLastName = (lastName || '').slice(0, 120)
        const birthDate = isoDateToDbDate(birthDateIso)
        const deathDate = isoDateToDbDate(deathDateIso)
        const photoPath = photoPathForPerson(indi, objeByXref)

        const existing = reusablePersons.get(personKey(personFirstName, personLastName, birthDate, deathDate))?.shift()
        if (existing) {
          xrefToPersonId.set(indi.xref!, existing.id)
          personsReused++
          // Une personne qui a déjà son portrait le garde
          if (photoPath && !existing.hasAvatar) photoRefs.push({ personId: existing.id, file: photoPath })
          continue
        }

        const person = await tx.person.create({
          data: {
            treeId,
            firstName: personFirstName,
            lastName: personLastName,
            sex,
            birthDate,
            deathDate,
            birthPlace,
            profession,
            notes,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          },
        })

        xrefToPersonId.set(indi.xref!, person.id)
        personsCreated++
        if (photoPath) photoRefs.push({ personId: person.id, file: photoPath })
      }

      for (const fam of famNodes) {
        const husbXref = findChild(fam, 'HUSB')?.value?.replace(/@/g, '').trim()
        const wifeXref = findChild(fam, 'WIFE')?.value?.replace(/@/g, '').trim()

        const partner1Id = husbXref ? xrefToPersonId.get(husbXref) : undefined
        const partner2Id = wifeXref ? xrefToPersonId.get(wifeXref) : undefined

        if (!partner1Id && !partner2Id) continue

        const marrNode = findChild(fam, 'MARR')
        const marriageDateIso = gedcomDateToIso(findChild(marrNode, 'DATE')?.value ?? '')

        const firstPartner = partner1Id ?? partner2Id!
        const secondPartner = partner1Id ? (partner2Id ?? null) : null
        let unionId = unionByPair.get(pairKey(firstPartner, secondPartner))
        if (!unionId) {
          const union = await tx.union.create({
            data: {
              treeId,
              partner1PersonId: firstPartner,
              partner2PersonId: secondPartner,
              startDate: isoDateToDbDate(marriageDateIso),
            },
          })
          unionId = union.id
          unionByPair.set(pairKey(firstPartner, secondPartner), unionId)
          unionsCreated++
        }

        const chilNodes = findAllChildren(fam, 'CHIL')
        const seenChildren = new Set<string>()

        for (const chilNode of chilNodes) {
          const chilXref = chilNode.value?.replace(/@/g, '').trim()
          if (!chilXref || seenChildren.has(chilXref)) continue
          seenChildren.add(chilXref)

          const childId = xrefToPersonId.get(chilXref)
          if (!childId) continue

          const parentIds = [partner1Id, partner2Id].filter((id): id is string => Boolean(id))

          for (const parentId of parentIds) {
            const linkKey = `${parentId}:${childId}`
            if (linkKeys.has(linkKey)) continue
            await tx.parentChildLink.create({
              data: {
                treeId,
                parentPersonId: parentId,
                childPersonId: childId,
                viaUnionId: unionId,
              },
            })
            linkKeys.add(linkKey)
            linksCreated++
          }
        }
      }

      await tx.auditLog.create({
        data: {
          treeId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'gedcom_imported',
          entityType: 'tree',
          entityId: treeId,
          payloadJson: { personsCreated, personsReused, unionsCreated, linksCreated, photoRefs: photoRefs.length },
        },
      })
    }, { timeout: 60000 })
    } finally {
      importInProgress = false
    }

    // photoRefs : chemin de la photo que le logiciel d'origine associait à chaque personne (rien n'est gardé)
    return reply.send({ personsCreated, personsReused, unionsCreated, linksCreated, photoRefs })
  })
}
