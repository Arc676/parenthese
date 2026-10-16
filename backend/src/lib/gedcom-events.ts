// Événements de vie lus dans un GEDCOM. Naissance, décès et mariage gardent leur date et leur lieu sur la
// personne ou l'union : on n'en tire ici que la précision, le lieu de décès, les sources et les notes.
// Les autres événements (baptême, résidence, métier, inhumation, divorce…) deviennent des LifeEvent.

import { parseGedcomDate } from './gedcom-dates.js'
import { joinedText, noteText, sourceLabel } from './gedcom-photos.js'
import type { GedcomPhotoNode, GedcomRecords } from './gedcom-photos.js'

type Node = GedcomPhotoNode

export type ImportedEvent = {
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

// Balises de la norme et variantes courantes (Gramps, Heredis, Geneatique, RootsMagic)
export const PERSON_EVENT_TYPES: Record<string, string> = {
  BAPM: 'baptism', CHR: 'baptism', BURI: 'burial', CREM: 'cremation', RESI: 'residence', OCCU: 'occupation',
  EDUC: 'education', GRAD: 'graduation', RELI: 'religion', CONF: 'confirmation', FCOM: 'first_communion',
  BARM: 'bar_mitzvah', BASM: 'bat_mitzvah', ORDN: 'ordination', ADOP: 'adoption', EMIG: 'emigration',
  IMMI: 'immigration', NATU: 'naturalization', CENS: 'census', TITL: 'title', PROP: 'property',
  RETI: 'retirement', WILL: 'will', PROB: 'probate', _MILT: 'military', _MDCL: 'medical', _DEG: 'degree',
  EVEN: 'custom', FACT: 'custom',
}

export const FAMILY_EVENT_TYPES: Record<string, string> = {
  DIV: 'divorce', DIVF: 'divorce_filed', ANUL: 'annulment', ENGA: 'engagement', MARB: 'marriage_banns',
  MARC: 'marriage_contract', MARL: 'marriage_license', MARS: 'marriage_settlement', EVEN: 'custom', FACT: 'custom',
}

const MAX_EVENTS_PER_OWNER = 200
const clip = (value: string | null | undefined, max: number) => {
  const text = (value ?? '').replace(/\s+\n/g, '\n').trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

const child = (node: Node | undefined, tag: string) => node?.children.find((c) => c.tag === tag)

// Même règle que le lieu de naissance : noms seulement, sans case vide ni code INSEE ou postal
export function cleanPlace(value: string | null | undefined): string | null {
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

export function isoToDbDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  if (/^\d{4}$/.test(iso)) return new Date(`${iso}-01-01T00:00:00.000Z`)
  if (/^\d{4}-\d{2}$/.test(iso)) return new Date(`${iso}-01T00:00:00.000Z`)
  return new Date(`${iso}T00:00:00.000Z`)
}

function eventNotes(node: Node, records: GedcomRecords): string | null {
  const texts = node.children.filter((c) => c.tag === 'NOTE').map((n) => noteText(n, records)).filter(Boolean)
  return clip(texts.join('\n\n'), 4000)
}

function eventSources(node: Node, records: GedcomRecords): string | null {
  const labels = node.children.filter((c) => c.tag === 'SOUR').map((s) => sourceLabel(s, records)).filter(Boolean) as string[]
  return clip([...new Set(labels)].join('\n'), 4000)
}

// Ce qu'on lit d'un événement : date et précision, lieu (ou adresse), description, notes, sources
export function readEvent(node: Node, type: string, records: GedcomRecords): ImportedEvent {
  const dateText = child(node, 'DATE')?.value ?? null
  const parsed = parseGedcomDate(dateText)
  const addr = child(node, 'ADDR')
  const address = [joinedText(addr).replace(/\n+/g, ', '), ...['CITY', 'STAE', 'CTRY'].map((tag) => child(addr, tag)?.value ?? '')]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
  const place = cleanPlace(child(node, 'PLAC')?.value) ?? clip(address, 300)
  const typeLabel = joinedText(child(node, 'TYPE'))
  const value = node.value && node.value.toUpperCase() !== 'Y' ? node.value : ''
  return {
    type,
    label: type === 'custom' ? clip(typeLabel || value, 120) : null,
    date: isoToDbDate(parsed?.iso),
    dateEnd: isoToDbDate(parsed?.endIso),
    datePrecision: parsed && parsed.precision !== 'exact' ? parsed.precision : null,
    dateText: parsed && parsed.precision === 'exact' ? null : clip(dateText, 120),
    place: clip(place, 300),
    description: clip(type === 'custom' && !typeLabel ? '' : value, 1000),
    notes: eventNotes(node, records),
    sources: eventSources(node, records),
  }
}

export type PersonExtras = {
  birthDatePrecision: string | null
  birthDateEnd: Date | null
  deathDatePrecision: string | null
  deathDateEnd: Date | null
  deathPlace: string | null
  nickname: string | null
  events: ImportedEvent[]
}

const hasDetails = (e: ImportedEvent) => Boolean(e.notes || e.sources)

export function personExtras(indi: Node, records: GedcomRecords): PersonExtras {
  const events: ImportedEvent[] = []
  const birth = child(indi, 'BIRT')
  const death = child(indi, 'DEAT')
  const birthDate = parseGedcomDate(child(birth, 'DATE')?.value)
  const deathDate = parseGedcomDate(child(death, 'DATE')?.value)

  // Naissance et décès : leurs sources et notes, sans recopier la date ni le lieu
  for (const [node, type] of [[birth, 'birth'], [death, 'death']] as const) {
    if (!node) continue
    const event = readEvent(node, type, records)
    if (hasDetails(event)) events.push({ ...event, date: null, dateEnd: null, datePrecision: null, dateText: null, place: null, description: null })
  }

  // La première profession reste aussi sur la fiche (champ « profession ») et figure quand même ici
  for (const c of indi.children) {
    const type = PERSON_EVENT_TYPES[c.tag]
    if (!type || events.length >= MAX_EVENTS_PER_OWNER) continue
    const event = readEvent(c, type, records)
    if (!event.date && !event.place && !event.description && !event.label && !hasDetails(event)) continue
    events.push(event)
  }

  const nameNode = child(indi, 'NAME')
  return {
    birthDatePrecision: birthDate && birthDate.precision !== 'exact' ? birthDate.precision : null,
    birthDateEnd: isoToDbDate(birthDate?.endIso),
    deathDatePrecision: deathDate && deathDate.precision !== 'exact' ? deathDate.precision : null,
    deathDateEnd: isoToDbDate(deathDate?.endIso),
    deathPlace: clip(cleanPlace(child(death, 'PLAC')?.value), 200),
    nickname: clip(child(nameNode, 'NICK')?.value ?? child(indi, 'NICK')?.value, 120),
    events,
  }
}

export type UnionExtras = {
  startPlace: string | null
  startDatePrecision: string | null
  events: ImportedEvent[]
}

export function familyExtras(fam: Node, records: GedcomRecords): UnionExtras {
  const marriage = child(fam, 'MARR')
  const date = parseGedcomDate(child(marriage, 'DATE')?.value)
  const events: ImportedEvent[] = []
  if (marriage) {
    const event = readEvent(marriage, 'marriage', records)
    if (hasDetails(event)) events.push({ ...event, date: null, dateEnd: null, datePrecision: null, dateText: null, place: null, description: null })
  }
  for (const c of fam.children) {
    const type = FAMILY_EVENT_TYPES[c.tag]
    if (!type || events.length >= MAX_EVENTS_PER_OWNER) continue
    const event = readEvent(c, type, records)
    // « 1 DIV Y » sans rien d'autre dit quand même qu'il y a eu divorce
    if (!event.date && !event.place && !event.description && !event.label && !hasDetails(event) && c.value.toUpperCase() !== 'Y') continue
    events.push(event)
  }
  return {
    startPlace: clip(cleanPlace(child(marriage, 'PLAC')?.value), 300),
    startDatePrecision: date && date.precision !== 'exact' ? date.precision : null,
    events,
  }
}

// Adoption déclarée sous l'enfant : « 1 FAMC @F1@ » / « 2 PEDI adopted »
export function adoptedFamilies(indi: Node): Set<string> {
  const out = new Set<string>()
  for (const famc of indi.children.filter((c) => c.tag === 'FAMC')) {
    const pedi = (child(famc, 'PEDI')?.value || '').toLowerCase()
    const pointer = famc.value.match(/^@([^@]+)@$/)?.[1]
    if (pointer && pedi === 'adopted') out.add(pointer)
  }
  return out
}
