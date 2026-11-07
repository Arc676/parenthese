import { describe, it, expect } from 'vitest'
import { nameKinship } from './index.js'

// Chemin écrit à la main : moves = suite de pas, sex = sexe de la personne au bout
const path = (moves, sex = null) => ({
  from: { id: 'moi', sex: null, birthYear: null },
  steps: moves.map((move, i) => ({ move, person: { id: `p${i}`, sex: i === moves.length - 1 ? sex : null, birthYear: null } })),
})
const de = (moves) => ['male', 'female', null].map((sex) => nameKinship(path(moves, sex), 'de'))
const up = (n) => Array(n).fill('up')
const down = (n) => Array(n).fill('down')

describe('nommage allemand', () => {
  it('ligne directe : Groß-, Urgroß-, Ururgroß-, puis numéro de génération', () => {
    expect(de(['up'])).toEqual(['Vater', 'Mutter', 'Elternteil'])
    expect(de(up(2))).toEqual(['Großvater', 'Großmutter', 'Großelternteil'])
    expect(de(up(3))).toEqual(['Urgroßvater', 'Urgroßmutter', 'Urgroßelternteil'])
    expect(de(up(4))).toEqual(['Ururgroßvater', 'Ururgroßmutter', 'Ururgroßelternteil'])
    expect(de(up(5))).toEqual(['Urururgroßvater', 'Urururgroßmutter', 'Urururgroßelternteil'])
    expect(de(up(6))).toEqual(['Vorfahre 6. Generation', 'Vorfahrin 6. Generation', 'Vorfahre/Vorfahrin 6. Generation'])
    expect(de(['down'])).toEqual(['Sohn', 'Tochter', 'Kind'])
    expect(de(down(2))).toEqual(['Enkel', 'Enkelin', 'Enkelkind'])
    expect(de(down(3))).toEqual(['Urenkel', 'Urenkelin', 'Urenkelkind'])
    expect(de(down(4))).toEqual(['Ururenkel', 'Ururenkelin', 'Ururenkelkind'])
    expect(de(down(6))).toEqual(['Nachkomme 6. Generation', 'Nachkomme 6. Generation', 'Nachkomme 6. Generation'])
  })

  it('Halb- par un seul parent, Stief- par le conjoint d’un parent, Schwager par le conjoint d’un frère (#218)', () => {
    expect(de(['up', 'down'])).toEqual(['Halbbruder', 'Halbschwester', 'Halbgeschwister'])
    expect(de(['up', 'spouse', 'down'])).toEqual(['Stiefbruder', 'Stiefschwester', 'Stiefgeschwister'])
    expect(de(['sibling', 'spouse'])).toEqual(['Schwager', 'Schwägerin', 'Schwager/Schwägerin'])
    expect(de(['spouse', 'sibling'])).toEqual(['Schwager', 'Schwägerin', 'Schwager/Schwägerin'])
  })

  it('ligne collatérale : frères, oncles, neveux, cousins et leurs grades', () => {
    expect(de(['sibling'])).toEqual(['Bruder', 'Schwester', 'Geschwister'])
    expect(de(['up', 'sibling'])).toEqual(['Onkel', 'Tante', 'Onkel/Tante'])
    expect(de(['up', 'up', 'sibling'])).toEqual(['Großonkel', 'Großtante', 'Großonkel/tante'])
    expect(de(['up', 'up', 'up', 'sibling'])).toEqual(['Urgroßonkel', 'Urgroßtante', 'Urgroßonkel/tante'])
    expect(de(['sibling', 'down'])).toEqual(['Neffe', 'Nichte', 'Neffe/Nichte'])
    expect(de(['sibling', 'down', 'down'])).toEqual(['Großneffe', 'Großnichte', 'Großneffe/nichte'])
    expect(de(['up', 'sibling', 'down'])).toEqual(['Cousin', 'Cousine', 'Cousin/Cousine'])
    expect(de(['up', 'up', 'sibling', 'down', 'down'])).toEqual(['Cousin 2. Grades', 'Cousine 2. Grades', 'Cousin/Cousine 2. Grades'])
    // Le cousin d'un parent, l'enfant d'un cousin, le cousin d'un grand-parent
    expect(de(['up', 'up', 'sibling', 'down'])).toEqual(['Onkel 2. Grades', 'Tante 2. Grades', 'Onkel/Tante 2. Grades'])
    expect(de(['up', 'sibling', 'down', 'down'])).toEqual(['Neffe 2. Grades', 'Nichte 2. Grades', 'Neffe/Nichte 2. Grades'])
    expect(de(['up', 'up', 'up', 'sibling', 'down'])).toEqual(['Großonkel 2. Grades', 'Großtante 2. Grades', 'Großonkel/tante 2. Grades'])
    expect(de(['up', 'up', 'up', 'sibling', 'down', 'down'])).toEqual(['Onkel 3. Grades', 'Tante 3. Grades', 'Onkel/Tante 3. Grades'])
  })

  it('alliances : Schwieger- par le conjoint, Stief- par le conjoint d’un parent', () => {
    expect(de(['spouse'])).toEqual(['Partner', 'Partnerin', 'Partner/in'])
    expect(de(['spouse', 'up'])).toEqual(['Schwiegervater', 'Schwiegermutter', 'Schwiegerelternteil'])
    expect(de(['up', 'spouse'])).toEqual(['Stiefvater', 'Stiefmutter', 'Stiefelternteil'])
    expect(de(['spouse', 'down'])).toEqual(['Stiefsohn', 'Stieftochter', 'Stiefkind'])
    expect(de(['down', 'spouse'])).toEqual(['Schwiegersohn', 'Schwiegertochter', 'Schwiegerkind'])
    expect(de(['spouse', 'sibling'])).toEqual(['Schwager', 'Schwägerin', 'Schwager/Schwägerin'])
    expect(de(['sibling', 'spouse'])).toEqual(['Schwager', 'Schwägerin', 'Schwager/Schwägerin'])
    expect(de(['up', 'sibling', 'spouse'])).toEqual(['Onkel (angeheiratet)', 'Tante (angeheiratet)', 'Onkel/Tante (angeheiratet)'])
    expect(de(['spouse', 'up', 'up'])).toEqual(['Großvater (angeheiratet)', 'Großmutter (angeheiratet)', 'Großelternteil (angeheiratet)'])
  })

  it('« Autre » prend les formes neutres ou doubles, comme non précisé', () => {
    const autre = (moves) => nameKinship(path(moves, 'other'), 'de')
    expect(['up', 'down', 'sibling', 'spouse'].map((m) => autre([m]))).toEqual(['Elternteil', 'Kind', 'Geschwister', 'Partner/in'])
  })
})
