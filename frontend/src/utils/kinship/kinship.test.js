import { describe, it, expect } from 'vitest'
import { kinshipFacts, nameKinship, normalizeSex } from './index.js'
import { computeRelationshipLabel, kinshipPath } from '../../components/galaxy/pathfinding.js'

// Chemin écrit à la main : moves = suite de pas, sex = sexe de la personne au bout
const path = (moves, sex = null, extra = {}) => ({
  from: { id: 'moi', sex: null, birthYear: null },
  steps: moves.map((move, i) => ({ move, person: { id: `p${i}`, sex: i === moves.length - 1 ? sex : null, birthYear: null, ...(extra[i] || {}) } })),
})

const both = (moves) => ['male', 'female', null].map((sex) => nameKinship(path(moves, sex), 'fr'))
const bothEn = (moves) => ['male', 'female', null].map((sex) => nameKinship(path(moves, sex), 'en'))

describe('nommage français', () => {
  it('genre le mot quand le sexe est connu, garde la forme double sinon', () => {
    expect(both(['up'])).toEqual(['Père', 'Mère', 'Parent'])
    expect(both(['down'])).toEqual(['Fils', 'Fille', 'Enfant'])
    expect(both(['sibling'])).toEqual(['Frère', 'Sœur', 'Frère/Sœur'])
    expect(both(['up', 'up'])).toEqual(['Grand-père', 'Grand-mère', 'Grand-parent'])
    expect(both(['down', 'down'])).toEqual(['Petit-fils', 'Petite-fille', 'Petit-enfant'])
    expect(both(['up', 'up', 'up'])).toEqual(['Arrière-grand-père', 'Arrière-grand-mère', 'Arrière-grand-parent'])
    expect(both(['down', 'down', 'down'])).toEqual(['Arrière-petit-fils', 'Arrière-petite-fille', 'Arrière-petit-enfant'])
    expect(both(['up', 'sibling'])).toEqual(['Oncle', 'Tante', 'Oncle/Tante'])
    expect(both(['up', 'up', 'sibling'])).toEqual(['Grand-oncle', 'Grand-tante', 'Grand-oncle/tante'])
    expect(both(['sibling', 'down'])).toEqual(['Neveu', 'Nièce', 'Neveu/Nièce'])
    expect(both(['sibling', 'down', 'down'])).toEqual(['Petit-neveu', 'Petite-nièce', 'Petit-neveu/nièce'])
    expect(both(['up', 'sibling', 'down'])).toEqual(['Cousin germain', 'Cousine germaine', 'Cousin(e) germain(e)'])
    expect(both(['up', 'up', 'sibling', 'down'])).toEqual(['Petit-cousin', 'Petite-cousine', 'Petit-cousin(e)'])
    expect(both(['up', 'up', 'sibling', 'down', 'down'])).toEqual(['Cousin 2e degré', 'Cousine 2e degré', 'Cousin(e) 2e degré'])
    expect(both(['up', 'up', 'up', 'sibling', 'down', 'down'])).toEqual(['Cousin éloigné', 'Cousine éloignée', 'Cousin(e) éloigné(e)'])
    expect(both(['up', 'up', 'up', 'up'])).toEqual(['Aïeul 4e gén.', 'Aïeule 4e gén.', 'Aïeul(e) 4e gén.'])
  })

  it('alliances', () => {
    expect(both(['spouse'])).toEqual(['Conjoint', 'Conjointe', 'Conjoint(e)'])
    expect(both(['spouse', 'up'])).toEqual(['Beau-père', 'Belle-mère', 'Beau-parent'])
    expect(both(['down', 'spouse'])).toEqual(['Beau-fils', 'Belle-fille', 'Bel-enfant'])
    expect(both(['spouse', 'sibling'])).toEqual(['Beau-frère', 'Belle-sœur', 'Beau-frère/sœur'])
    expect(both(['spouse', 'up', 'sibling'])).toEqual(['Oncle par alliance', 'Tante par alliance', 'Oncle/Tante par alliance'])
  })

  it('« Autre » prend les formes neutres ou doubles, comme non précisé', () => {
    const autre = (moves, lang) => nameKinship(path(moves, 'other'), lang)
    expect(['up', 'down', 'sibling', 'spouse'].map((m) => autre([m], 'fr'))).toEqual(['Parent', 'Enfant', 'Frère/Sœur', 'Conjoint(e)'])
    expect(autre(['up', 'sibling', 'down'], 'fr')).toBe('Cousin(e) germain(e)')
    expect(autre(['up', 'spouse'], 'fr')).toBe('Beau-parent')
    expect(['up', 'down', 'sibling', 'up,sibling', 'up,spouse'].map((m) => autre(m.split(','), 'en'))).toEqual(['Parent', 'Child', 'Sibling', 'Uncle/Aunt', 'Stepparent'])
  })

  it('le sexe des personnes du milieu ne change pas le mot (seule la personne nommée compte)', () => {
    const p = path(['up', 'sibling'], 'female', { 0: { sex: 'male' } })
    expect(nameKinship(p, 'fr')).toBe('Tante')
  })
})

