// Doublon probable à l'ajout d'une personne (1.5.1) : même prénom, et même nom ou nom de naissance, sans tenir
// compte des accents, de la casse ni des espaces en trop. Trois au plus.
function norm(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function findLikelyDuplicates(persons = [], firstName = '', lastName = '') {
  const first = norm(firstName)
  const last = norm(lastName)
  if (!first || !last) return []
  return persons
    .filter((p) => !p.ghost && norm(p.firstName) === first && (norm(p.lastName) === last || norm(p.birthName) === last))
    .slice(0, 3)
}
