import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PersonCard from './PersonCard.jsx'
import ProposalCard, { ProposalBanner } from './ProposalCard.jsx'
import { findLikelyDuplicates } from '../utils/duplicates.js'
import { summarizeChanges } from '../utils/proposalSummary.js'

// 1.5.1 : propositions sur l'arbre (fantômes) et ajout d'un proche depuis la fiche. Les droits de relecture sont
// tenus par le serveur (backend/test/propositions-fantomes.db.test.ts) ; ici, ce que chacun voit.
const noop = () => {}
const ghostPerson = (source) => ({ id: 'ghost:s1:tmp:a', firstName: 'Lucie', lastName: 'Martin', birthYear: 1990, ghost: { source, sessionId: 's1', label: 'Cousine', createdAt: '2026-10-25T10:00:00Z' } })
const review = { busy: false, error: '', onAccept: noop, onReject: noop, onOpenDetails: noop }

describe('carte d’une proposition', () => {
  it('qui gère l’arbre peut accepter, refuser ou voir le détail', () => {
    const html = renderToStaticMarkup(<ProposalCard person={ghostPerson('pending')} summary="1 personne, 1 lien" review={review} onClose={noop} />)
    expect(html).toContain('Proposé par Cousine')
    expect(html).toContain('Accepter')
    expect(html).toContain('Refuser')
    // t() pose une espace fine insécable devant les deux-points
    expect(html).toMatch(/Dans cette proposition\s:\s1 personne, 1 lien\./)
  })

  it('la famille lit seulement qu’elle attend, sans bouton de relecture', () => {
    const html = renderToStaticMarkup(<ProposalCard person={ghostPerson('sent')} review={review} onClose={noop} />)
    expect(html).toContain('en attente de relecture')
    expect(html).not.toContain('Accepter')
    expect(renderToStaticMarkup(<ProposalCard person={ghostPerson('draft')} onClose={noop} />)).toContain('Pas encore envoyé')
  })

  it('le bandeau d’une fiche existante liste les champs proposés', () => {
    const html = renderToStaticMarkup(<ProposalBanner patch={{ fields: { birthPlace: 'Lille', deathDate: '1950-01-01' }, ghost: { source: 'pending', label: 'Cousine' } }} review={review} />)
    expect(html).toContain('Lieu de naissance')
    expect(html).toContain('Lille')
    expect(html).toContain('1950')
    expect(html).toContain('Accepter')
  })

  it('le résumé compte ce que contient la proposition', () => {
    expect(summarizeChanges([
      { entityType: 'person', action: 'create' },
      { entityType: 'parent_child_link', action: 'create' },
      { entityType: 'union', action: 'create' },
      { entityType: 'annotation', action: 'create' },
    ])).toBe("1 personne, 2 liens, 1 ajout sur l'arbre")
  })
})

describe('ajouter un proche depuis la fiche', () => {
  const person = { id: 'p1', firstName: 'Marie', lastName: 'Martin', isAlive: true }
  it('la fiche en lecture propose parent, conjoint·e et enfant quand App le permet ; sinon rien', () => {
    const html = renderToStaticMarkup(<PersonCard person={person} onSave={noop} onCreateRelative={noop} />)
    expect(html).toContain('pc-quick-add')
    expect(html).toContain('Conjoint·e')
    // Sans parent connu, pas de frère ou sœur à rattacher
    expect(html).not.toContain('Frère ou sœur')
    expect(renderToStaticMarkup(<PersonCard person={person} onSave={noop} />)).not.toContain('pc-quick-add')
  })

  it('le doublon probable ignore accents, casse et espaces, et regarde aussi le nom de naissance', () => {
    const persons = [
      { id: 'a', firstName: 'Hélène', lastName: 'Dupont' },
      { id: 'b', firstName: 'Helene', lastName: 'Martin', birthName: 'Dupont' },
      { id: 'c', firstName: 'Hélène', lastName: 'Durand' },
      { id: 'g', firstName: 'Hélène', lastName: 'Dupont', ghost: { source: 'pending' } },
    ]
    expect(findLikelyDuplicates(persons, ' helene ', 'DUPONT').map((p) => p.id)).toEqual(['a', 'b'])
    expect(findLikelyDuplicates(persons, 'Hélène', '')).toEqual([])
  })
})
