import { useEffect, useState } from 'react'
import { inviteManager, invitationUrl, listManagers, removeManager, renewInvitationLink, revokeInvitation } from '../api/managersApi.js'
import PzBusy from './PzBusy.jsx'
import { dateLocale, t } from '../i18n/index.js'
import { initialOf } from '../utils/initial.js'
import Skeleton from './Skeleton.jsx'

// Onglet Gestion des paramètres de l'arbre (issue #145). Le propriétaire invite des co-gestionnaires par leur
// adresse : Parenthèse n'envoie pas de mail, il donne un lien à transmettre. Les co-gestionnaires voient la liste.

const ERRORS = {
  already_manager: t('Cette adresse gère déjà cet arbre.'),
  invalid_email: t('Cette adresse email ne semble pas valide.'),
  too_many_invitations: t('Trop d’invitations en attente. Annulez-en une avant d’en envoyer une autre.'),
}

function personInitial(person) {
  return initialOf(person.firstName || person.email)
}

const TreeManagersSection = ({ treeId, authToken, currentUserId = null, oidcName = '', onOpenShare }) => {
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState({ error: '', success: '' })
  // Lien tout juste créé, montré en clair si le presse-papiers est refusé
  const [link, setLink] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  // Co-gestionnaire tout juste retiré : il a pu lire le mot de passe de partage, on propose de le changer
  const [removedName, setRemovedName] = useState('')

  const load = () => listManagers(treeId, authToken)
    .then((data) => setState({ loading: false, error: '', data }))
    .catch(() => setState({ loading: false, error: t('Impossible de charger les gestionnaires.'), data: null }))

  useEffect(() => {
    setState({ loading: true, error: '', data: null })
    load()
  }, [treeId, authToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const offerLink = async (token, forEmail) => {
    const url = invitationUrl(token)
    let copied
    try { await navigator.clipboard.writeText(url); copied = true } catch { copied = false }
    setLink({ url, email: forEmail, copied })
  }

  const handleInvite = async (event) => {
    event.preventDefault()
    if (!email.trim() || busy) return
    setBusy('invite')
    setMessage({ error: '', success: '' })
    try {
      const { token, invitation } = await inviteManager(treeId, email.trim(), authToken)
      setEmail('')
      await offerLink(token, invitation.email)
      await load()
    } catch (error) {
      setMessage({ error: ERRORS[error?.payload?.error] || t('Impossible d’envoyer l’invitation.'), success: '' })
    } finally {
      setBusy('')
    }
  }

  const handleCopy = async (invitation) => {
    setBusy(`link-${invitation.id}`)
    setMessage({ error: '', success: '' })
    try {
      const { token } = await renewInvitationLink(treeId, invitation.id, authToken)
      await offerLink(token, invitation.email)
    } catch {
      setMessage({ error: t('Impossible de créer le lien.'), success: '' })
    } finally {
      setBusy('')
    }
  }

  const handleRevoke = async (invitation) => {
    setBusy(`revoke-${invitation.id}`)
    try {
      await revokeInvitation(treeId, invitation.id, authToken)
      if (link?.email === invitation.email) setLink(null)
      await load()
    } catch {
      setMessage({ error: t('Impossible d’annuler l’invitation.'), success: '' })
    } finally {
      setBusy('')
    }
  }

  const handleRemove = async (manager) => {
    setBusy(`remove-${manager.userId}`)
    try {
      await removeManager(treeId, manager.userId, authToken)
      setConfirmRemove(null)
      setMessage({ error: '', success: '' })
      setRemovedName(manager.firstName || manager.email)
      await load()
    } catch {
      setMessage({ error: t('Impossible de retirer ce co-gestionnaire.'), success: '' })
    } finally {
      setBusy('')
    }
  }

  if (state.loading) return <Skeleton variant="rows" count={2} />
  if (state.error) return <div className="pz-error" role="alert">{state.error}</div>

  const { canManage, managers, invitations } = state.data
  return (
    <div className="ts-panel">
      <p className="pz-small">{t('Les co-gestionnaires modifient l’arbre directement et valident les propositions de la famille, comme vous. Seul le propriétaire invite, retire un co-gestionnaire ou supprime l’arbre.')}</p>

      {managers.map((manager) => {
        const isYou = manager.userId === currentUserId
        return (
          <div key={manager.userId} className="ts-row tm-row">
            <div className="tm-who">
              <span className="tm-avatar" aria-hidden="true">{personInitial(manager)}</span>
              <div className="ts-row-text">
                <strong>{isYou ? t('Vous') : (manager.firstName || manager.email)}</strong>
                <span className="tm-mail">{manager.email}</span>
              </div>
            </div>
            <div className="ts-row-actions">
              <span className="pz-tag">{manager.role === 'owner' ? t('Propriétaire') : t('Co-gestionnaire')}</span>
              {canManage && manager.role === 'admin' && (confirmRemove === manager.userId ? (
                <>
                  <button type="button" className="contrib-confirm-no" onClick={() => setConfirmRemove(null)}>{t('Garder')}</button>
                  <button type="button" className="contrib-confirm-yes" onClick={() => handleRemove(manager)} disabled={Boolean(busy)}>
                    <PzBusy busy={busy === `remove-${manager.userId}`} busyLabel={t('Retrait en cours')}>{t('Retirer')}</PzBusy>
                  </button>
                </>
              ) : (
                <button type="button" className="contrib-pill-btn contrib-pill-btn--ghost" onClick={() => setConfirmRemove(manager.userId)}>{t('Retirer')}</button>
              ))}
            </div>
          </div>
        )
      })}

      {invitations.map((invitation) => (
        <div key={invitation.id} className="ts-row tm-row">
          <div className="tm-who">
            <span className="tm-avatar tm-avatar--pending" aria-hidden="true">{personInitial(invitation)}</span>
            <div className="ts-row-text">
              <strong>{invitation.email}</strong>
              <span className="tm-mail">{t('Invité le {date}, en attente', { date: new Date(invitation.createdAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' }) })}</span>
            </div>
          </div>
          {canManage && (
            <div className="ts-row-actions">
              <button type="button" className="contrib-pill-btn contrib-pill-btn--ghost" onClick={() => handleCopy(invitation)} disabled={Boolean(busy)}>
                <PzBusy busy={busy === `link-${invitation.id}`} busyLabel={t('Création du lien')}>{t('Copier le lien')}</PzBusy>
              </button>
              <button type="button" className="contrib-pill-btn contrib-pill-btn--ghost" onClick={() => handleRevoke(invitation)} disabled={Boolean(busy)}>
                <PzBusy busy={busy === `revoke-${invitation.id}`} busyLabel={t('Annulation en cours')}>{t('Annuler')}</PzBusy>
              </button>
            </div>
          )}
        </div>
      ))}

      {link && (
        <div className="contrib-invite" role="status">
          <div className="contrib-invite-top">
            <span className="contrib-invite-title">{t('Lien pour {email}', { email: link.email })}</span>
            {link.copied && <span className="contrib-copy-feedback">{t('Lien copié')}</span>}
          </div>
          <div className="contrib-invite-link">
            <input className="contrib-link-url" value={link.url} readOnly aria-label={t('Lien d’invitation')} onFocus={(event) => event.target.select()} />
          </div>
          <p className="contrib-pass-hint">{t('Envoyez-le par message ou par mail. Il sert une fois et vaut 14 jours. « Copier le lien » en crée un nouveau, l’ancien ne marche plus.')}</p>
        </div>
      )}

      {removedName && (
        <div className="contrib-invite" role="status">
          <span className="contrib-invite-title">{t('{name} ne gère plus cet arbre.', { name: removedName })}</span>
          <p className="contrib-pass-hint">{t('Cette personne a pu voir le mot de passe de partage : avec lui, elle peut encore ouvrir l’arbre en lecture. Pour lui couper aussi la lecture, changez-le, puis donnez le nouveau à la famille.')}</p>
          {onOpenShare && (
            <button type="button" className="contrib-pill-btn contrib-pill-btn--save tm-share-btn" onClick={onOpenShare}>{t('Changer le mot de passe de partage')}</button>
          )}
        </div>
      )}

      {message.error && <div className="pz-error" role="alert">{message.error}</div>}
      {message.success && <div className="pz-success" role="status">{message.success}</div>}

      {canManage && (
        <form onSubmit={handleInvite}>
          <fieldset className="ts-policy">
          <legend className="pz-eyebrow">{t('Inviter un co-gestionnaire')}</legend>
          <div className="pz-field">
            <label htmlFor="managerInviteEmail">{t('Son adresse email')}</label>
            <div className="tm-invite">
              <input
                id="managerInviteEmail"
                className="pz-input"
                type="email"
                autoComplete="off"
                placeholder={t('prenom@exemple.fr')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button type="submit" className="pz-btn pz-btn--primary" disabled={!email.trim() || Boolean(busy)}>
                <PzBusy busy={busy === 'invite'} busyLabel={t('Invitation en cours')}>{t('Inviter')}</PzBusy>
              </button>
            </div>
          </div>
          <p className="pz-hint">
            {oidcName
              ? t('Parenthèse n’envoie pas de mail : vous recevez un lien à lui transmettre. S’il se connecte avec {name} et cette adresse, il est ajouté sans le lien.', { name: oidcName })
              : t('Parenthèse n’envoie pas de mail : vous recevez un lien à lui transmettre.')}
          </p>
          </fieldset>
        </form>
      )}
    </div>
  )
}

export default TreeManagersSection
