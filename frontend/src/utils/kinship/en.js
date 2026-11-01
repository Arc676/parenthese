import { kinshipFacts } from './facts.js'

// Mot genré quand le sexe de la personne nommée est connu, forme neutre ou double sinon
const g = (sex, male, female, neutral) => (sex === 'male' ? male : sex === 'female' ? female : neutral)

function ordinal(n) {
  switch (n) {
    case 1:
      return "First"
    case 2:
      return "Second"
    case 3:
      return "Third"
    default:
      return `{n}th`
  }
}

function times(n) {
  switch (n) {
    case 1:
      return "once"
    case 2:
      return "twice"
    case 3:
      return "thrice"
    default:
      return `${n} times`
  }
}

export default function nameEn(path) {
  const { ups, downs, hasSpouse, sex } = kinshipFacts(path)

  // « Partner » reste neutre au lieu de supposer un mariage
  if (hasSpouse && ups === 0 && downs === 0) return 'Partner'

  if (hasSpouse) {
    // L'anglais distingue l'ordre : le parent du conjoint (in-law) n'est pas le conjoint du parent (step)
    const viaSpouseFirst = path.steps[0].move === 'spouse'
    if (ups === 1 && downs === 0) return viaSpouseFirst ? g(sex, 'Father-in-law', 'Mother-in-law', 'Parent-in-law') : g(sex, 'Stepfather', 'Stepmother', 'Stepparent')
    if (ups === 0 && downs === 1) return viaSpouseFirst ? g(sex, 'Stepson', 'Stepdaughter', 'Stepchild') : g(sex, 'Son-in-law', 'Daughter-in-law', 'Child-in-law')
    if (ups === 1 && downs === 1) return g(sex, 'Brother-in-law', 'Sister-in-law', 'Brother/sister-in-law')
  }

  let label
  if (downs === 0 && ups > 0) {
    if (ups === 1) label = g(sex, 'Father', 'Mother', 'Parent')
    else if (ups === 2) label = g(sex, 'Grandfather', 'Grandmother', 'Grandparent')
    else if (ups === 3) label = g(sex, 'Great-grandfather', 'Great-grandmother', 'Great-grandparent')
    else label = `Ancestor, ${ups} generations up`
  } else if (ups === 0 && downs > 0) {
    if (downs === 1) label = g(sex, 'Son', 'Daughter', 'Child')
    else if (downs === 2) label = g(sex, 'Grandson', 'Granddaughter', 'Grandchild')
    else if (downs === 3) label = g(sex, 'Great-grandson', 'Great-granddaughter', 'Great-grandchild')
    else label = `Descendant, ${downs} generations down`
  } else if (ups === 1 && downs === 1) label = g(sex, 'Brother', 'Sister', 'Sibling')
  else if (ups === 2 && downs === 1) label = g(sex, 'Uncle', 'Aunt', 'Uncle/Aunt')
  else if (ups === 3 && downs === 1) label = g(sex, 'Great-uncle', 'Great-aunt', 'Great-uncle/aunt')
  else if (ups === 1 && downs === 2) label = g(sex, 'Nephew', 'Niece', 'Nibling')
  else if (ups === 1 && downs === 3) label = g(sex, 'Grandnephew', 'Grandniece', 'Grandnibling')
  else if (ups >= 2 && downs >= 2) {
    const degree = Math.min(ups, downs) - 1
    const removed = Math.abs(ups - downs)
    if (removed === 0) label = `${ordinal(degree)} cousin`
    else label = `${ordinal(degree)} cousin, ${times(removed)} removed`
  } else label = `${ups + downs} steps apart`

  return hasSpouse ? `${label} by marriage` : label
}
