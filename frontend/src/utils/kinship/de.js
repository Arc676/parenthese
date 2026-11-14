import { isHalfSibling, isStepSibling, kinshipFacts } from './facts.js'

// Mot genré quand le sexe de la personne nommée est connu, forme neutre ou double sinon
const g = (sex, male, female, neutral) => (sex === 'male' ? male : sex === 'female' ? female : neutral)

// « Groß » + « Onkel » → « Großonkel » : le mot perd sa majuscule derrière un préfixe.
// Forme double : la partie commune ne se répète pas, « Großonkel/-tante »
const join = (prefix, word) => (prefix ? `${prefix}${word.toLowerCase().replace('/', '/-')}` : word)
// n fois « Ur » : Ur, Urur, Ururur
const ur = (n) => (n > 0 ? `Ur${'ur'.repeat(n - 1)}` : '')
// Préfixe d'écart de générations : Vater, Großvater, Urgroßvater, Ururgroßvater.
// Le même sert aux oncles et aux neveux (Onkel, Großonkel, Urgroßonkel).
const gross = (n) => (n <= 1 ? '' : join(ur(n - 2), 'Groß'))

// Au-delà de cinq générations, les « Ur » s'empilent trop : on écrit le numéro de génération
const MAX_UR = 5

export default function nameDe(path) {
  const { ups, downs, hasSpouse, sex } = kinshipFacts(path)

  // « Partner » plutôt qu'« Ehemann » : le lien ne dit pas s'il y a mariage
  if (hasSpouse && ups === 0 && downs === 0) return g(sex, 'Partner', 'Partnerin', 'Partner/-in')
  // Un seul parent en commun : Halb- ; l'enfant du conjoint d'un parent : Stief- (#218)
  if (isHalfSibling(path)) return g(sex, 'Halbbruder', 'Halbschwester', 'Halbgeschwister')
  if (isStepSibling(path)) return g(sex, 'Stiefbruder', 'Stiefschwester', 'Stiefgeschwister')

  if (hasSpouse) {
    // Comme l'anglais, l'allemand distingue l'ordre : le parent du conjoint (Schwieger-) n'est pas
    // le conjoint du parent (Stief-)
    const viaSpouseFirst = path.steps[0].move === 'spouse'
    if (ups === 1 && downs === 0) return viaSpouseFirst ? g(sex, 'Schwiegervater', 'Schwiegermutter', 'Schwiegerelternteil') : g(sex, 'Stiefvater', 'Stiefmutter', 'Stiefelternteil')
    if (ups === 0 && downs === 1) return viaSpouseFirst ? g(sex, 'Stiefsohn', 'Stieftochter', 'Stiefkind') : g(sex, 'Schwiegersohn', 'Schwiegertochter', 'Schwiegerkind')
    if (ups === 1 && downs === 1) return g(sex, 'Schwager', 'Schwägerin', 'Schwager/Schwägerin')
  }

  let label
  if (downs === 0 && ups > 0) {
    label = ups > MAX_UR
      ? `${g(sex, 'Vorfahre', 'Vorfahrin', 'Vorfahre/-in')} ${ups}. Generation`
      : join(gross(ups), g(sex, 'Vater', 'Mutter', 'Elternteil'))
  } else if (ups === 0 && downs > 0) {
    if (downs > MAX_UR) label = `Nachkomme ${downs}. Generation`
    else if (downs === 1) label = g(sex, 'Sohn', 'Tochter', 'Kind')
    else label = join(ur(downs - 2), g(sex, 'Enkel', 'Enkelin', 'Enkelkind'))
  } else {
    // Ligne collatérale. grade : 1 pour frères, oncles et neveux, 2 pour les cousins germains et
    // le cousin d'un parent (Onkel 2. Grades), et ainsi de suite ; removed : générations d'écart
    // entre les deux branches
    const grade = Math.min(ups, downs)
    const removed = Math.abs(ups - downs)
    const suffix = grade > 1 && removed > 0 ? ` ${grade}. Grades` : ''
    if (removed === 0) {
      if (grade === 1) label = g(sex, 'Bruder', 'Schwester', 'Geschwister')
      else if (grade === 2) label = g(sex, 'Cousin', 'Cousine', 'Cousin/-e')
      else label = `${g(sex, 'Cousin', 'Cousine', 'Cousin/-e')} ${grade - 1}. Grades`
    } else if (ups > downs) {
      label = `${join(gross(removed), g(sex, 'Onkel', 'Tante', 'Onkel/Tante'))}${suffix}`
    } else {
      label = `${join(gross(removed), g(sex, 'Neffe', 'Nichte', 'Neffe/Nichte'))}${suffix}`
    }
  }

  return hasSpouse ? `${label} (angeheiratet)` : label
}
