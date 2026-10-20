import { t } from '../i18n/index.js'

import { normalizeSex } from './kinship/facts.js'

export { normalizeSex }

// Choix proposés à la saisie du sexe d'une personne (issue #114, tranché par Patch le 20/10) : trois boutons à
// bascule. Rien de choisi = non précisé (null), la valeur par défaut ; un second clic sur le choix actif y revient.
export const SEX_CHOICES = [
  { value: 'female', label: t('Femme') },
  { value: 'male', label: t('Homme') },
  { value: 'other', label: t('Autre') },
]

// Libellé d'une valeur enregistrée, « Non précisé » compris (relecture des propositions)
export function sexLabel(value) {
  const sex = normalizeSex(value)
  return SEX_CHOICES.find((choice) => choice.value === sex)?.label ?? t('Non précisé')
}
