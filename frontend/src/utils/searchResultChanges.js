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

const SEX = { M: 'male', F: 'female' }

// « 1898 » ou « 1898-03 » : la base garde une date complète, l'année seule s'écrit au 1er janvier (comme la fiche)
function toStoredDate(value) {
  if (!value) return null
  return value.length === 10 ? value : `${value.slice(0, 4)}-01-01`
}

// Nouvelle personne créée depuis un résultat, rattachée à quelqu'un de l'arbre (même forme que « Ajouter quelqu'un »)
export function personFromResult(result, sourceLabel, relation) {
  return {
    firstName: result.firstName || '',
    lastName: result.lastName || '',
    sex: SEX[result.sex] || null,
    birthDate: toStoredDate(result.birth?.date),
    deathDate: toStoredDate(result.death?.date),
    birthPlace: result.birth?.place || null,
    deathPlace: result.death?.place || null,
    isDeceased: false,
    toVerify: true,
    notes: `${sourceLabel} : ${result.url}`,
    relations: relation ? [{ personId: relation.personId, type: relation.type }] : [],
  }
}
