import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PersonCard from './PersonCard.jsx'

// Onglet Infos : en modification, seuls les champs remplis s'affichent ; les vides sont des pastilles
const sparse = {
  id: 'p-sparse',
  firstName: 'Marie',
  lastName: 'Martin',
  nickname: 'Mamie Mimi',
  isAlive: false,
  birthDate: null,
  deathDate: null,
}

const render = (person, editMode) => renderToStaticMarkup(
  <PersonCard person={person} editMode={editMode} onSave={() => {}} />,
)

describe('PersonCard, onglet Infos', () => {
  it('en modification, une pastille par champ vide et le champ rempli reste affiché', () => {
    const html = render(sparse, true)
    expect(html).toContain('+ Date de naissance')
    expect(html).toContain('+ Lieu de naissance')
    expect(html).toContain('+ Nom de naissance')
    expect(html).toContain('+ Date de décès')
    expect(html).toContain('+ Lieu de décès')
    expect(html).toContain('+ Métier')
    expect(html).toContain('+ Région')
    expect(html).toContain('+ Nationalité')
    expect(html).toContain('+ Notes')
    // Le surnom est rempli : il n'a pas de pastille, il a son champ
    expect(html).not.toContain('+ Surnom')
    expect(html).toContain('Mamie Mimi')
  })

  it('une personne vivante n’a ni pastille de décès ni champ de décès', () => {
    const html = render({ ...sparse, isAlive: true, nickname: null }, true)
    expect(html).not.toContain('+ Date de décès')
    expect(html).not.toContain('+ Lieu de décès')
    expect(html).toContain('+ Surnom')
  })

  it('en lecture, pas de pastille, et le lieu de décès s’affiche quand il existe', () => {
    const html = render({ ...sparse, deathPlace: 'Nantes, France', deathDate: '1970-03-02' }, false)
    expect(html).not.toContain('pc-fill-chip')
    expect(html).toContain('Lieu de décès')
    expect(html).toContain('Nantes')
  })

  it('en lecture, le lieu de décès absent n’a pas de ligne', () => {
    const html = render(sparse, false)
    expect(html).not.toContain('Lieu de décès')
  })
})
