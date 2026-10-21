import { kinshipFacts } from './facts.js'

// Mot genré quand le sexe de la personne nommée est connu, forme double sinon
const g = (sex, male, female, both) => (sex === 'male' ? male : sex === 'female' ? female : both)

export default function nameFr(path) {
  const { ups, downs, hasSpouse, sex } = kinshipFacts(path)

  if (hasSpouse && ups === 0 && downs === 0) return g(sex, 'Conjoint', 'Conjointe', 'Conjoint(e)')

  if (hasSpouse) {
    if (ups === 1 && downs === 0) return g(sex, 'Beau-père', 'Belle-mère', 'Beau-parent')
    if (ups === 0 && downs === 1) return g(sex, 'Beau-fils', 'Belle-fille', 'Bel-enfant')
    if (ups === 1 && downs === 1) return g(sex, 'Beau-frère', 'Belle-sœur', 'Beau-frère/sœur')
  }

  let label
  if (downs === 0 && ups > 0) {
    if (ups === 1) label = g(sex, 'Père', 'Mère', 'Parent')
    else if (ups === 2) label = g(sex, 'Grand-père', 'Grand-mère', 'Grand-parent')
    else if (ups === 3) label = g(sex, 'Arrière-grand-père', 'Arrière-grand-mère', 'Arrière-grand-parent')
    else label = `${g(sex, 'Aïeul', 'Aïeule', 'Aïeul(e)')} ${ups}e gén.`
  } else if (ups === 0 && downs > 0) {
    if (downs === 1) label = g(sex, 'Fils', 'Fille', 'Enfant')
    else if (downs === 2) label = g(sex, 'Petit-fils', 'Petite-fille', 'Petit-enfant')
    else if (downs === 3) label = g(sex, 'Arrière-petit-fils', 'Arrière-petite-fille', 'Arrière-petit-enfant')
    else label = `${g(sex, 'Descendant', 'Descendante', 'Descendant(e)')} ${downs}e gén.`
  } else if (ups === 1 && downs === 1) label = g(sex, 'Frère', 'Sœur', 'Frère/Sœur')
  else if (ups === 2 && downs === 1) label = g(sex, 'Oncle', 'Tante', 'Oncle/Tante')
  else if (ups === 3 && downs === 1) label = g(sex, 'Grand-oncle', 'Grand-tante', 'Grand-oncle/tante')
  else if (ups === 1 && downs === 2) label = g(sex, 'Neveu', 'Nièce', 'Neveu/Nièce')
  else if (ups === 1 && downs === 3) label = g(sex, 'Petit-neveu', 'Petite-nièce', 'Petit-neveu/nièce')
  else if (ups >= 2 && downs >= 2) {
    const degree = Math.min(ups, downs) - 1
    const removed = Math.abs(ups - downs)
    if (degree === 1 && removed === 0) label = g(sex, 'Cousin germain', 'Cousine germaine', 'Cousin(e) germain(e)')
    else if (degree === 1) label = g(sex, 'Petit-cousin', 'Petite-cousine', 'Petit-cousin(e)')
    else if (removed === 0) label = `${g(sex, 'Cousin', 'Cousine', 'Cousin(e)')} ${degree}e degré`
    else label = g(sex, 'Cousin éloigné', 'Cousine éloignée', 'Cousin(e) éloigné(e)')
  } else label = `${ups + downs} liens`

  return hasSpouse ? `${label} par alliance` : label
}
