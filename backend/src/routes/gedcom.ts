import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

import { UPLOAD_BODY_LIMIT } from '../config/env.js'
import { parseGedcomDate } from '../lib/gedcom-dates.js'
import { adoptedFamilies, FAMILY_EVENT_TYPES, familyExtras, PERSON_EVENT_TYPES, personExtras } from '../lib/gedcom-events.js'
import { indexGedcomRecords, mediaRefsForPerson, noteText, photoPathForPerson } from '../lib/gedcom-photos.js'
import type { GedcomRecords } from '../lib/gedcom-photos.js'
import type { MembershipRole } from '../types/auth.js'
import { nextSiblingOrder } from '../lib/sibling-order.js'
import { sexOrNull, type PersonSex } from '../lib/person-sex.js'

const treeIdParamSchema = z.object({
  id: z.string().min(1),
})

const importBodySchema = z.object({
  content: z.string().min(1).max(10 * 1024 * 1024),
})

// Un fichier GEDCOM vient de l'extérieur : longueur des lignes, nombre de fiches et taille des champs
// plafonnés comme partout ailleurs (sinon un seul fichier bloque l'API ou remplit la base)
const MAX_LINE_LENGTH = 4096
const MAX_GEDCOM_LEVEL = 99
// Remontées d'ascendance permises sur tout l'import : au-delà, les liens ne sont plus contrôlés (fichier hors norme)
const MAX_ANCESTRY_STEPS = 5_000_000
const MAX_IMPORTED_PERSONS = 20000
const MAX_IMPORTED_FAMILIES = 20000
// Le parseur construit un objet par ligne : 10 Mo de lignes courtes montaient à 370 Mo de mémoire, et le
// redémarrage pm2 qui suivait effaçait les limites d'essais gardées en mémoire. Au-delà, le fichier est refusé.
const MAX_GEDCOM_NODES = 300_000
const MAX_IMPORTED_LINKS = 60_000
// Fichiers cités renvoyés à l'app pour en faire des souvenirs : au-delà, la réponse deviendrait trop lourde
const MAX_IMPORTED_MEDIA_REFS = 20_000

class GedcomTooLargeError extends Error {}

// Un import à la fois sur toute l'instance : chacun tient une connexion de la base pendant sa transaction
let importInProgress = false

function clip(value: string | null, max: number): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

// Lieu d'un GEDCOM : les logiciels remplissent toutes les colonnes de leur format de lieu, même vides, et y
// glissent des codes. Heredis écrit « La Roche-sur-Yon,85191,Vendée,Pays de la Loire,France, » (ville, code
// INSEE, département, région, pays, subdivision). On garde les noms, sans case vide, sans code INSEE ni
// postal, sans répétition : « La Roche-sur-Yon, Vendée, Pays de la Loire, France ».
export function cleanGedcomPlace(value: string | null | undefined): string | null {
  if (!value) return null
  const parts: string[] = []
  for (const raw of value.split(',')) {
    const part = raw.trim()
    if (!part || /^(\d{4,5}|2[AB]\d{3})$/i.test(part)) continue
    if (parts.length && parts[parts.length - 1].toLowerCase() === part.toLowerCase()) continue
    parts.push(part)
  }
  return parts.length ? parts.join(', ') : null
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
  // Valeur telle qu'écrite, espaces compris : une ligne coupée en CONC se recolle sans rien perdre
  // (« pendant » + « 2 CONC  trente-cinq ans » ou « pendant  » + « 2 CONC trente-cinq ans »)
  rawValue?: string
  children: GedcomNode[]
}

export function parseGedcom(text: string): GedcomNode[] {
  const lines = text.split(/\r\n|\r|\n/)
  const roots: GedcomNode[] = []
  const stack: GedcomNode[] = []
  let nodeCount = 0

  for (const raw of lines) {
    const line = raw.replace(/^[\s﻿]+/, '')
    if (!line.trim() || line.length > MAX_LINE_LENGTH) continue
    nodeCount += 1
    if (nodeCount > MAX_GEDCOM_NODES) throw new GedcomTooLargeError()

    const match = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\w+)(?:[ \t](.*))?$/)
    if (!match) continue

    const level = parseInt(match[1], 10)
    // La norme s'arrête à 99 niveaux : au-delà, la lecture récursive de l'import déborderait la pile
    if (level > MAX_GEDCOM_LEVEL) continue
    const xref = match[2] ? match[2].slice(1, -1) : undefined
    const tag = match[3]
    const rawValue = match[4] ?? ''
    const value = rawValue.trim()

    const node: GedcomNode = { level, xref, tag, value, rawValue, children: [] }

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

