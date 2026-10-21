import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AccountDashboard from './AccountDashboard.jsx'
import { getAccountDeletionErrorMessage, getAccountErrorMessage } from '../utils/errorMessages.js'

// Connexion par un fournisseur OIDC (#115) : bouton du fournisseur, formulaire à mot de passe gardé ou retiré
const noop = () => {}
const render = (props) => renderToStaticMarkup(
  <AccountDashboard authenticated={false} trees={[]} onLogin={noop} onRegister={noop} onBackToAccess={noop} {...props} />,
).replaceAll('&#x27;', "'")

describe('écran de connexion avec un fournisseur OIDC', () => {
  it('sans fournisseur, rien ne change', () => {
    const html = render({})
    expect(html).not.toContain('Se connecter avec')
    expect(html).toContain('id="accountPassword"')
  })

  it('fournisseur et mot de passe : le bouton du fournisseur, puis le formulaire', () => {
    const html = render({ onOidcLogin: noop, oidcName: 'Authentik' })
    expect(html).toContain('Se connecter avec Authentik')
    expect(html).toContain('id="accountPassword"')
    expect(html.indexOf('Se connecter avec Authentik')).toBeLessThan(html.indexOf('id="accountEmail"'))
  })

  it('mot de passe désactivé : le bouton du fournisseur seul, ni formulaire ni création de compte', () => {
    const html = render({ onOidcLogin: noop, oidcName: 'Authentik', passwordLogin: false, canRegister: false, defaultMode: 'register' })
    expect(html).toContain('Se connecter avec Authentik')
    expect(html).not.toContain('id="accountEmail"')
    expect(html).not.toContain('id="accountPassword"')
    expect(html).not.toContain('Créer un compte')
    expect(html).toContain("J'ai reçu un lien de famille")
  })

  it('mot de passe désactivé : le refus du fournisseur reste visible', () => {
    const html = render({ onOidcLogin: noop, oidcName: 'Authentik', passwordLogin: false, errorMessage: "La connexion n'a pas abouti. Réessayez." })
    expect(html).toContain("La connexion n'a pas abouti. Réessayez.")
  })

  it('suppression d’un compte sans mot de passe : email différent, ou connexion trop ancienne', () => {
    expect(getAccountDeletionErrorMessage({ status: 403, payload: { error: 'invalid_password' } }, { confirmEmail: 'x@example.com' }))
      .toBe("Cette adresse n'est pas celle du compte.")
    expect(getAccountDeletionErrorMessage({ status: 403, payload: { error: 'recent_sign_in_required' } }, { confirmEmail: 'x@example.com' }))
      .toMatch(/reconnectez-vous/)
    expect(getAccountDeletionErrorMessage({ status: 403 }, { password: 'x' })).toBe('Mot de passe incorrect.')
  })

  it('chaque refus au retour du fournisseur a sa phrase', () => {
    for (const code of ['oidc_failed', 'oidc_unavailable', 'oidc_email_unverified', 'oidc_email_taken', 'oidc_email_missing', 'password_login_disabled', 'invalid_handoff']) {
      const message = getAccountErrorMessage({ payload: { error: code } })
      expect(message).not.toBe("Erreur backend. Vérifiez que l'API et la base sont lancées.")
    }
  })
})
