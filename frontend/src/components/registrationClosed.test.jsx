import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AccessGate from './AccessGate.jsx'
import AccountDashboard from './AccountDashboard.jsx'
import EntryChoice from './EntryChoice.jsx'
import AvatarMenu from './navbar/AvatarMenu.jsx'
import { getAccountErrorMessage } from '../utils/errorMessages.js'

// Inscription fermée sur l'instance (ALLOW_REGISTRATION=false, #113) : aucun écran ne propose de créer un compte,
// la connexion reste partout où elle était.
const noop = () => {}
// React échappe l'apostrophe en &#x27;
const renderToStaticMarkupText = (element) => renderToStaticMarkup(element).replaceAll('&#x27;', "'")

describe('inscription fermée, écrans sans session', () => {
  it("l'accueil garde le lien de famille et la connexion, sans « Créer mon arbre »", () => {
    const open = renderToStaticMarkupText(<EntryChoice onFamilyLink={noop} onLogin={noop} onRegister={noop} />)
    const closed = renderToStaticMarkupText(<EntryChoice onFamilyLink={noop} onLogin={noop} />)
    expect(open).toContain('Créer mon arbre')
    expect(closed).not.toContain('Créer mon arbre')
    expect(closed).toContain('Se connecter')
    expect(closed).toContain("J'ai reçu un lien de famille")
  })

  it("l'écran de connexion n'a plus de bascule vers la création, même ouvert en mode création", () => {
    const props = { authenticated: false, trees: [], onLogin: noop, onRegister: noop, onBackToAccess: noop }
    const open = renderToStaticMarkupText(<AccountDashboard {...props} defaultMode="register" />)
    const closed = renderToStaticMarkupText(<AccountDashboard {...props} defaultMode="register" canRegister={false} />)
    expect(open).toContain('Créer mon compte')
    expect(closed).not.toContain('Créer mon compte')
    expect(closed).not.toContain('Créer un compte')
    expect(closed).toContain('Se connecter')
  })

  it("la porte d'un arbre partagé ne propose plus « Je n'ai pas de compte »", () => {
    const props = { initialTreeId: 'tree-1', treeName: 'Famille Test', onSubmit: noop, onUseAccount: noop }
    const open = renderToStaticMarkupText(<AccessGate {...props} />)
    const closed = renderToStaticMarkupText(<AccessGate {...props} canRegister={false} />)
    expect(open).toContain("Je n'ai pas de compte")
    expect(closed).not.toContain("Je n'ai pas de compte")
    expect(closed).toContain("J'ai déjà un compte")
  })

  it('lien mort : un visiteur se connecte, un compte connecté crée encore son arbre', () => {
    const props = { treeNotFound: true, onSubmit: noop, onUseAccount: noop, canRegister: false }
    const visitor = renderToStaticMarkupText(<AccessGate {...props} />)
    const member = renderToStaticMarkupText(<AccessGate {...props} connected />)
    expect(visitor).not.toContain('Créer mon propre arbre')
    expect(visitor).toContain('Se connecter')
    expect(member).toContain('Créer mon propre arbre')
  })

  it("le menu d'un visiteur sur un arbre garde « Se connecter » seul", () => {
    const closed = renderToStaticMarkupText(<AvatarMenu guest onClose={noop} onLogin={noop} />)
    const open = renderToStaticMarkupText(<AvatarMenu guest onClose={noop} onLogin={noop} onRegister={noop} />)
    expect(open).toContain('Créer mon arbre')
    expect(closed).not.toContain('Créer mon arbre')
    expect(closed).toContain('Se connecter')
  })

  it("le refus du serveur s'explique", () => {
    expect(getAccountErrorMessage({ status: 403, payload: { error: 'registration_closed' } }))
      .toBe("Cette instance n'accepte plus de nouveaux comptes. Demandez à la personne qui l'héberge.")
  })
})
