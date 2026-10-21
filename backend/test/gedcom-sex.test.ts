import { describe, expect, it } from 'vitest'

import { parseSex } from '../src/lib/person-sex'
import { gedcomSexValue, parseGedcom } from '../src/routes/gedcom'

// Export en GEDCOM 5.5.1 : SEX ne vaut que M, F ou U (#118). « X » n'existe qu'en GEDCOM 7.
describe('export GEDCOM 5.5.1 : valeur SEX', () => {
  it('écrit M, F, et U pour un sexe « autre »', () => {
    expect(gedcomSexValue('male')).toBe('M')
    expect(gedcomSexValue('female')).toBe('F')
    expect(gedcomSexValue('other')).toBe('U')
  })

  it("n'écrit jamais X, et ne déclare rien pour un sexe non précisé", () => {
    for (const sex of ['male', 'female', 'other', null] as const) {
      expect(gedcomSexValue(sex)).not.toBe('X')
    }
    expect(gedcomSexValue(null)).toBeNull()
  })

  it('l’import relit toujours SEX X comme « autre », et U comme non précisé', () => {
    const sexes = parseGedcom(['0 @I1@ INDI', '1 SEX X', '0 @I2@ INDI', '1 SEX U'].join('\n'))
      .filter((node) => node.tag === 'INDI')
      .map((indi) => parseSex(indi.children.find((child) => child.tag === 'SEX')?.value ?? null))
    expect(sexes).toEqual(['other', null])
  })
})
