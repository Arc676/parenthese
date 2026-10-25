import { describe, expect, it } from 'vitest'
import { changesFromResult } from './searchResultChanges.js'

const RESULT = {
  id: 'abc123',
  birth: { date: '1898-03-14', place: 'Tulle (19)' },
  death: { date: '1987-11-08', place: 'Limoges (87)' },
  url: 'https://deces.matchid.io/id/abc123',
}

describe('changesFromResult', () => {
  it('remplit les champs vides, marque à vérifier et note la source', () => {
    const person = { firstName: 'Jean', lastName: 'Dupont', birthYear: 1898, birthPlace: 'Tulle', note: 'Menuisier' }
    expect(changesFromResult(person, RESULT, 'Décès en France depuis 1970')).toEqual({
      deathYear: '1987-11-08',
      deathPlace: 'Limoges (87)',
      toVerify: true,
      note: 'Menuisier\nDécès en France depuis 1970 : https://deces.matchid.io/id/abc123',
    })
  })

  it("ne touche jamais une valeur déjà saisie, et ne rend rien s'il n'y a rien de nouveau", () => {
    const complete = { birthDate: '1898-01-01', birthPlace: 'Tulle', deathDate: '1987-01-01', deathPlace: 'Limoges' }
    expect(changesFromResult(complete, RESULT, 'Décès')).toBeNull()
  })

  it("n'ajoute pas deux fois la même source à la note", () => {
    const person = { note: 'Décès : https://deces.matchid.io/id/abc123' }
    expect(changesFromResult(person, RESULT, 'Décès').note).toBe('Décès : https://deces.matchid.io/id/abc123')
  })
})
