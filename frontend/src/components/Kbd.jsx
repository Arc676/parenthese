import { shortcutKeys } from '../utils/shortcuts.js'

// Raccourci clavier affiché à droite d'une entrée de menu ; caché sur écran tactile (styles/pz.css, .pz-kbd)
export default function Kbd({ mod, k }) {
  return (
    <span className="pz-kbd" aria-hidden="true">
      {shortcutKeys(mod, k).map((key) => <kbd key={key}>{key}</kbd>)}
    </span>
  )
}
