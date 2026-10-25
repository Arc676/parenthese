// Ce qu'un résultat de recherche ajoute à une personne de l'arbre : seulement les champs encore vides,
// jamais une valeur déjà saisie par la famille. La personne passe « à vérifier » et sa note garde la
// source, pour qu'on puisse relire d'où vient l'information. Rien de nouveau : null.
export function changesFromResult(person, result, sourceLabel) {
  if (!person || !result) return null
  const changes = {}
  const hasBirth = Boolean(person.birthYear || person.birthDate)
  const hasDeath = Boolean(person.deathYear || person.deathDate)

  if (!hasBirth && result.birth?.date) changes.birthYear = result.birth.date
  if (!person.birthPlace && result.birth?.place) changes.birthPlace = result.birth.place
  if (!hasDeath && result.death?.date) changes.deathYear = result.death.date
  if (!person.deathPlace && result.death?.place) changes.deathPlace = result.death.place

  if (Object.keys(changes).length === 0) return null

  changes.toVerify = true
  const sourceLine = `${sourceLabel} : ${result.url}`
  const note = String(person.note || '').trim()
  changes.note = note.includes(result.url) ? note : [note, sourceLine].filter(Boolean).join('\n')
  return changes
}
