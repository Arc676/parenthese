import { useState } from 'react'
import { t } from '../i18n/index.js'
import { dateToInputText, parseDateInput } from '../utils/dateInput.js'

// Champ de date de la fiche : une année seule ou une date complète (issue #77). Le texte tapé reste tel
// quel ; la valeur ne remonte qu'une fois comprise, sinon le champ le signale sans rien enregistrer.
export default function DateField({ id, value, onChange, placeholder, className = '' }) {
  const [text, setText] = useState(() => dateToInputText(value))
  const invalid = parseDateInput(text) === undefined

  return (
    <span className="pz-date">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className={className}
        value={text}
        placeholder={placeholder || t('Année ou date')}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setText(e.target.value)
          const parsed = parseDateInput(e.target.value)
          if (parsed !== undefined) onChange(parsed)
        }}
      />
      {invalid && <span className="pz-date-hint" role="status">{t('Une année (1950) ou une date (12/03/1950)')}</span>}
    </span>
  )
}
