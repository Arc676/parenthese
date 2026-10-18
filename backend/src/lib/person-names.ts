// Nom de famille facultatif, prénom facultatif (prénom inconnu = vide) : une personne garde au moins un des deux
export function hasAnyName(firstName: string, lastName: string): boolean {
  return Boolean(firstName.trim() || lastName.trim())
}
