// Frise de vie d'une personne (onglet Vie de la fiche).
//
// Trois sources, rangées par date : la naissance, les unions et le décès, qui servent de grands repères ;
// les événements importés ou saisis (baptême, métiers, service militaire…) ; et la famille proche que
// l'arbre connaît déjà (naissance des enfants et des frères et sœurs, décès des parents, du conjoint, d'un
// enfant), limitée aux années où la personne a vécu. Une fiche sans aucun événement a donc déjà une frise.

import { t, dateLocale } from '../i18n/index.js'
import { formatPlace } from './place.js'

const EVENT_LABELS = {
  baptism: t('Baptême'),
  burial: t('Inhumation'),
  cremation: t('Crémation'),
  residence: t('Résidence'),
  occupation: t('Métier'),
  education: t('Études'),
  graduation: t('Diplôme'),
  degree: t('Diplôme'),
  religion: t('Religion'),
  confirmation: t('Confirmation'),
  first_communion: t('Première communion'),
  bar_mitzvah: t('Bar-mitzvah'),
  bat_mitzvah: t('Bat-mitzvah'),
  ordination: t('Ordination'),
  adoption: t('Adoption'),
  emigration: t('Émigration'),
  immigration: t('Immigration'),
  naturalization: t('Naturalisation'),
  census: t('Recensement'),
  title: t('Titre'),
  property: t('Biens'),
  retirement: t('Retraite'),
  will: t('Testament'),
  probate: t('Succession'),
  military: t('Service militaire'),
  medical: t('Santé'),
  divorce: t('Divorce'),
  divorce_filed: t('Demande de divorce'),
  annulment: t('Annulation du mariage'),
  engagement: t('Fiançailles'),
  marriage_banns: t('Bans du mariage'),
  marriage_contract: t('Contrat de mariage'),
  marriage_license: t('Autorisation de mariage'),
  marriage_settlement: t('Accord de mariage'),
}

// Types dont la description dit déjà ce que c'est (« Instituteur », « École normale »)
export const DESCRIBED_TYPES = ['occupation', 'education', 'graduation', 'degree', 'title']

// Titre d'un événement : son libellé s'il en a un, sinon le nom du type, complété de la description
export function eventTitle(event) {
  if (DESCRIBED_TYPES.includes(event.type) && event.description) return event.description
  const base = event.label || (event.type === 'custom' ? '' : EVENT_LABELS[event.type]) || t('Événement')
  return event.description ? `${base}, ${event.description}` : base
}

const yearOf = (value) => {
  const match = String(value ?? '').match(/^(\d{4})/)
  return match ? Number(match[1]) : null
}

const fullName = (p) => [p?.firstName, p?.lastName].filter(Boolean).join(' ')

// « 12 mars » pour une date complète, rien pour une année seule (stockée au 1er janvier)
function dayMonth(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match || (match[2] === '01' && match[3] === '01')) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

// La date telle qu'on la dit : « vers 1879 », « entre 1914 et 1918 », « jusqu'en 1981 »
export function describeDate(date, end, precision) {
  const year = yearOf(date)
  const endYear = yearOf(end)
  if (!year) return ''
  switch (precision) {
    case 'about':
    case 'estimated':
    case 'calculated':
      return t('vers {year}', { year })
    case 'before': return t('avant {year}', { year })
    case 'after': return t('après {year}', { year })
    case 'between': return endYear ? t('entre {year} et {end}', { year, end: endYear }) : t('après {year}', { year })
    case 'from': return endYear ? t('jusqu’en {end}', { end: endYear }) : t('depuis {year}', { year })
    case 'to': return t('jusqu’en {year}', { year })
    default: return dayMonth(date)
  }
}

const ageAt = (birthYear, year) => (birthYear && year && year > birthYear ? t('{age} ans', { age: year - birthYear }) : '')
const joinMeta = (...parts) => parts.filter(Boolean).join(' · ')

const parentWord = (p) => {
  if (p.sex === 'male' || p.sex === 'M') return t('Décès de son père {name}', { name: p.firstName })
  if (p.sex === 'female' || p.sex === 'F') return t('Décès de sa mère {name}', { name: p.firstName })
  return t('Décès de {name}, son parent', { name: p.firstName })
}

const siblingWord = (p) => {
  if (p.sex === 'male' || p.sex === 'M') return t('Naissance de son frère {name}', { name: p.firstName })
  if (p.sex === 'female' || p.sex === 'F') return t('Naissance de sa sœur {name}', { name: p.firstName })
  return t('Naissance de {name}, sa fratrie', { name: p.firstName })
}

/**
 * @param person   personne de la fiche (birthDate, deathDate, birthPlace, birthYear, deathYear)
 * @param family   { parents, children, siblings, unions: [{ id, partner, startYear, endYear, unionType }] }
 * @param life     réponse de GET /trees/:id/persons/:personId/life, ou null tant qu'elle n'est pas là
 * @returns entrées triées { key, year, kind: 'mile' | 'minor' | 'fam', title, meta, note, sources, mediaIds,
 *          event (moment modifiable), milestone ({ type, unionId } d'une naissance, d'un mariage, d'un décès) }
 */
// Naissance, mariage, décès : leur ligne (sources, note, souvenirs) quand elle existe, et de quoi la créer sinon
const milestoneFields = (row, milestone) => ({ mediaIds: row?.mediaIds || [], event: row || null, milestone })

