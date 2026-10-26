import { useState } from 'react'
import { t } from '../i18n/index.js'
import { dateToInputText, formatDigitsAsDate, parseDateInput } from '../utils/dateInput.js'

// Champ de date de la fiche : une année seule ou une date complète (issue #77). Le texte tapé reste tel
// quel ; la valeur ne remonte qu'une fois comprise, sinon le champ le signale sans rien enregistrer.
// Le clavier numérique du téléphone n'a pas de barre oblique : au-delà de 4 chiffres, les barres se posent
// toutes seules (12031950 → 12/03/1950). Le message n'apparaît qu'en quittant le champ.
export default function DateField({ id, value, onChange, placeholder, className = '' }) {
  const [text, setText] = useState(() => dateToInputText(value))
  const [touched, setTouched] = useState(false)
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
        aria-invalid={(touched && invalid) || undefined}
        onChange={(e) => {
          const next = formatDigitsAsDate(e.target.value)
          setText(next)
          const parsed = parseDateInput(next)
          if (parsed !== undefined) {
            setTouched(false)
            onChange(parsed)
          }
        }}
        onBlur={() => {
          const parsed = parseDateInput(text)
          if (parsed === undefined) setTouched(true)
          else setText(dateToInputText(parsed))
        }}
      />
      {touched && invalid && <span className="pz-date-hint" role="status">{t('Une année (1950) ou une date ({exemple})', { exemple: dateToInputText('1950-03-12') })}</span>}
    </span>
  )
}
