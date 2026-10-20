import { describe, it, expect } from 'vitest'
import { SEX_CHOICES, sexLabel } from './personSex.js'

describe('saisie du sexe (issue #114)', () => {
  it('trois choix, non précisé par défaut quand rien n’est choisi', () => {
    expect(SEX_CHOICES.map((c) => c.value)).toEqual(['female', 'male', 'other'])
  })

  it('libellé d’une valeur enregistrée, « Non précisé » si vide', () => {
    expect([null, '', 'F', 'male', 'other'].map(sexLabel)).toEqual(['Non précisé', 'Non précisé', 'Femme', 'Homme', 'Autre'])
  })
})
