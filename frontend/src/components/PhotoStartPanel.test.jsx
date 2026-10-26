import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PhotoStartPanel from './PhotoStartPanel.jsx'

// Les visages à compléter, sans aperçu : chaque portrait vide montre les initiales de la personne
describe('PhotoStartPanel, visages sans photo', () => {
  it('affiche les initiales, une seule pour un nom chinois', () => {
    const html = renderToStaticMarkup(
      <PhotoStartPanel
        visible
        personsImported={2}
        faces={[
          { id: 'a', firstName: 'Jeanne', lastName: 'Duval', birthYear: 1950 },
          { id: 'b', firstName: '小明', lastName: '王', birthYear: 1978 },
        ]}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('>JD</span>')
    expect(html).toContain('>王</span>')
  })
})
