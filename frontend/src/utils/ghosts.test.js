import { describe, expect, it } from 'vitest'

import { ghostsFromChanges, hasGhosts, isGhostId, mergeGhosts, withGhosts } from './ghosts'

const base = {
  persons: [{ id: 'jean' }, { id: 'marie' }, { id: 'paul' }],
  unions: [{ id: 'u1', partner1Id: 'jean', partner2Id: 'marie' }],
  filiations: [{ id: 'f1', childId: 'paul', unionId: 'u1', parentId: null }],
}

describe('fantômes des propositions', () => {
  it("un enfant proposé à Jean se rattache au couple Jean et Marie, pas à un parent inconnu", () => {
    const g = ghostsFromChanges([
      { id: 'c1', entityType: 'person', action: 'create', afterJson: { ref: 'tmp:a', firstName: 'Lucie', lastName: 'Martin', birthDate: '1990-03-01' } },
      { id: 'c2', entityType: 'parent_child_link', action: 'create', afterJson: { parentPersonId: 'jean', childPersonId: 'tmp:a' } },
    ], { source: 'pending', sessionId: 's1', label: 'Cousine' }, base)
    expect(g.persons).toHaveLength(1)
    expect(g.persons[0]).toMatchObject({ firstName: 'Lucie', birthYear: 1990, ghost: { source: 'pending', sessionId: 's1' } })
    expect(g.filiations[0]).toMatchObject({ childId: g.persons[0].id, unionId: 'u1', parentId: null })
    expect(isGhostId(g.persons[0].id)).toBe(true)
  })

  it('les changements sur une personne existante deviennent une marque, pas un double', () => {
    const g = ghostsFromChanges([
      { entityType: 'person', action: 'update', entityId: 'paul', after: { birthPlace: 'Lille' } },
      { entityType: 'person', action: 'update', entityId: 'paul', after: { profession: 'Facteur' } },
    ], { source: 'sent', key: 'k' }, base)
    expect(g.persons).toHaveLength(0)
    expect(g.patches.get('paul').fields).toEqual({ birthPlace: 'Lille', profession: 'Facteur' })
  })

  it("le brouillon ne double pas ses annotations, déjà dessinées ; une proposition envoyée oui", () => {
    const change = { entityType: 'annotation', action: 'create', after: { type: 'text', x: 1, y: 2, content: 'Mamie' } }
    expect(ghostsFromChanges([change], { source: 'draft' }).annotations).toHaveLength(0)
    expect(ghostsFromChanges([change], { source: 'sent', key: 's' }).annotations).toHaveLength(1)
  })

  it("dans un onglet, seuls les fantômes reliés de proche en proche à une personne de l'onglet entrent", () => {
    const g = ghostsFromChanges([
      { entityType: 'person', action: 'create', after: { ref: 'tmp:a', firstName: 'Enfant' } },
      { entityType: 'person', action: 'create', after: { ref: 'tmp:b', firstName: 'Petit-enfant' } },
      { entityType: 'person', action: 'create', after: { ref: 'tmp:c', firstName: 'Ailleurs' } },
      { entityType: 'parent_child_link', action: 'create', after: { parentPersonId: 'paul', childPersonId: 'tmp:a' } },
      { entityType: 'parent_child_link', action: 'create', after: { parentPersonId: 'tmp:a', childPersonId: 'tmp:b' } },
      { entityType: 'parent_child_link', action: 'create', after: { parentPersonId: 'inconnu-hors-onglet', childPersonId: 'tmp:c' } },
    ], { source: 'pending', sessionId: 's2' }, base)
    const tab = withGhosts(base, g)
    expect(tab.persons.map((p) => p.firstName).filter(Boolean)).toEqual(['Enfant', 'Petit-enfant'])
    expect(tab.filiations).toHaveLength(3)
    expect(withGhosts(base, g, true).persons).toHaveLength(6)
  })

  it("deux propositions qui utilisent la même référence provisoire ne se mélangent pas", () => {
    const one = ghostsFromChanges([{ entityType: 'person', action: 'create', after: { ref: 'tmp:x', firstName: 'A' } }], { source: 'pending', sessionId: 's1' })
    const two = ghostsFromChanges([{ entityType: 'person', action: 'create', after: { ref: 'tmp:x', firstName: 'B' } }], { source: 'pending', sessionId: 's2' })
    const merged = mergeGhosts([one, two])
    expect(new Set(merged.persons.map((p) => p.id)).size).toBe(2)
    expect(hasGhosts(merged)).toBe(true)
    expect(withGhosts(base, mergeGhosts([]))).toBe(base)
  })
})
