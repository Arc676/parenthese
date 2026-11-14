import { describe, it, expect } from 'vitest'
import { nameKinship } from './index.js'
import { path, namesBySex } from './test-helpers.js'

const both = namesBySex('en')

describe('nommage anglais', () => {
  it('genre le mot quand le sexe est connu', () => {
    expect(both(['up'])).toEqual(['Father', 'Mother', 'Parent'])
    expect(both(['up', 'up'])).toEqual(['Grandfather', 'Grandmother', 'Grandparent'])
    expect(both(['up', 'up', 'up', 'up'])).toEqual(['Great-great-grandfather', 'Great-great-grandmother', 'Great-great-grandparent'])
    expect(both(['down', 'down'])).toEqual(['Grandson', 'Granddaughter', 'Grandchild'])
    expect(both(['sibling'])).toEqual(['Brother', 'Sister', 'Sibling'])
    expect(both(['up', 'sibling'])).toEqual(['Uncle', 'Aunt', 'Uncle/Aunt'])
    expect(both(['sibling', 'down'])).toEqual(['Nephew', 'Niece', 'Nibling'])
    expect(both(['spouse', 'up'])).toEqual(['Father-in-law', 'Mother-in-law', 'Parent-in-law'])
    expect(both(['up', 'spouse'])).toEqual(['Stepfather', 'Stepmother', 'Stepparent'])
    expect(both(['spouse', 'down'])).toEqual(['Stepson', 'Stepdaughter', 'Stepchild'])
    expect(both(['down', 'spouse'])).toEqual(['Son-in-law', 'Daughter-in-law', 'Child-in-law'])
    expect(both(['spouse', 'sibling'])).toEqual(['Brother-in-law', 'Sister-in-law', 'Brother/sister-in-law'])
    expect(both(['sibling', 'spouse'])).toEqual(['Brother-in-law', 'Sister-in-law', 'Brother/sister-in-law'])
    expect(both(['up', 'spouse', 'down'])).toEqual(['Stepbrother', 'Stepsister', 'Stepsibling'])
    expect(both(['up', 'down'])).toEqual(['Half-brother', 'Half-sister', 'Half-sibling'])
    expect(both(['spouse'])).toEqual(['Partner', 'Partner', 'Partner'])
    expect(both(['up', 'sibling', 'down'])).toEqual(['First cousin', 'First cousin', 'First cousin'])
    expect(both(['up', 'up', 'sibling', 'down', 'down'])).toEqual(['Second cousin', 'Second cousin', 'Second cousin'])
    expect(both(['up', 'up', 'sibling', 'down'])).toEqual(['First cousin once removed', 'First cousin once removed', 'First cousin once removed'])
    expect(both(['up', 'up', 'up', 'up', 'up', 'up', 'sibling', 'down', 'down', 'down'])).toEqual(['Third cousin thrice removed', 'Third cousin thrice removed', 'Third cousin thrice removed'])
    expect(both(['up', 'up', 'up', 'sibling', 'down'])).toEqual(['First cousin twice removed', 'First cousin twice removed', 'First cousin twice removed'])
    expect(both(['up', 'up', 'up', 'up', 'up', 'sibling', 'down'])).toEqual(['First cousin 4 times removed', 'First cousin 4 times removed', 'First cousin 4 times removed'])
    expect(both(['up', 'up', 'up', 'up', 'sibling', 'down', 'down', 'down', 'down'])).toEqual(['4th cousin', '4th cousin', '4th cousin'])
    expect(both(['up', 'up', 'sibling'])).toEqual(['Great-uncle', 'Great-aunt', 'Great-uncle/aunt'])
    expect(both(['up', 'up', 'up', 'sibling'])).toEqual(['Great-great-uncle', 'Great-great-aunt', 'Great-great-uncle/aunt'])
    expect(both(['sibling', 'down', 'down'])).toEqual(['Grandnephew', 'Grandniece', 'Grandnibling'])
  })

  it('une langue inconnue retombe sur l’anglais', () => {
    expect(nameKinship(path(['up'], 'female'), 'xx')).toBe('Mother')
  })
})
