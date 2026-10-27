// Raccourcis clavier affichés dans l'interface (infobulles, menus). Sur Mac, Ctrl s'écrit ⌃ et Cmd ⌘.
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

// mod : 'ctrl' (Ctrl partout) ou 'cmd' (⌘ sur Mac, Ctrl ailleurs)
export function shortcutKeys(mod, key) {
  const modifier = mod === 'cmd' ? (isMac ? '⌘' : 'Ctrl') : (isMac ? '⌃' : 'Ctrl')
  return [modifier, key.toUpperCase()]
}

// Texte d'une infobulle : « Rechercher une personne (Ctrl K) », « … (⌘K) » sur Mac
export function withShortcut(label, mod, key) {
  const keys = shortcutKeys(mod, key)
  return `${label} (${isMac ? keys.join('') : keys.join(' ')})`
}

// Ctrl+K, ou ⌘K sur Mac
export function isCommandK(event) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k'
}
