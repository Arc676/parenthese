// Partagé par les fichiers kinship.<langue>.test.js. Ce n'est pas un fichier de test :
// Vitest ne le ramasse pas (include: src/**/*.test.{js,jsx}).
import { nameKinship } from './index.js'

// Chemin écrit à la main : moves = suite de pas, sex = sexe de la personne au bout
export const path = (moves, sex = null, extra = {}) => ({
  from: { id: 'moi', sex: null, birthYear: null },
  steps: moves.map((move, i) => ({ move, person: { id: `p${i}`, sex: i === moves.length - 1 ? sex : null, birthYear: null, ...(extra[i] || {}) } })),
})

// Nomme le même chemin pour un homme, une femme et un sexe non précisé au bout
export const namesBySex = (lang) => (moves) => ['male', 'female', null].map((sex) => nameKinship(path(moves, sex), lang))
