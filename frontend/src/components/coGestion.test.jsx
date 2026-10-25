import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PersonCard from './PersonCard.jsx'
import AdminPanel from './AdminPanel.jsx'
import TreeDropdown from './navbar/TreeDropdown.jsx'

// Co-gestion (issue #145) et « Modifier » de la fiche : ce que chaque rôle voit. Les droits eux-mêmes sont tenus
// par le serveur (backend/test/co-gestion.db.test.ts) ; ici, l'interface ne propose pas ce qui serait refusé.
const noop = () => {}
const person = { id: 'p1', firstName: 'Marie', lastName: 'Martin', isAlive: true }

describe('fiche, « Modifier » d’un clic', () => {
  it('proposé quand App le donne (administrateur, hors démo), hors mode modification', () => {
    expect(renderToStaticMarkup(<PersonCard person={person} onQuickEdit={noop} onSave={noop} />)).toContain('pc-quick-edit')
  })

  it('absent pour la famille et la démo (App ne le donne pas), et déjà en modification', () => {
    expect(renderToStaticMarkup(<PersonCard person={person} onSave={noop} />)).not.toContain('pc-quick-edit')
    expect(renderToStaticMarkup(<PersonCard person={person} onQuickEdit={noop} editMode onSave={noop} />)).not.toContain('pc-quick-edit')
  })
})

describe('co-gestionnaire dans les menus', () => {
  it('le menu des arbres nomme le rôle « Co-gestionnaire », plus « Admin »', () => {
    const html = renderToStaticMarkup(<TreeDropdown trees={[{ id: 't1', name: 'Arbre de démo', role: 'admin' }]} activeTreeId="t1" onSelect={noop} onCreate={noop} />)
    expect(html).toContain('Co-gestionnaire')
    expect(html).not.toContain('>Admin<')
  })

  it('le panneau a un onglet Gestion', () => {
    const html = renderToStaticMarkup(<AdminPanel visible treeId="t1" authToken="x" isAdmin onClose={noop} />)
    expect(html).toContain('Gestion')
  })
})