const MONTHS_ARR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// Lecture complète dans lib/gedcom-dates.ts : vers, avant, après, entre, julien, républicain, double année
function gedcomDateToIso(value: string): string | null {
  return parseGedcomDate(value)?.iso ?? null
}

// Notes d'une personne : écrites sous elle ou partagées (« 1 NOTE @N1@ »), lignes recollées (CONT, CONC),
// RTF de Heredis Mac nettoyé. Plusieurs notes sont séparées par une ligne vide.
export function personNotes(indi: GedcomNode, records: GedcomRecords): string | null {
  const texts = findAllChildren(indi, 'NOTE').map((note) => noteText(note, records)).filter(Boolean)
  return texts.length ? texts.join('\n\n') : null
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

// Date avec sa précision (ABT 1879, BET 1914 AND 1918…). Une date exacte reste telle quelle.
const PRECISION_PREFIX: Record<string, string> = {
  about: 'ABT', estimated: 'EST', calculated: 'CAL', before: 'BEF', after: 'AFT', interpreted: 'INT',
}

// Une date tronquée au 1er janvier vient d'une année seule : on la réécrit comme une année
function exportedDate(value: Date | null): string | null {
  if (!value) return null
  const iso = value.toISOString().slice(0, 10)
  return isoToGedcomDate(iso.endsWith('-01-01') ? iso.slice(0, 4) : iso)
}

function qualifiedGedcomDate(start: Date | null, end: Date | null, precision: string | null, text?: string | null): string | null {
  // Le texte d'origine (calendrier républicain, julien, période) prime : on le rend tel qu'il a été lu
  if (text && precision) return oneLine(text)
  const from = exportedDate(start)
  const to = exportedDate(end)
  if (!from) return text ? oneLine(text) : null
  if (!precision || precision === 'exact') return from
  if (precision === 'between') return to ? `BET ${from} AND ${to}` : `AFT ${from}`
  if (precision === 'from') return to ? `FROM ${from} TO ${to}` : `FROM ${from}`
  if (precision === 'to') return `TO ${from}`
  const prefix = PRECISION_PREFIX[precision]
  return prefix ? `${prefix} ${from}` : from
}

type ExportedEvent = {
  type: string
  label: string | null
  date: Date | null
  dateEnd: Date | null
  datePrecision: string | null
  dateText: string | null
  place: string | null
  description: string | null
  notes: string | null
  sources: string | null
}

// Balise GEDCOM de chaque type : la première rencontrée dans la table de lecture (BAPM avant CHR)
const reverseTags = (table: Record<string, string>) => {
  const out: Record<string, string> = {}
  for (const [tag, type] of Object.entries(table)) if (!out[type]) out[type] = tag
  return out
}
const PERSON_EVENT_TAGS = reverseTags(PERSON_EVENT_TYPES)
const FAMILY_EVENT_TAGS = reverseTags(FAMILY_EVENT_TYPES)

function pushMultiline(lines: string[], level: number, tag: string, text: string) {
  const [first, ...rest] = text.split(/\r\n|\r|\n/)
  lines.push(`${level} ${tag} ${first}`.trimEnd())
  for (const line of rest) lines.push(`${level + 1} CONT ${line}`.trimEnd())
}

function pushNotesAndSources(lines: string[], level: number, event: Pick<ExportedEvent, 'notes' | 'sources'> | undefined) {
  if (!event) return
  if (event.notes) pushMultiline(lines, level, 'NOTE', event.notes)
  for (const source of (event.sources ?? '').split('\n').map((s) => s.trim()).filter(Boolean)) {
    lines.push(`${level} SOUR ${source}`)
  }
}

function pushLifeEvent(lines: string[], event: ExportedEvent, tags: Record<string, string>) {
  const tag = tags[event.type] ?? 'EVEN'
  const value = event.description ? ` ${oneLine(event.description)}` : ''
  lines.push(`1 ${tag}${value}`)
  if (tag === 'EVEN' || tag === 'FACT') {
    const label = event.label ?? (tags[event.type] ? null : event.type)
    if (label) lines.push(`2 TYPE ${oneLine(label)}`)
  }
  const date = qualifiedGedcomDate(event.date, event.dateEnd, event.datePrecision, event.dateText)
  if (date) lines.push(`2 DATE ${date}`)
  if (event.place) lines.push(`2 PLAC ${oneLine(event.place)}`)
  pushNotesAndSources(lines, 2, event)
}

// ─── Name Parsing ────────────────────────────────────────────────────────────

// Valeur de « 1 NAME ». Prénom inconnu (chaîne vide) : « /Dupont/ », sans espace de tête
export function gedcomNameValue(firstName: string, lastName: string): string {
  const given = firstName ? `${oneLine(firstName)} ` : ''
  return `${given}/${oneLine(lastName).replace(/\//g, '')}/`
}

// « Jean /Dupont/ » : lu par indexOf, l'ancienne expression régulière était quadratique sur les espaces
export function parseGedcomName(value: string): { firstName: string; lastName: string } {
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

// GEDCOM 5.5.1 n'admet que M, F et U (inconnu, autre). « X » n'existe qu'en 7.0 : un sexe « autre » s'écrit U,
// et l'import relit X comme avant.
export function gedcomSexValue(sex: PersonSex | null): 'M' | 'F' | 'U' | null {
  if (sex === 'male') return 'M'
  if (sex === 'female') return 'F'
  if (sex === 'other') return 'U'
  return null
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

    const [persons, unions, links, lifeEvents] = await Promise.all([
      app.prisma.person.findMany({ where: { treeId, deletedAt: null } }),
      app.prisma.union.findMany({ where: { treeId, deletedAt: null } }),
      app.prisma.parentChildLink.findMany({ where: { treeId, deletedAt: null } }),
      app.prisma.lifeEvent.findMany({ where: { treeId, deletedAt: null, status: 'approved' }, orderBy: [{ date: 'asc' }, { displayOrder: 'asc' }] }),
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
    const adoptedInUnion = new Set<string>()
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
      if (link.parentageType === 'adoption') adoptedInUnion.add(`${unionId}|${childId}`)
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

    // Événements de vie : rangés par personne et par union, pour les réécrire sous leur propriétaire
    const eventsByPerson = new Map<string, typeof lifeEvents>()
    const eventsByUnion = new Map<string, typeof lifeEvents>()
    for (const event of lifeEvents) {
      const target = event.personId ? eventsByPerson : event.unionId ? eventsByUnion : null
      const key = event.personId ?? event.unionId
      if (!target || !key) continue
      target.set(key, [...(target.get(key) ?? []), event])
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
      lines.push(`1 NAME ${gedcomNameValue(person.firstName, person.lastName)}`)
      if (person.nickname) lines.push(`2 NICK ${oneLine(person.nickname)}`)

      const sexValue = gedcomSexValue(sexOrNull(person.sex))
      if (sexValue) lines.push(`1 SEX ${sexValue}`)

      const personEvents = eventsByPerson.get(person.id) ?? []
      const birthDetails = personEvents.find((event) => event.type === 'birth')
      const deathDetails = personEvents.find((event) => event.type === 'death')

      const birthDate = qualifiedGedcomDate(person.birthDate, person.birthDateEnd, person.birthDatePrecision)
      if (birthDate || person.birthPlace || birthDetails) {
        lines.push('1 BIRT')
        if (birthDate) lines.push(`2 DATE ${birthDate}`)
        if (person.birthPlace) lines.push(`2 PLAC ${oneLine(person.birthPlace)}`)
        pushNotesAndSources(lines, 2, birthDetails)
      }

      const deathDate = qualifiedGedcomDate(person.deathDate, person.deathDateEnd, person.deathDatePrecision)
      if (deathDate || person.deathPlace || deathDetails) {
        lines.push('1 DEAT')
        if (deathDate) lines.push(`2 DATE ${deathDate}`)
        if (person.deathPlace) lines.push(`2 PLAC ${oneLine(person.deathPlace)}`)
        pushNotesAndSources(lines, 2, deathDetails)
      } else if (person.isDeceased) {
        // Décédé(e) sans rien d'autre : la forme courte de la norme
        lines.push('1 DEAT Y')
      }

      // Le champ « profession » s'écrit seulement s'il n'est pas déjà un des métiers datés
      const professionKnown = personEvents.some(
        (event) => event.type === 'occupation' && event.description?.trim().toLowerCase() === person.profession?.trim().toLowerCase(),
      )
      if (person.profession && !professionKnown) lines.push(`1 OCCU ${oneLine(person.profession)}`)
      for (const event of personEvents) {
        if (event.type !== 'birth' && event.type !== 'death') pushLifeEvent(lines, event, PERSON_EVENT_TAGS)
      }

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
        if (adoptedInUnion.has(`${uid}|${person.id}`)) lines.push('2 PEDI adopted')
      }
    }

    // ── Write FAM records ──
    for (const union of unions) {
      const xref = sanitizeXref(union.id)
      lines.push(`0 @F${xref}@ FAM`)

      const p1 = union.partner1PersonId ? personById.get(union.partner1PersonId) : null
      const p2 = union.partner2PersonId ? personById.get(union.partner2PersonId) : null

      const p1IsFemale = sexOrNull(p1?.sex) === 'female'
      const p1IsMale = sexOrNull(p1?.sex) === 'male'
      const p2IsMale = sexOrNull(p2?.sex) === 'male'

      // Swap to HUSB=male if we know p1 is female and p2 is male (or unknown)
      const shouldSwap = p1IsFemale && !p2IsMale === false ? false : p1IsFemale && (p2IsMale || !p1IsMale)
      const husbId = shouldSwap ? union.partner2PersonId : union.partner1PersonId
      const wifeId = shouldSwap ? union.partner1PersonId : union.partner2PersonId

      if (husbId) lines.push(`1 HUSB @I${sanitizeXref(husbId)}@`)
      if (wifeId && wifeId !== husbId) lines.push(`1 WIFE @I${sanitizeXref(wifeId)}@`)

      for (const childId of childrenByUnion.get(union.id) ?? []) {
        lines.push(`1 CHIL @I${sanitizeXref(childId)}@`)
      }

      const unionEvents = eventsByUnion.get(union.id) ?? []
      const marriageDetails = unionEvents.find((event) => event.type === 'marriage')
      const marriageDate = qualifiedGedcomDate(union.startDate, null, union.startDatePrecision)
      if (marriageDate || union.startPlace || marriageDetails) {
        lines.push('1 MARR')
        if (marriageDate) lines.push(`2 DATE ${marriageDate}`)
        if (union.startPlace) lines.push(`2 PLAC ${oneLine(union.startPlace)}`)
        pushNotesAndSources(lines, 2, marriageDetails)
      }
      for (const event of unionEvents) {
        if (event.type !== 'marriage') pushLifeEvent(lines, event, FAMILY_EVENT_TAGS)
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
    const records = indexGedcomRecords(roots)
    const objeByXref = records.obje
    const photoRefs: Array<{ personId: string; file: string }> = []
    // Les autres fichiers cités (actes, registres, photos de famille) : des souvenirs pour les personnes
    // créées par cet import. Une personne déjà dans l'arbre n'en reçoit pas, un second import ne double rien.
    const mediaRefs: Array<{ personId: string; file: string; caption: string | null; source: string | null }> = []

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
    // Parents de chaque personne, pour refuser un lien qui ferait de quelqu'un son propre ancêtre
    // (les validateurs de l'API relisent tout l'arbre à chaque lien : trop lent pour un import)
    const parentsOf = new Map<string, string[]>()
    for (const link of existingLinks) parentsOf.set(link.childPersonId, [...(parentsOf.get(link.childPersonId) ?? []), link.parentPersonId])
    let ancestryBudget = MAX_ANCESTRY_STEPS
    const isAncestorOf = (candidate: string, personId: string): boolean => {
      const seen = new Set<string>()
      const stack = [personId]
      while (stack.length) {
        const current = stack.pop()!
        if (current === candidate) return true
        if (seen.has(current) || --ancestryBudget < 0) continue
        seen.add(current)
        stack.push(...(parentsOf.get(current) ?? []))
      }
      return false
    }

    let personsCreated = 0
    let personsReused = 0
    let unionsCreated = 0
    let linksCreated = 0
    let eventsCreated = 0
    let relationsSkipped = 0
    // Adoptions déclarées sous l'enfant (« 2 PEDI adopted ») : enfant → familles où il est adopté
    const adoptedByChild = new Map(indiNodes.map((indi) => [indi.xref!, adoptedFamilies(indi)]))

    importInProgress = true
    try {
    await app.prisma.$transaction(async (tx) => {
      for (const indi of indiNodes) {
        const nameNode = findChild(indi, 'NAME')
        const { firstName, lastName } = nameNode
          ? parseGedcomName(nameNode.value)
          : { firstName: '', lastName: '' }

        const sexNode = findChild(indi, 'SEX')
        const sex = sexOrNull(sexNode?.value)

        const birtNode = findChild(indi, 'BIRT')
        const birthDateIso = gedcomDateToIso(findChild(birtNode, 'DATE')?.value ?? '')
        const birthPlace = clip(cleanGedcomPlace(findChild(birtNode, 'PLAC')?.value), 200)

        const deatNode = findChild(indi, 'DEAT')
        const deathDateIso = gedcomDateToIso(findChild(deatNode, 'DATE')?.value ?? '')

        const profession = clip(findChild(indi, 'OCCU')?.value ?? null, 200)

        // Prénom absent du fichier : chaîne vide, comme un prénom inconnu dans l'arbre
        const personFirstName = (firstName || '').slice(0, 120)
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

        const notes = clip(personNotes(indi, records), 2000)
        const { events, ...extras } = personExtras(indi, records)
        const person = await tx.person.create({
          data: {
            treeId,
            firstName: personFirstName,
            lastName: personLastName,
            sex,
            birthDate,
            deathDate,
            // « 1 DEAT Y » ou un décès sans date : décédé(e), date inconnue
            isDeceased: Boolean(deatNode) && !deathDate,
            birthPlace,
            profession,
            notes,
            ...extras,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          },
        })
        if (events.length) {
          await tx.lifeEvent.createMany({ data: events.map((event, index) => ({ ...event, treeId, personId: person.id, displayOrder: index + 1 })) })
          eventsCreated += events.length
        }

        xrefToPersonId.set(indi.xref!, person.id)
        personsCreated++
        if (photoPath) photoRefs.push({ personId: person.id, file: photoPath })
        const personMedia = mediaRefs.length < MAX_IMPORTED_MEDIA_REFS ? mediaRefsForPerson(indi, records, photoPath) : []
        for (const ref of personMedia) {
          if (mediaRefs.length >= MAX_IMPORTED_MEDIA_REFS) break
          mediaRefs.push({ personId: person.id, ...ref })
        }
      }

      for (const fam of famNodes) {
        const husbXref = findChild(fam, 'HUSB')?.value?.replace(/@/g, '').trim()
        const wifeXref = findChild(fam, 'WIFE')?.value?.replace(/@/g, '').trim()

        const partner1Id = husbXref ? xrefToPersonId.get(husbXref) : undefined
        let partner2Id = wifeXref ? xrefToPersonId.get(wifeXref) : undefined
        // Une même personne des deux côtés d'une union : un seul partenaire
        if (partner2Id && partner2Id === partner1Id) {
          partner2Id = undefined
          relationsSkipped++
        }

        if (!partner1Id && !partner2Id) continue

        const marrNode = findChild(fam, 'MARR')
        const marriageDateIso = gedcomDateToIso(findChild(marrNode, 'DATE')?.value ?? '')

        const firstPartner = partner1Id ?? partner2Id!
        const secondPartner = partner1Id ? (partner2Id ?? null) : null
        let unionId = unionByPair.get(pairKey(firstPartner, secondPartner))
        if (!unionId) {
          const { events: familyEvents, ...unionExtras } = familyExtras(fam, records)
          const union = await tx.union.create({
            data: {
              treeId,
              partner1PersonId: firstPartner,
              partner2PersonId: secondPartner,
              startDate: isoDateToDbDate(marriageDateIso),
              ...unionExtras,
            },
          })
          unionId = union.id
          unionByPair.set(pairKey(firstPartner, secondPartner), unionId)
          unionsCreated++
          if (familyEvents.length) {
            await tx.lifeEvent.createMany({ data: familyEvents.map((event, index) => ({ ...event, treeId, unionId: union.id, displayOrder: index + 1 })) })
            eventsCreated += familyEvents.length
          }
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
            if (parentId === childId || isAncestorOf(childId, parentId)) {
              relationsSkipped++
              continue
            }
            await tx.parentChildLink.create({
              data: {
                treeId,
                parentPersonId: parentId,
                childPersonId: childId,
                viaUnionId: unionId,
                ...(adoptedByChild.get(chilXref)?.has(fam.xref!) ? { parentageType: 'adoption' } : {}),
                displayOrder: await nextSiblingOrder(tx, treeId, parentId),
              },
            })
            linkKeys.add(linkKey)
            parentsOf.set(childId, [...(parentsOf.get(childId) ?? []), parentId])
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
          payloadJson: { personsCreated, personsReused, unionsCreated, linksCreated, eventsCreated, relationsSkipped, photoRefs: photoRefs.length, mediaRefs: mediaRefs.length },
        },
      })
    }, { timeout: 60000 })
    } finally {
      importInProgress = false
    }

    // photoRefs : chemin de la photo que le logiciel d'origine associait à chaque personne ; mediaRefs : les
    // autres fichiers cités, avec leur titre et leur source (rien n'est gardé en base)
    return reply.send({ personsCreated, personsReused, unionsCreated, linksCreated, eventsCreated, relationsSkipped, photoRefs, mediaRefs })
  })
}
