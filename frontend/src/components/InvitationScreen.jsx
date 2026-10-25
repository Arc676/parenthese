import { useEffect, useState } from 'react'
import { LogIn } from 'lucide-react'
import logoUrl from '../assets/parenthese-logo.svg?url'
import './AccountScreens.css'
import PzBusy from './PzBusy.jsx'
import { acceptInvitation, fetchInvitation } from '../api/managersApi.js'
import { getAccountErrorMessage } from '../utils/errorMessages.js'
import { t } from '../i18n/index.js'

// Page d'un lien d'invitation à co-gérer un arbre (/invitation/<jeton>, issue #145). Trois portes selon l'instance :
// le fournisseur OIDC, un compte existant, un compte à créer (même inscription fermée : l'invitation l'ouvre).
// Une fois accepté, l'arbre s'ouvre (le serveur l'a mis en dernier arbre ouvert).

const GONE = {
  invitation_used: t('Ce lien a déjà servi. Si c’était le vôtre, l’arbre est dans vos arbres.'),
  invitation_expired: t('Ce lien a expiré. Demandez-en un nouveau à la personne qui vous a invité.'),
  invitation_invalid: t('Ce lien d’invitation ne marche pas. Demandez-en un nouveau à la personne qui vous a invité.'),
}

const InvitationScreen = ({
  invitationToken,
  userToken = '',
  userEmail = '',
  loading = false,
  errorMessage = '',
  onLogin,
  onRegister,
  onOidcLogin,
  onLogout,
  onOpenApp,
}) => {
  const [preview, setPreview] = useState({ loading: true, data: null, error: '' })
  const [mode, setMode] = useState('choose')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState('')

  useEffect(() => {
    let active = true
    fetchInvitation(invitationToken)
      .then((data) => { if (active) setPreview({ loading: false, data, error: '' }) })
      .catch((error) => { if (active) setPreview({ loading: false, data: null, error: error?.payload?.error || 'invitation_invalid' }) })
    return () => { active = false }
  }, [invitationToken])

  const handleAccept = async () => {
    setAccepting(true)
    setAcceptError('')
    try {
      await acceptInvitation(invitationToken, userToken)
      onOpenApp()
    } catch (error) {
      setAcceptError(getAccountErrorMessage(error))
      setAccepting(false)
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const safeEmail = email.trim().toLowerCase()
    // Créé par l'invitation, le compte est déjà co-gestionnaire ; connecté, il reste à accepter
    if (mode === 'register') {
      if (await onRegister(firstName.trim(), safeEmail, password, invitationToken)) onOpenApp()
    } else {
      await onLogin(safeEmail, password)
    }
  }

  const invitation = preview.data
  let body
  if (preview.loading) {
    body = <p className="pz-small ts-loading">{t('Chargement…')}</p>
  } else if (!invitation) {
    body = (
      <>
        <div className="pz-auth-head">
          <h1 className="pz-title">{t('Invitation')}</h1>
          <p className="pz-sub">{GONE[preview.error] || GONE.invitation_invalid}</p>
        </div>
        <button type="button" className="pz-btn pz-btn--primary pz-btn--block" onClick={onOpenApp}>{t('Ouvrir Parenthèse')}</button>
      </>
    )
  } else {
    const head = (
      <div className="pz-auth-head">
        {invitation.treeIcon && <span className="invite-tree-icon" aria-hidden="true">{invitation.treeIcon}</span>}
        <h1 className="pz-title">{t('Gérer « {name} »', { name: invitation.treeName })}</h1>
        <p className="pz-sub">
          {invitation.invitedBy
            ? t('{name} vous invite à modifier cet arbre avec votre propre compte. L’invitation est pour {email}.', { name: invitation.invitedBy, email: invitation.emailHint })
            : t('Vous êtes invité à modifier cet arbre avec votre propre compte. L’invitation est pour {email}.', { email: invitation.emailHint })}
        </p>
      </div>
    )
    if (userToken) {
      body = (
        <>
          {head}
          <p className="pz-small">{t('Vous êtes connecté avec {email}.', { email: userEmail })}</p>
          {acceptError && <div className="account-error pz-error" role="alert">{acceptError}</div>}
          <button type="button" className="pz-btn pz-btn--primary pz-btn--block" onClick={handleAccept} disabled={accepting}>
            <PzBusy busy={accepting} busyLabel={t('Ouverture de l’arbre')}>{t('Accepter et ouvrir l’arbre')}</PzBusy>
          </button>
          <button type="button" className="pz-btn pz-btn--ghost pz-btn--block" onClick={onLogout} disabled={accepting}>{t('Changer de compte')}</button>
        </>
      )
    } else if (mode === 'choose') {
      body = (
        <>
          {head}
          <div className="invite-doors">
            {invitation.oidc && onOidcLogin && (
              <button type="button" className="pz-btn pz-btn--primary pz-btn--block" onClick={onOidcLogin}>
                <LogIn size={16} aria-hidden="true" />
                {t('Se connecter avec {name}', { name: invitation.oidc.name })}
              </button>
            )}
            {invitation.oidc && invitation.passwordLogin && <div className="pz-divider">{t('ou')}</div>}
            {invitation.passwordLogin && (
              <>
                <button type="button" className={`pz-btn pz-btn--block ${invitation.oidc ? 'pz-btn--secondary' : 'pz-btn--primary'}`} onClick={() => setMode('login')}>{t('J’ai déjà un compte Parenthèse')}</button>
                <button type="button" className="pz-btn pz-btn--ghost pz-btn--block" onClick={() => setMode('register')}>{t('Créer mon compte')}</button>
              </>
            )}
          </div>
          <p className="pz-hint">{t('Le lien sert une fois et vaut 14 jours.')}</p>
        </>
      )
    } else {
      const isRegister = mode === 'register'
      body = (
        <>
          {head}
          <form className="pz-auth-form" onSubmit={handleSubmit}>
            {isRegister && (
              <div className="pz-field">
                <label htmlFor="inviteFirstName">{t('Prénom')}</label>
                <input id="inviteFirstName" type="text" autoComplete="given-name" value={firstName} maxLength={100} onChange={(event) => setFirstName(event.target.value)} required />
              </div>
            )}
            <div className="pz-field">
              <label htmlFor="inviteEmail">{t('Email')}</label>
              <input id="inviteEmail" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              <p className="pz-hint">{t('L’adresse à laquelle vous avez été invité.')}</p>
            </div>
            <div className="pz-field">
              <label htmlFor="invitePassword">{t('Mot de passe')}</label>
              <input id="invitePassword" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
              {isRegister && <p className="pz-hint">{t('8 caractères minimum.')}</p>}
            </div>
            {errorMessage && <div className="account-error pz-error" role="alert">{errorMessage}</div>}
            <button type="submit" className="pz-btn pz-btn--primary pz-btn--block" disabled={loading || !email.trim() || password.length < 8}>
              <PzBusy busy={loading} busyLabel={isRegister ? t('Création du compte') : t('Connexion')}>
                {isRegister ? t('Créer mon compte et ouvrir l’arbre') : t('Se connecter')}
              </PzBusy>
            </button>
            <button type="button" className="pz-btn pz-btn--ghost pz-btn--block" onClick={() => setMode('choose')} disabled={loading}>{t('Retour')}</button>
          </form>
        </>
      )
    }
  }

  return (
    <div className="pz-screen invitation-screen">
      <div className="pz-screen-inner">
        <img src={logoUrl} alt="Parenthèse" className="pz-screen-logo" />
        <div className="pz-card pz-screen-card pz-auth">{body}</div>
      </div>
    </div>
  )
}

export default InvitationScreen
