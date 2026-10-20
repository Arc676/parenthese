import { kinshipFacts } from './facts.js'

// Mot genré quand le sexe de la personne nommée est connu, forme neutre ou double sinon
const g = (sex, male, female, neutral) => (sex === 'male' ? male : sex === 'female' ? female : neutral)

export default function nameEn(path) {
  const { ups, downs, hasSpouse, sex } = kinshipFacts(path)

  // « Spouse » reste neutre : husband et wife supposeraient un mariage
  if (hasSpouse && ups === 0 && downs === 0) return 'Spouse'

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
  else if (ups === 1 && downs === 2) label = g(sex, 'Nephew', 'Niece', 'Nephew/Niece')
  else if (ups === 1 && downs === 3) label = g(sex, 'Grandnephew', 'Grandniece', 'Grandnephew/niece')
  else if (ups >= 2 && downs >= 2) {
    const degree = Math.min(ups, downs) - 1
    const removed = Math.abs(ups - downs)
    if (degree === 1 && removed === 0) label = 'First cousin'
    else if (degree === 1) label = 'First cousin once removed'
    else if (removed === 0) label = `Cousin, degree ${degree}`
    else label = 'Distant cousin'
  } else label = `${ups + downs} steps apart`

  return hasSpouse ? `${label} by marriage` : label
}
