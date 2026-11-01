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

function grule(n) {
  switch (n - 1) {
    case 1:
    return "Grand"
    default:
    return `Great-${"great-".repeat(n - 3)}grand`
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
    switch (ups) {
      case 1:
        label = g(sex, 'Father', 'Mother', 'Parent')
        break;
      default:
        label = `${grule(ups)}${g(sex, 'father', 'mother', 'parent')}`
        break;
    }
  } else if (ups === 0 && downs > 0) {
    switch (downs) {
      case 1:
        label = g(sex, 'Son', 'Daughter', 'Child')
        break;
      default:
        label = `${grule(downs)}${g(sex, 'son', 'daughter', 'child')}`
        break;
    }
  } else if (downs == 1) {
    switch (ups) {
      case 1:
        label = g(sex, 'Brother', 'Sister', 'Sibling')
        break;
      case 2:
        label = g(sex, 'Uncle', 'Aunt', 'Uncle/Aunt')
        break;
      default:
        label = `${grule(ups - 1)}${g(sex, 'uncle', 'aunt', 'uncle/aunt')}`
        break;
    }
  } else if (ups === 1) {
    switch (downs) {
      case 2:
        label = g(sex, 'Nephew', 'Niece', 'Nibling')
        break;
      default:
        label = `${grule(downs - 1)}${g(sex, 'nephew', 'niece', 'nibling')}`
        break;
    }
  } else if (ups >= 2 && downs >= 2) {
    const degree = Math.min(ups, downs) - 1
    const removed = Math.abs(ups - downs)
    if (removed === 0) label = `${ordinal(degree)} cousin`
    else label = `${ordinal(degree)} cousin, ${times(removed)} removed`
  } else label = `${ups + downs} steps apart`

  return hasSpouse ? `${label} by marriage` : label
}
