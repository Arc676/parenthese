// Une date corrigée à la main perd la précision lue dans le GEDCOM (« vers 1879 », « entre 1914 et 1918 ») :
// elle décrivait l'ancienne date, pas celle qu'on vient de saisir. Une date renvoyée telle quelle la garde.

const sameDay = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a ? a.toISOString().slice(0, 10) : null) === (b ? b.toISOString().slice(0, 10) : null)

type PersonDates = { birthDate: Date | null; deathDate: Date | null }

export function personPrecisionResets(current: PersonDates | null, next: Partial<PersonDates>) {
  const out: { birthDatePrecision?: null; birthDateEnd?: null; deathDatePrecision?: null; deathDateEnd?: null } = {}
  if (!current) return out
  if (next.birthDate !== undefined && !sameDay(current.birthDate, next.birthDate)) {
    out.birthDatePrecision = null
    out.birthDateEnd = null
  }
  if (next.deathDate !== undefined && !sameDay(current.deathDate, next.deathDate)) {
    out.deathDatePrecision = null
    out.deathDateEnd = null
  }
  return out
}

export function unionPrecisionResets(current: { startDate: Date | null } | null, next: { startDate?: Date | null }) {
  if (!current || next.startDate === undefined || sameDay(current.startDate, next.startDate)) return {}
  return { startDatePrecision: null }
}
