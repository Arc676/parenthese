import { useMemo } from 'react'
import { X } from 'lucide-react'
import './EditModeOverlay.css'
import { t } from '../i18n/index.js'

function EditSessionBar({ active, hasDraft, role = 'contributor', onDeactivate, onSubmit }) {
  const isAdmin = role === 'admin'

  const borderClass = useMemo(() => (
    `edit-mode-border ${isAdmin ? 'edit-mode-border--admin' : 'edit-mode-border--contributor'}`
  ), [isAdmin])

  // Libellés courts : ils doivent tenir sur un téléphone à côté du bouton
  // Invité : « Vous proposez » sur téléphone (une seule ligne), la phrase complète sur ordinateur
  const toastLabel = isAdmin ? t("Vous modifiez l'arbre") : null
  const submitLabel = isAdmin ? t("Mettre à jour l'arbre") : t('Envoyer')
  // La famille ne voit le bouton d'envoi que lorsqu'il y a quelque chose à envoyer
  const showSubmit = Boolean(onSubmit) && (isAdmin || hasDraft)

  if (!active) return null

  return (
    <>
      <div className={borderClass} aria-hidden="true" />

      <div className={`edit-mode-toast${isAdmin ? ' edit-mode-toast--admin' : ' edit-mode-toast--contrib'}${showSubmit ? ' edit-mode-toast--with-submit' : ''}`} role="status" aria-live="polite">
        <span className="edit-mode-toast-dot" aria-hidden="true" />
        {isAdmin ? (
          <span className="edit-mode-toast-text">{toastLabel}</span>
        ) : (
          <span className="edit-mode-toast-text">
            <span className="edit-mode-toast-long">{t('Vous proposez des changements')}</span>
            <span className="edit-mode-toast-short">{t('Vous proposez')}</span>
          </span>
        )}

        {showSubmit && (
          <button
            type="button"
            className="pz-btn pz-btn--primary pz-btn--sm edit-mode-submit"
            onClick={onSubmit}
            disabled={!hasDraft}
            title={hasDraft ? submitLabel : t("Aucune modification à envoyer pour l'instant")}
          >
            {submitLabel}
          </button>
        )}

        <button
          type="button"
          className="pz-btn pz-btn--ghost pz-btn--icon edit-mode-toast-close"
          onClick={onDeactivate}
          aria-label={t('Quitter le mode édition')}
        >
          <X size={17} strokeWidth={2} />
        </button>
      </div>
    </>
  )
}

export default EditSessionBar
