import { t } from '../i18n/index.js'

function plural(count, one, many) {
  return count > 1 ? t(many, { n: count }) : t(one, { n: count })
}

// Ce que contient une proposition, en une ligne : « 1 personne, 2 liens, 1 photo sur l'arbre »
export function summarizeChanges(changes = []) {
  const count = { person: 0, update: 0, link: 0, annotation: 0, other: 0 }
  for (const change of changes) {
    if (change.entityType === 'person' && change.action === 'create') count.person += 1
    else if (change.entityType === 'person') count.update += 1
    else if (change.entityType === 'union' || change.entityType === 'parent_child_link') count.link += 1
    else if (change.entityType === 'annotation') count.annotation += 1
    else count.other += 1
  }
  return [
    count.person && plural(count.person, '{n} personne', '{n} personnes'),
    count.update && plural(count.update, '{n} fiche modifiée', '{n} fiches modifiées'),
    count.link && plural(count.link, '{n} lien', '{n} liens'),
    count.annotation && plural(count.annotation, "{n} ajout sur l'arbre", "{n} ajouts sur l'arbre"),
    count.other && plural(count.other, '{n} autre changement', '{n} autres changements'),
  ].filter(Boolean).join(', ')
}
