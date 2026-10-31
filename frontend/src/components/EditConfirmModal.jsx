import { useEffect, useRef } from 'react'
import { Save, X, ArrowLeft } from 'lucide-react'
import './EditConfirmModal.css'
import { t } from '../i18n/index.js'

/**
 * Modal de confirmation à la désactivation du mode édition
 * Apparaît si des modifications non-sauvegardées existent
 *
 * 3 options :
 * - Continuer l'édition (retour)
 * - Enregistrer brouillon et quitter
 * - Abandonner les modifications
 */
// demo : la démo ne garde rien sur l'appareil, ses modifications vivent le temps de la page
function EditConfirmModal({ visible, onContinue, onSaveAndQuit, onDiscard, demo = false }) {
  const continueRef = useRef(null)

  // Focus sur "Continuer" à l'ouverture + trap ESC
  useEffect(() => {
    if (!visible) return

    continueRef.current?.focus()

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onContinue()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible, onContinue])

  if (!visible) return null

  const [titleBefore, titleAfter] = t('Quitter {em} ?').split('{em}')

  return (
    <div className="pz-overlay" onClick={onContinue}>
      <div
        className="pz-modal edit-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pz-modal-head">
          <p className="pz-eyebrow">{t('Modifications en cours')}</p>
          <h2 id="edit-confirm-title" className="pz-title">{titleBefore}<em>{t("l'édition")}</em>{titleAfter}</h2>
          <p className="pz-sub">{demo
            ? t('Vos dernières modifications restent dans la démo tant que cette page est ouverte, puis elles disparaissent.')
            : t('Vos dernières modifications ne sont pas encore enregistrées. Elles restent sur cet appareil tant que vous ne les abandonnez pas.')}</p>
        </div>

        <div className="pz-modal-actions pz-modal-actions--split">
          <button type="button" className="pz-btn pz-btn--danger-ghost" onClick={onDiscard}>
            <X size={16} strokeWidth={2} />
            {t('Abandonner')}
          </button>
          <div className="edit-confirm-right">
            <button ref={continueRef} type="button" className="pz-btn pz-btn--secondary" onClick={onContinue}>
              <ArrowLeft size={16} strokeWidth={2} />
              {t('Continuer')}
            </button>
            <button type="button" className="pz-btn pz-btn--primary" onClick={onSaveAndQuit}>
              <Save size={16} strokeWidth={2} />
              {t('Enregistrer et quitter')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditConfirmModal
