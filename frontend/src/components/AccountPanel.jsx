import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import './AccountScreens.css'
import { t } from '../i18n/index.js'

const AccountPanel = ({
  visible,
  userDisplayName = '',
  userEmail = '',
  linkedPerson = null,
  selectedPersonId = '',
  people = [],
  onSelectPerson,
  onManageAccount,
  onClose,
}) => {
  const [query, setQuery] = useState('')

  const filteredPeople = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const source = Array.isArray(people) ? people : []
    if (!normalizedQuery) {
      return source.slice(0, 40)
    }

    return source
      .filter((person) => `${person.firstName || ''} ${person.lastName || ''}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 40)
  }, [people, query])

  if (!visible) {
    return null
  }

  const displayName = linkedPerson
    ? `${linkedPerson.firstName || ''} ${linkedPerson.lastName || ''}`.trim()
    : userDisplayName || (userEmail ? t('Mon compte') : t('Qui êtes-vous dans cet arbre ?'))

  return (
    <div className="pz-overlay account-overlay account-overlay--open" onClick={onClose}>
      <div className="pz-modal account-card" role="dialog" aria-modal="true" aria-labelledby="accountPanelTitle" onClick={(event) => event.stopPropagation()}>
        <div className="pz-modal-head">
          <p className="pz-eyebrow">{userEmail ? t('Mon compte') : t('Dans cet arbre')}</p>
          <h1 id="accountPanelTitle" className="pz-title">{displayName}</h1>
          {userEmail && <p className="pz-sub">{userEmail}</p>}
        </div>
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pz-modal-close" onClick={onClose} aria-label={t('Fermer')}>
          <X size={18} aria-hidden="true" />
        </button>

        <div className="ap-linked">
          <span className="ap-avatar" aria-hidden="true">
            {linkedPerson?.photo ? <img src={linkedPerson.photo} alt="" /> : (linkedPerson?.firstName || userDisplayName || 'C').charAt(0).toUpperCase()}
          </span>
          <p className="pz-small">
            {linkedPerson
              ? t('Vous apparaissez dans cet arbre sous ce nom et avec cette photo.')
              : t('Dites-nous qui vous êtes dans cet arbre, votre nom et votre photo viendront de votre fiche.')}
          </p>
        </div>

        <div className="ap-pick">
          <div className="pz-field">
            <label htmlFor="accountPanelSearch">{t('Je suis cette personne')}</label>
            <input
              id="accountPanelSearch"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Chercher votre prénom')}
              autoComplete="off"
            />
          </div>

          <div className="ap-list">
            {filteredPeople.length === 0 ? (
              <p className="pz-small ap-empty">{t('Personne ne correspond à cette recherche.')}</p>
            ) : (
              filteredPeople.map((person) => {
                const isSelected = String(selectedPersonId) === String(person.id)
                return (
                  <button
                    key={person.id}
                    type="button"
                    className={`ap-item ${isSelected ? 'is-active' : ''}`}
                    onClick={() => onSelectPerson?.(person.id)}
                  >
                    <span className="ap-item-avatar" aria-hidden="true">
                      {person.photo ? <img src={person.photo} alt="" /> : (person.firstName || '?').charAt(0)}
                    </span>
                    <span className="ap-item-name">{person.firstName} <em>{person.lastName || ''}</em></span>
                    {isSelected && <span className="pz-tag pz-tag--accent">{t("C'est moi")}</span>}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {(selectedPersonId || onManageAccount) && (
          <div className="pz-modal-actions">
            {selectedPersonId && (
              <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={() => onSelectPerson?.(null)}>
                {t("Ce n'est plus moi")}
              </button>
            )}
            {/* Vos arbres, déconnexion et suppression du compte : l'écran du compte, joignable d'ici */}
            {onManageAccount && (
              <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm ap-manage" onClick={onManageAccount}>
                {t('Gérer mon compte')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default AccountPanel
