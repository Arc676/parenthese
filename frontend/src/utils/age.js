import { isYearOnly } from './dateInput.js'

// Âge en années révolues (#198) : l'anniversaire compte une fois passé, pas dès le 1er janvier.
// Une année seule (rangée au 1er janvier) n'a pas de jour : on garde la différence des années.
const partsOf = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (Number.isFinite(value)) return { year: Number(value), md: null }
  const text = String(value).slice(0, 10)
  const m = text.match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/)
  if (!m) return null
  return { year: Number(m[1]), md: m[2] && !isYearOnly(text) ? `${m[2]}-${m[3]}` : null }
}

const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// end absent = aujourd'hui ; null si la naissance (ou la fin donnée) manque
export function ageInYears(birth, end = today()) {
  const from = partsOf(birth)
  const to = partsOf(end)
  if (!from || !to) return null
  const age = to.year - from.year
  return from.md && to.md && to.md < from.md ? age - 1 : age
}