describe('nommage anglais', () => {
  it('genre le mot quand le sexe est connu', () => {
    expect(bothEn(['up'])).toEqual(['Father', 'Mother', 'Parent'])
    expect(bothEn(['down', 'down'])).toEqual(['Grandson', 'Granddaughter', 'Grandchild'])
    expect(bothEn(['sibling'])).toEqual(['Brother', 'Sister', 'Sibling'])
    expect(bothEn(['up', 'sibling'])).toEqual(['Uncle', 'Aunt', 'Uncle/Aunt'])
    expect(bothEn(['sibling', 'down'])).toEqual(['Nephew', 'Niece', 'Nephew/Niece'])
    expect(bothEn(['spouse', 'up'])).toEqual(['Father-in-law', 'Mother-in-law', 'Parent-in-law'])
    expect(bothEn(['up', 'spouse'])).toEqual(['Stepfather', 'Stepmother', 'Stepparent'])
    expect(bothEn(['spouse', 'down'])).toEqual(['Stepson', 'Stepdaughter', 'Stepchild'])
    expect(bothEn(['down', 'spouse'])).toEqual(['Son-in-law', 'Daughter-in-law', 'Child-in-law'])
    expect(bothEn(['spouse', 'sibling'])).toEqual(['Brother-in-law', 'Sister-in-law', 'Brother/sister-in-law'])
    expect(bothEn(['spouse'])).toEqual(['Spouse', 'Spouse', 'Spouse'])
    expect(bothEn(['up', 'sibling', 'down'])).toEqual(['First cousin', 'First cousin', 'First cousin'])
  })

  it('une langue inconnue retombe sur l’anglais', () => {
    expect(nameKinship(path(['up'], 'female'), 'xx')).toBe('Mother')
  })
})

describe('chemin de parenté depuis le chemin BFS', () => {
  // moi → union de mes parents → mon père → union des grands-parents → ma tante
  const edgePath = [
    { type: 'filiation', id: 'e1' },
    { type: 'couple', id: 'u1' },
    { type: 'filiation', id: 'e2' },
    { type: 'filiation', id: 'e3' },
  ]
  const nodePath = ['p-1', 'u-1', 'p-2', 'u-2', 'p-3']
  const people = { 'p-1': { id: 1, sex: 'female', birthYear: 1990 }, 'p-2': { id: 2, sex: 'M', birthYear: 1960 }, 'p-3': { id: 3, sex: 'F', birthYear: 1955 } }

  it('garde chaque pas et la personne atteinte, pour les langues qui en ont besoin', () => {
    const k = kinshipPath(edgePath, nodePath, (id) => people[id])
    expect(k.from).toEqual({ id: 1, sex: 'female', birthYear: 1990 })
    expect(k.steps).toEqual([
      { move: 'up', person: { id: 2, sex: 'male', birthYear: 1960 } },
      { move: 'sibling', person: { id: 3, sex: 'female', birthYear: 1955 } },
    ])
    expect(kinshipFacts(k)).toEqual({ ups: 2, downs: 1, hasSpouse: false, sex: 'female' })
  })

  it('nomme avec le sexe de la personne au bout', () => {
    expect(computeRelationshipLabel(edgePath, nodePath, (id) => people[id])).toBe('Tante')
    expect(computeRelationshipLabel(edgePath)).toBe('Oncle/Tante')
  })
})

describe('normalizeSex', () => {
  it('lit les anciennes valeurs M/F et le reste en non précisé', () => {
    expect(['male', 'M', 'female', 'f', 'other', 'X', null, '', 'U'].map(normalizeSex)).toEqual(['male', 'male', 'female', 'female', 'other', 'other', null, null, null])
  })
})
