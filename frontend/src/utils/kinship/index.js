// Nom d'un lien de parenté, une fonction de nommage par langue (issue #114).
//
// Le chemin arrive complet : la personne de départ, puis chaque pas avec la personne atteinte.
//   { from: { id, sex, birthYear }, steps: [{ move, person: { id, sex, birthYear } }] }
// move vaut 'up' (vers un parent), 'down' (vers un enfant), 'sibling' (vers un frère ou une sœur)
// ou 'spouse' (vers un conjoint). sex vaut 'male', 'female', 'other' (autre) ou null (non précisé).
//
// Chaque langue lit ce dont elle a besoin. Le français et l'anglais comptent les générations et
// regardent le sexe de la personne nommée (kinshipFacts). Une langue qui distingue le côté paternel
// ou maternel lit le sexe du premier parent du chemin (steps[0].person quand steps[0].move === 'up'),
// et les aînés et cadets se lisent sur les années de naissance de deux personnes du chemin.
// Brancher une langue : écrire ./<code>.js sur le modèle de ./fr.js et l'ajouter à NAMERS.
import { locale } from '../../i18n/index.js'
import nameFr from './fr.js'
import nameEn from './en.js'

export { kinshipFacts, normalizeSex } from './facts.js'

const NAMERS = { fr: nameFr, en: nameEn }

export function nameKinship(path, lang = locale) {
  if (!path?.steps?.length) return ''
  return (NAMERS[lang] || nameEn)(path)
}
