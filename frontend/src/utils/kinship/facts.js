// Sexe d'une personne tel que l'appli le lit : 'male', 'female', 'other' (autre) ou null (non précisé).
// L'import GEDCOM écrit 'male'/'female'/'other' ; d'anciennes données ont pu garder 'M'/'F'.
// Pour nommer un lien, 'other' prend les formes neutres ou doubles, comme null.
export function normalizeSex(value) {
  const key = String(value ?? '').trim().toLowerCase()
  if (key === 'male' || key === 'm') return 'male'
  if (key === 'female' || key === 'f') return 'female'
  if (key === 'other' || key === 'x') return 'other'
  return null
}

// Ce que le français, l'anglais et l'allemand lisent d'un chemin : générations montées et descendues
// (un frère ou une sœur compte une montée et une descente), passage par un conjoint, et sexe
// de la personne nommée, au bout du chemin.
export function kinshipFacts(path) {
  let ups = 0, downs = 0, hasSpouse = false
  for (const { move } of path.steps) {
    if (move === 'up') ups++
    else if (move === 'down') downs++
    else if (move === 'sibling') { ups++; downs++ }
    else if (move === 'spouse') hasSpouse = true
  }
  const target = path.steps[path.steps.length - 1]?.person
  return { ups, downs, hasSpouse, sex: normalizeSex(target?.sex) }
}

// Suite des pas d'un chemin, pour reconnaître les liens que le compte des générations confond (#218)
const movesOf = (path) => path.steps.map((step) => step.move).join(',')
// Demi-frère ou demi-sœur : un seul parent en commun. Deux enfants du même couple passent par 'sibling'
// (le chemin le plus court) ; deux enfants d'un même parent avec deux conjoints passent par ce parent.
export const isHalfSibling = (path) => movesOf(path) === 'up,down'
// Quasi-frère ou quasi-sœur : l'enfant du conjoint d'un parent
export const isStepSibling = (path) => movesOf(path) === 'up,spouse,down'
