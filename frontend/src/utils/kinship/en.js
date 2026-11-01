import { kinshipFacts } from './facts.js'

// Mot genré quand le sexe de la personne nommée est connu, forme neutre ou double sinon
const g = (sex, male, female, neutral) => (sex === 'male' ? male : sex === 'female' ? female : neutral)

// 1st, 2nd, 3rd, 4th… 11th, 12th, 13th, 21st
function ordinal(n) {
  const words = ['First', 'Second', 'Third']
  if (n <= 3) return words[n - 1]
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')
  return `${n}${suffix}`
}

function times(n) {
  return ['once', 'twice', 'thrice'][n - 1] || `${n} times`
}

// Règle des G : autant de G que de générations d'écart (grandfather, great-grandfather, great-great-grandfather)
function grule(n) {
  return n === 2 ? 'Grand' : `Great-${'great-'.repeat(n - 3)}grand`
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
    label = ups === 1 ? g(sex, 'Father', 'Mother', 'Parent') : `${grule(ups)}${g(sex, 'father', 'mother', 'parent')}`
  } else if (ups === 0 && downs > 0) {
    label = downs === 1 ? g(sex, 'Son', 'Daughter', 'Child') : `${grule(downs)}${g(sex, 'son', 'daughter', 'child')}`
  } else if (downs === 1) {
    if (ups === 1) label = g(sex, 'Brother', 'Sister', 'Sibling')
    else if (ups === 2) label = g(sex, 'Uncle', 'Aunt', 'Uncle/Aunt')
    // Great-uncle plutôt que granduncle : c'est la forme courante
    else label = `Great-${'great-'.repeat(ups - 3)}${g(sex, 'uncle', 'aunt', 'uncle/aunt')}`
  } else if (ups === 1) {
    label = downs === 2 ? g(sex, 'Nephew', 'Niece', 'Nibling') : `${grule(downs - 1)}${g(sex, 'nephew', 'niece', 'nibling')}`
  } else {
    const degree = Math.min(ups, downs) - 1
    const removed = Math.abs(ups - downs)
    label = removed === 0 ? `${ordinal(degree)} cousin` : `${ordinal(degree)} cousin ${times(removed)} removed`
  }

  return hasSpouse ? `${label} by marriage` : label
}