export function buildLifeTimeline(person, family = {}, life = null) {
  const details = life?.person || {}
  const lifeUnions = new Map((life?.unions || []).map((u) => [String(u.id), u]))
  const events = life?.events || []
  const birthYear = yearOf(person.birthDate) ?? person.birthYear ?? null
  const deathYear = yearOf(person.deathDate) ?? person.deathYear ?? null
  const lastYear = deathYear ?? new Date().getFullYear()
  const within = (year) => year && (!birthYear || year >= birthYear) && year <= lastYear
  const sourcesOf = (type, unionId = null) => events.find((e) => e.type === type && (unionId ? String(e.unionId) === String(unionId) : !e.unionId))
  const out = []

  if (birthYear) {
    const place = formatPlace(person.birthPlace || '')
    const extra = sourcesOf('birth')
    out.push({
      key: 'birth', year: birthYear, order: 0, kind: 'mile',
      title: place ? t('Naissance à {place}', { place: place.split(',')[0] }) : t('Naissance'),
      meta: describeDate(person.birthDate, details.birthDateEnd, details.birthDatePrecision),
      note: extra?.notes || '', sources: extra?.sources || '',
      ...milestoneFields(extra, { type: 'birth' }),
    })
  }

  for (const union of family.unions || []) {
    const detail = lifeUnions.get(String(union.id)) || {}
    const year = yearOf(detail.startDate) ?? union.startYear
    const partnerName = union.partner ? fullName(union.partner) : t('Conjoint inconnu')
    const place = formatPlace(detail.startPlace || '')
    const extra = sourcesOf('marriage', union.id)
    out.push({
      key: `union-${union.id}`, year, order: 2, kind: 'mile',
      title: union.unionType === 'union' ? t('Union avec {name}', { name: partnerName }) : t('Épouse {name}', { name: partnerName }),
      meta: joinMeta(place, detail.startDatePrecision ? describeDate(detail.startDate, null, detail.startDatePrecision) : '', ageAt(birthYear, year)),
      note: extra?.notes || '', sources: extra?.sources || '',
      ...milestoneFields(extra, { type: 'marriage', unionId: union.id }),
    })
    const hasEndEvent = events.some((e) => String(e.unionId) === String(union.id) && ['divorce', 'annulment'].includes(e.type))
    if (union.endYear && !hasEndEvent) {
      out.push({ key: `union-end-${union.id}`, year: union.endYear, order: 3, kind: 'minor', title: t('Fin de l’union avec {name}', { name: union.partner?.firstName || partnerName }), meta: ageAt(birthYear, union.endYear) })
    }
    if (union.partner && within(yearOf(union.partner.deathDate) ?? union.partner.deathYear)) {
      const year2 = yearOf(union.partner.deathDate) ?? union.partner.deathYear
      out.push({ key: `partner-death-${union.id}`, year: year2, order: 4, kind: 'fam', title: t('Décès de {name}', { name: union.partner.firstName }) })
    }
  }

  for (const event of events) {
    if (['birth', 'death', 'marriage'].includes(event.type)) continue
    const year = yearOf(event.date)
    let title = eventTitle(event)
    if (event.unionId) {
      const union = (family.unions || []).find((u) => String(u.id) === String(event.unionId))
      if (union?.partner && ['divorce', 'annulment', 'engagement', 'marriage_contract'].includes(event.type)) title = `${title} (${union.partner.firstName})`
    }
    out.push({
      key: `event-${event.id}`, year, order: 1, kind: 'minor', title,
      meta: joinMeta(formatPlace(event.place || ''), describeDate(event.date, event.dateEnd, event.datePrecision), ageAt(birthYear, year)),
      note: event.notes || '', sources: event.sources || '',
      mediaIds: event.mediaIds || [],
      // Seuls les moments propres à la personne se modifient depuis l'onglet (pas ceux d'une union)
      event: event.unionId ? null : event,
    })
  }

  for (const child of family.children || []) {
    const year = yearOf(child.birthDate) ?? child.birthYear
    if (within(year)) out.push({ key: `child-${child.id}`, year, order: 5, kind: 'fam', title: t('Naissance de {name}', { name: child.firstName }) })
    const death = yearOf(child.deathDate) ?? child.deathYear
    if (within(death) && death !== deathYear) out.push({ key: `child-death-${child.id}`, year: death, order: 6, kind: 'fam', title: t('Décès de {name}', { name: child.firstName }) })
  }
  for (const sibling of family.siblings || []) {
    const year = yearOf(sibling.birthDate) ?? sibling.birthYear
    if (within(year) && year !== birthYear) out.push({ key: `sibling-${sibling.id}`, year, order: 5, kind: 'fam', title: siblingWord(sibling) })
  }
  for (const parent of family.parents || []) {
    const year = yearOf(parent.deathDate) ?? parent.deathYear
    if (within(year)) out.push({ key: `parent-death-${parent.id}`, year, order: 6, kind: 'fam', title: parentWord(parent) })
  }

  if (deathYear || person.isAlive === false) {
    const place = formatPlace(details.deathPlace || '')
    const extra = sourcesOf('death')
    out.push({
      key: 'death', year: deathYear, order: 9, kind: 'mile',
      title: place ? t('Décès à {place}', { place: place.split(',')[0] }) : t('Décès'),
      meta: deathYear ? joinMeta(describeDate(person.deathDate, details.deathDateEnd, details.deathDatePrecision), ageAt(birthYear, deathYear)) : t('date inconnue'),
      note: extra?.notes || '', sources: extra?.sources || '',
      ...milestoneFields(extra, { type: 'death' }),
    })
  }

  // Les entrées sans date restent en bas, dans l'ordre où elles sont arrivées
  return out
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.order - b.order || a.index - b.index)
    .map(({ order, index, ...entry }) => entry) // eslint-disable-line no-unused-vars
}
