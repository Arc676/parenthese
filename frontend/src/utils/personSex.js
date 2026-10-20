import { t } from '../i18n/index.js'

export { normalizeSex } from './kinship/facts.js'

// Choix proposés à la saisie du sexe d'une personne (issue #114) : null = non précisé
export const SEX_CHOICES = [
  { value: 'female', label: t('Femme') },
  { value: 'male', label: t('Homme') },
  { value: 'other', label: t('Autre') },
  { value: null, label: t('Non précisé') },
]
