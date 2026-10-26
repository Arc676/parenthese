// Premier caractère affiché d'un nom, en majuscule, pour les pastilles (arbre, compte, personne). charAt(0) coupait
// un emoji en deux (« 🌳 Famille » donnait un losange « ? ») : on prend le premier graphème entier, emoji composés
// compris (👨‍👩‍👧, drapeaux).
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

export function initialOf(text, fallback = '?') {
  const value = String(text ?? '').trim()
  if (!value) return fallback
  const first = segmenter ? segmenter.segment(value)[Symbol.iterator]().next().value.segment : Array.from(value)[0]
  return first.toUpperCase()
}

// Initiales d'une personne : prénom puis nom (« JD »). Une écriture sans majuscules (chinois, japonais,
// coréen, arabe, hébreu…) n'a pas d'initiales : deux caractères collés s'y lisent comme un mot (« 小王 »,
// « فا »). On garde alors un seul caractère : le nom de famille pour le chinois, le japonais et le coréen,
// qui l'écrivent en premier, le prénom sinon.
const EAST_ASIAN = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u
const caseless = (c) => /\p{L}/u.test(c) && c.toUpperCase() === c.toLowerCase()

export function initialsOf(person, fallback = '?') {
  const first = initialOf(person?.firstName, '')
  const last = initialOf(person?.lastName, '')
  if (caseless(first) || caseless(last)) {
    const eastAsian = EAST_ASIAN.test(`${person?.firstName ?? ''}${person?.lastName ?? ''}`)
    return (eastAsian ? last || first : first || last) || fallback
  }
  return `${first}${last}` || fallback
}
