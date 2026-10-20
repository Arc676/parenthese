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

// Ce que le français et l'anglais lisent d'un chemin : générations montées et descendues
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
