import { t } from '../i18n/index.js'

// Prénom inconnu : le backend stocke une chaîne vide. L'affichage dit « Prénom inconnu » (en italique).
export function isFirstNameUnknown(person) {
  return !String(person?.firstName ?? '').trim()
}

export function firstNameLabel(person) {
  return isFirstNameUnknown(person) ? t('Prénom inconnu') : String(person.firstName).trim()
}

// « Prénom Nom » pour une phrase ou une liste ; le prénom inconnu s'affiche comme son libellé
export function fullNameLabel(person) {
  return [firstNameLabel(person), person?.lastName].filter(Boolean).join(' ').trim()
}
