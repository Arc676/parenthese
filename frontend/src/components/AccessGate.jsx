import { Fragment, useEffect, useState } from 'react'
import logoUrl from '../assets/parenthese-logo.svg?url'
import './AccountScreens.css'
import PzBusy from './PzBusy.jsx'
import LanguageSwitch from './navbar/LanguageSwitch'
import { t } from '../i18n/index.js'
import { readContributorName, saveContributorName } from '../utils/contributorName.js'
import { initialOf } from '../utils/initial.js'

// Phrase traduite d'un bloc : les passages entre astérisques passent en <em>, {slot} reçoit un nœud.
function richText(text, slotNode = null) {
  return text.split(/(\{slot\})/).flatMap((chunk, chunkIndex) => (
    chunk === '{slot}'
      ? [<Fragment key={`s${chunkIndex}`}>{slotNode}</Fragment>]
      : chunk.split('*').map((part, index) => (index % 2 ? <em key={`${chunkIndex}-${index}`}>{part}</em> : part))
  ))
}

const AccessGate = ({
  initialTreeId,
  treeName,
  treeDescription = '',
  treeOwnerName = '',
  treeNotFound = false,
  loading,
  errorMessage,
  connected = false,
  connectedName = '',
  onSubmit,
  onUseAccount,
  canRegister = true,
  onNotMyAccount,
}) => {
  const [treeId, setTreeId] = useState(initialTreeId || '')
  const [password, setPassword] = useState('')
  // Facultatif : la personne qui partage l'arbre voit qui est passé (onglet Visites)
  const [firstName, setFirstName] = useState(() => readContributorName())

  useEffect(() => {
    setTreeId(initialTreeId || '')
  }, [initialTreeId])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!treeId || !password || loading) {
      return
    }

    saveContributorName(firstName)
    await onSubmit(treeId.trim(), password)
  }

  // Jamais d'adresse email avant le mot de passe : seul un nom explicite peut s'afficher
  const ownerLabel = treeOwnerName || ''

  return (
    <div className="access-gate pz-screen">
      <div className="pz-screen-inner">
        <img src={logoUrl} alt="Parenthèse" className="pz-screen-logo" />

        <form className="pz-card pz-screen-card" onSubmit={handleSubmit}>
          <div className="pz-auth-head">
            {treeNotFound ? (
              <h1 className="pz-title">{richText(t('Cet arbre est *introuvable*'))}</h1>
            ) : (
              <h1 className="pz-title">
                {treeName ? richText(t('Ouvrir {slot}'), <em>{treeName}</em>) : richText(t('Ouvrir un arbre *partagé*'))}
              </h1>
            )}
            <p className="pz-sub">
              {treeNotFound
                ? t("Le lien est peut-être incomplet, ou l'arbre a été supprimé. Demandez un nouveau lien à la personne qui vous l'a envoyé.")
                : treeName
                  ? t('Tapez le mot de passe reçu avec le lien. Pas besoin de compte pour regarder.')
                  : t('Entrez le code et le mot de passe reçus avec votre lien de partage.')}
            </p>
          </div>

          {!treeNotFound && (ownerLabel || treeDescription) && (
            <div className="pz-gate-owner">
              {ownerLabel && (
                <span className="pz-gate-mono" aria-hidden="true">{initialOf(ownerLabel)}</span>
              )}
              <div className="pz-gate-owner-text">
                {ownerLabel && <p className="access-gate-tree-meta pz-small">{richText(t('Partagé par {slot}'), <strong>{ownerLabel}</strong>)}</p>}
                {treeDescription && <p className="pz-small">{treeDescription}</p>}
              </div>
            </div>
          )}

          {!treeNotFound && (
            <div className="pz-auth-form">
              {connected && (
                <div className="access-gate-session" role="status">
                  {connectedName ? (
                    /^[aeiouyàâäéèêëîïôöùûüh]/i.test(connectedName)
                      ? t("Vous êtes sur le compte d'{name}", { name: connectedName })
                      : t('Vous êtes sur le compte de {name}', { name: connectedName })
                  ) : (
                    t('Vous êtes sur votre compte.')
                  )}
                  <span className="access-gate-session-step">
                    {t("Tapez une fois le mot de passe reçu avec le lien. Ensuite, l'arbre s'ouvrira directement.")}
                  </span>
                </div>
              )}

              {!initialTreeId && (
                <div className="pz-field">
                  <label htmlFor="treeId">{t("Code de l'arbre")}</label>
                  <input
                    id="treeId"
                    type="text"
                    value={treeId}
                    onChange={(event) => setTreeId(event.target.value)}
                    disabled={loading}
                    placeholder={t('Il commence souvent par cm')}
                    autoComplete="off"
                    required
                  />
                </div>
              )}

              <div className="pz-field">
                <label htmlFor="sharePassword">{t('Mot de passe reçu avec le lien')}</label>
                <input
                  id="sharePassword"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={loading}
                  autoFocus={Boolean(initialTreeId)}
                  required
                />
              </div>

              {/* Compte connecté : son prénom sert déjà, on ne le redemande pas */}
              {!connected && (
                <div className="pz-field">
                  <label htmlFor="visitorFirstName">{t('Votre prénom (facultatif)')}</label>
                  <input
                    id="visitorFirstName"
                    type="text"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    disabled={loading}
                    autoComplete="given-name"
                    maxLength={60}
                  />
                  <p className="pz-hint">{t("Il sert à savoir qui est venu voir l'arbre.")}</p>
                </div>
              )}
            </div>
          )}

          {errorMessage && <div className="access-gate-error pz-error" role="alert">{errorMessage}</div>}

          {!treeNotFound && (
            <button type="submit" className="pz-btn pz-btn--primary pz-btn--block" disabled={loading}>
              <PzBusy busy={loading} busyLabel={t("Ouverture de l'arbre")}>{t("Voir l'arbre")}</PzBusy>
            </button>
          )}

          {/* Inscription fermée : un compte existant crée encore ses arbres, un visiteur ne peut que se connecter */}
          {treeNotFound && onUseAccount && (canRegister || connected) && (
            <button type="button" className="pz-btn pz-btn--primary pz-btn--block" onClick={() => onUseAccount('register')} disabled={loading}>
              {t('Créer mon propre arbre')}
            </button>
          )}

          {treeNotFound && onUseAccount && !canRegister && !connected && (
            <button type="button" className="pz-btn pz-btn--primary pz-btn--block" onClick={() => onUseAccount('login')} disabled={loading}>
              {t('Se connecter')}
            </button>
          )}
        </form>

        {connected && onNotMyAccount && !treeNotFound && (
          <div className="pz-account-foot">
            <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={onNotMyAccount} disabled={loading}>
              {t("Ce n'est pas mon compte")}
            </button>
          </div>
        )}

        {!connected && onUseAccount && !treeNotFound && (
          <div className="pz-account-foot">
            <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={() => onUseAccount('login')} disabled={loading}>
              {t("J'ai déjà un compte")}
            </button>
            {canRegister && (
              <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={() => onUseAccount('register')} disabled={loading}>
                {t("Je n'ai pas de compte")}
              </button>
            )}
          </div>
        )}

        <LanguageSwitch className="pz-lang--screen" />
      </div>
    </div>
  )
}

export default AccessGate
