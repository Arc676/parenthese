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
