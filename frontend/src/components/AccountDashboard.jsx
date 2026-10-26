import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronRight, KeyRound, LogIn, LogOut, Plus, Sparkles, X } from 'lucide-react'
import logoUrl from '../assets/parenthese-logo.svg?url'
import './AccountScreens.css'
import PzBusy from './PzBusy.jsx'
import LanguageSwitch from './navbar/LanguageSwitch'
import { t } from '../i18n/index.js'
import { PRIVACY_URL } from '../utils/siteLinks.js'
import { initialOf } from '../utils/initial.js'

// Phrase traduite d'un bloc : les passages entre astérisques passent en <em>, {slot} reçoit un nœud.
function richText(text, slotNode = null) {
  return text.split(/(\{slot\})/).flatMap((chunk, chunkIndex) => (
    chunk === '{slot}'
      ? [<Fragment key={`s${chunkIndex}`}>{slotNode}</Fragment>]
      : chunk.split('*').map((part, index) => (index % 2 ? <em key={`${chunkIndex}-${index}`}>{part}</em> : part))
  ))
}

const AccountDashboard = ({
  authenticated,
  loading,
  errorMessage,
  trees,
  activeTreeId,
  defaultMode = 'login',
  canRegister = true,
  passwordLogin = true,
  oidcName = '',
  onOidcLogin,
  hasPassword = true,
  // Compte à mot de passe sur une instance OIDC : « Se connecter aussi avec … » relie le fournisseur, pour que le compte
  // reste accessible quand l'instance passe en connexion par le fournisseur seule. oidcLinked : déjà fait
  onLinkOidc,
  oidcLinked = false,
  pendingTreeName = '',
  onLogin,
  onRegister,
  onOpenTree,
  onStartTreeWizard,
  onLogout,
  onDeleteAccount,
  onBackToAccess,
  onBackToTree,
  onUseDemo,
}) => {
  const [mode, setMode] = useState(defaultMode === 'register' ? 'register' : 'login')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const openDeleteModal = () => {
    setDeletePassword('')
    setDeleteError('')
    setDeleteModalOpen(true)
  }

  const closeDeleteModal = () => {
    if (deleting) return
    setDeleteModalOpen(false)
    setDeletePassword('')
    setDeleteError('')
  }

  const handleDeleteSubmit = async (event) => {
    event.preventDefault()
    if (deleting || !deletePassword || !onDeleteAccount) return

    setDeleting(true)
    setDeleteError('')
    const errorMessage = await onDeleteAccount(hasPassword ? { password: deletePassword } : { confirmEmail: deletePassword })
    setDeleting(false)

    if (errorMessage) {
      setDeleteError(errorMessage)
      return
    }

    setDeleteModalOpen(false)
    setDeletePassword('')
  }

  useEffect(() => {
    setMode(defaultMode === 'register' ? 'register' : 'login')
  }, [defaultMode])

  // Inscription fermée sur l'instance : seul le formulaire de connexion reste
  const isRegister = mode === 'register' && canRegister

  const canSubmitAuth = useMemo(() => {
    if (loading) return false
    if (!email.trim()) return false
    if (password.length < 8) return false
    if (isRegister && !firstName.trim()) return false
    return true
  }, [email, firstName, isRegister, loading, password.length])

  const handleAuthSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmitAuth) {
      return
    }

    const safeEmail = email.trim().toLowerCase()
    if (isRegister) {
      await onRegister?.(firstName.trim(), safeEmail, password)
      return
    }
    await onLogin(safeEmail, password)
  }

  // Arrivé depuis un arbre ouvert : une croix y ramène
  const closeButton = onBackToTree && (
    <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pz-screen-close" onClick={onBackToTree} aria-label={t("Revenir à l'arbre")}>
      <X size={20} aria-hidden="true" />
    </button>
  )

  if (!authenticated) {
    return (
      <div className="account-dashboard pz-screen">
        {closeButton}
        <div className="pz-screen-inner">
          <img src={logoUrl} alt="Parenthèse" className="pz-screen-logo" />

          <div className="pz-card pz-screen-card pz-auth">
            <div className="pz-auth-head">
              <h1 className="pz-title">{isRegister ? richText(t('Créez votre *compte*')) : richText(t('Retrouvez votre *famille*'))}</h1>
              <p className="pz-sub">
                {isRegister
                  ? t('Gratuit, et ça le restera. Un prénom, un email, un mot de passe, et vous pouvez commencer.')
                  : t('Connectez-vous pour ouvrir vos arbres et ajouter des souvenirs.')}
              </p>
            </div>

            {pendingTreeName && (
              <p className="account-pending-tree pz-auth-note">
                {t("Vous reviendrez ensuite sur l'arbre « {name} », rattaché à votre compte.", { name: pendingTreeName })}
              </p>
            )}

            {/* Fournisseur d'identité de l'instance (OIDC, #115) : il connecte, et crée le compte si l'instance en accepte */}
            {onOidcLogin && (
              <button type="button" className="pz-btn pz-btn--primary pz-btn--block account-oidc" onClick={onOidcLogin} disabled={loading}>
                <LogIn size={16} aria-hidden="true" />
                {t('Se connecter avec {name}', { name: oidcName })}
              </button>
            )}

            {/* Sans formulaire à mot de passe, le refus du fournisseur s'affiche ici */}
            {!passwordLogin && errorMessage && <div className="account-error pz-error" role="alert">{errorMessage}</div>}

            {onOidcLogin && passwordLogin && <div className="pz-divider">{t('ou')}</div>}

            {passwordLogin && (
              <form className="pz-auth-form" onSubmit={handleAuthSubmit}>
                {isRegister && (
                  <div className="pz-field">
                    <label htmlFor="accountFirstName">{t('Prénom')}</label>
                    <input
                      id="accountFirstName"
                      type="text"
                      autoComplete="given-name"
                      placeholder="Camille"
                      value={firstName}
                      maxLength={100}
                      onChange={(event) => setFirstName(event.target.value)}
                      required
                    />
                  </div>
                )}

                <div className="pz-field">
                  <label htmlFor="accountEmail">{t('Email')}</label>
                  <input
                    id="accountEmail"
                    type="email"
                    autoComplete="email"
                    placeholder={t('camille@exemple.fr')}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>

                <div className="pz-field">
                  <label htmlFor="accountPassword">{t('Mot de passe')}</label>
                  <input
                    id="accountPassword"
                    type="password"
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={8}
                    required
                  />
                  {isRegister && <p className="pz-hint">{t('8 caractères minimum.')}</p>}
                </div>

                {errorMessage && <div className="account-error pz-error" role="alert">{errorMessage}</div>}

                <button type="submit" className="pz-btn pz-btn--primary pz-btn--block" disabled={!canSubmitAuth}>
                  <PzBusy busy={loading} busyLabel={isRegister ? t('Création du compte') : t('Connexion')}>{isRegister ? t('Créer mon compte') : t('Se connecter')}</PzBusy>
                </button>

                {isRegister && (
                  <p className="pz-small pz-auth-legal">
                    {richText(
                      t('En créant un compte, vous acceptez {slot}.'),
                      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                        {t('la façon dont Parenthèse traite vos données')}
                      </a>,
                    )}
                  </p>
                )}
              </form>
            )}

            <div className="pz-divider">{t('ou')}</div>

            <button
              type="button"
              className="pz-btn pz-btn--secondary pz-btn--block account-shared-link"
              onClick={onBackToAccess}
              disabled={loading}
            >
              <KeyRound size={16} aria-hidden="true" />
              {t("J'ai reçu un lien de famille")}
            </button>
          </div>

          {canRegister && (
            <p className="pz-auth-switch pz-small">
              {isRegister ? t('Déjà inscrit ?') : t('Pas encore de compte ?')}{' '}
              <button
                type="button"
                className="pz-link account-signup-toggle"
                onClick={() => setMode(isRegister ? 'login' : 'register')}
                disabled={loading}
              >
                {isRegister ? t('Se connecter') : t('Créer un compte')}
              </button>
            </p>
          )}

          <LanguageSwitch className="pz-lang--screen" />
        </div>
      </div>
    )
  }

  return (
    <div className="account-dashboard pz-screen">
      {closeButton}
      <div className="pz-screen-inner">
        <img src={logoUrl} alt="Parenthèse" className="pz-screen-logo" />

        <div className="pz-card pz-screen-card">
          <div className="pz-auth-head">
            <h1 className="pz-title">{richText(t('Vos *arbres*'))}</h1>
            <p className="pz-sub">{t("Ouvrez un arbre, ou commencez celui d'une autre branche de la famille.")}</p>
          </div>

          {errorMessage && <div className="account-error pz-error" role="alert">{errorMessage}</div>}

          <div className="tree-list pz-tree-list">
            {trees.length === 0 ? (
              <div className="tree-empty pz-tree-empty">
                <p className="pz-sub">{t('Aucun arbre pour le moment.')}</p>
                <p className="pz-small">{t("Commencez par le vôtre, il suffit d'un prénom.")}</p>
              </div>
            ) : (
              trees.map((tree) => {
                const isActive = activeTreeId === tree.id
                return (
                  <button
                    key={tree.id}
                    type="button"
                    className={`tree-item pz-tree-item ${isActive ? 'active' : ''}`}
                    onClick={() => onOpenTree(tree.id)}
                  >
                    <span className={`pz-tree-mono${tree.icon ? ' pz-tree-mono--emoji' : ''}`} aria-hidden="true">{tree.icon || initialOf(tree.name)}</span>
                    <span className="tree-name pz-tree-name">{tree.name}</span>
                    {isActive && <span className="pz-tag pz-tag--accent">{t('Ouvert')}</span>}
                    <ChevronRight size={18} aria-hidden="true" className="pz-tree-chevron" />
                  </button>
                )
              })
            )}
          </div>

          <button type="button" className="pz-btn pz-btn--primary pz-btn--block" onClick={onStartTreeWizard} disabled={loading}>
            <Plus size={17} aria-hidden="true" />
            {t('Créer un nouvel arbre')}
          </button>

          <div className="account-actions pz-account-actions">
            <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={onBackToAccess} disabled={loading}>
              <KeyRound size={15} aria-hidden="true" />
              {t('Accès par mot de passe partagé')}
            </button>
            {onUseDemo && (
              <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={onUseDemo} disabled={loading}>
                <Sparkles size={15} aria-hidden="true" />
                {t('Essayer la démo')}
              </button>
            )}
            {onLinkOidc && !oidcLinked && (
              <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm account-oidc-link" onClick={onLinkOidc} disabled={loading}>
                <LogIn size={15} aria-hidden="true" />
                {t('Se connecter aussi avec {name}', { name: oidcName })}
              </button>
            )}
          </div>
          {oidcLinked && oidcName && <p className="account-oidc-linked">{t('Connexion avec {name} reliée à ce compte.', { name: oidcName })}</p>}
        </div>

        <div className="pz-account-foot">
          <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={onLogout} disabled={loading}>
            <LogOut size={15} aria-hidden="true" />
            {t('Déconnexion')}
          </button>
          {onDeleteAccount && (
            <button type="button" className="pz-btn pz-btn--danger-ghost pz-btn--sm account-delete-link" onClick={openDeleteModal} disabled={loading}>
              {t('Supprimer mon compte')}
            </button>
          )}
        </div>
      </div>

      {deleteModalOpen && (
        <div className="pz-overlay" onClick={closeDeleteModal}>
          <div
            className="pz-modal account-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="accountDeleteTitle"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pz-modal-head">
              <p className="pz-eyebrow">{t('Compte')}</p>
              <h3 id="accountDeleteTitle" className="pz-title">{t('Supprimer mon compte')}</h3>
              <p className="pz-sub">{t('Cette suppression est définitive, elle ne pourra pas être annulée.')}</p>
            </div>
            <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pz-modal-close" onClick={closeDeleteModal} aria-label={t('Fermer')} disabled={deleting}>
              <X size={18} aria-hidden="true" />
            </button>
            <ul className="pz-delete-list">
              <li>{t('Votre compte et votre adresse email sont effacés.')}</li>
              <li>
                {t('Les arbres que vous avez créés sont supprimés avec toutes leurs personnes et tous leurs médias, pour toute la famille qui y avait accès.')}
              </li>
              <li>{t("Les arbres partagés avec vous restent à leurs propriétaires. Vous n'y aurez simplement plus accès.")}</li>
            </ul>
            {/* Arbres gérés avec d'autres : ils partent aussi pour leurs co-gestionnaires (issue #145) */}
            {(trees || []).filter((tree) => tree.role === 'owner' && tree.coManagers?.length > 0).map((tree) => (
              <div key={tree.id} className="ts-danger account-comanaged">
                <div className="ts-row-text">
                  <strong>{t('« {name} » sera supprimé pour tout le monde', { name: tree.name })}</strong>
                  <span className="pz-small">
                    {tree.coManagers.length > 1
                      ? t('{names} le gèrent avec vous. Ils n’y auront plus accès, la famille non plus.', { names: tree.coManagers.join(', ') })
                      : t('{name} le gère avec vous. Cette personne n’y aura plus accès, la famille non plus.', { name: tree.coManagers[0] })}
                  </span>
                </div>
              </div>
            ))}

            <form className="pz-auth-form" onSubmit={handleDeleteSubmit}>
              <div className="pz-field">
                {/* Compte né d'une connexion OIDC, sans mot de passe : il retape son adresse email */}
                <label htmlFor="accountDeletePassword">{hasPassword ? t('Mot de passe actuel') : t('Votre adresse email, pour confirmer')}</label>
                <input
                  id="accountDeletePassword"
                  type={hasPassword ? 'password' : 'email'}
                  autoComplete={hasPassword ? 'current-password' : 'off'}
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  disabled={deleting}
                  autoFocus
                  required
                />
              </div>

              {deleteError && <div className="account-error pz-error" role="alert">{deleteError}</div>}

              <div className="pz-modal-actions">
                <button type="button" className="pz-btn pz-btn--ghost" onClick={closeDeleteModal} disabled={deleting}>
                  {t('Annuler')}
                </button>
                <button type="submit" className="pz-btn pz-btn--danger" disabled={deleting || !deletePassword}>
                  <PzBusy busy={deleting} busyLabel={t('Suppression en cours')}>{t('Supprimer définitivement')}</PzBusy>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AccountDashboard
