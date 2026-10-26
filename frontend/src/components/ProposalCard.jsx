import { X } from 'lucide-react'

import { t, dateLocale } from '../i18n/index.js'
import { firstNameLabel } from '../utils/personName.js'
import PzBusy from './PzBusy'
import './ProposalCard.css'
import { initialsOf } from '../utils/initial.js'

// Proposition pas encore relue, ouverte depuis son fantôme sur l'arbre (1.5.1). Qui gère l'arbre l'accepte ou la
// refuse sur place ; la famille y lit qu'elle attend. Une proposition se relit en entier : « Voir le détail »
// ouvre le panneau des propositions pour trier changement par changement.

const FIELD_LABELS = {
  firstName: t('Prénom'),
  lastName: t('Nom'),
  birthName: t('Nom de naissance'),
  nickname: t('Surnom'),
  sex: t('Sexe'),
  birthDate: t('Naissance'),
  deathDate: t('Décès'),
  birthPlace: t('Lieu de naissance'),
  deathPlace: t('Lieu de décès'),
  profession: t('Profession'),
  region: t('Région'),
  nationality: t('Nationalité'),
  notes: t('Note'),
  isDeceased: t('Décédé(e)'),
  toVerify: t('À vérifier'),
}

function formatValue(key, value) {
  if (value === null || value === undefined || value === '') return t('vide')
  if (typeof value === 'boolean') return value ? t('oui') : t('non')
  if ((key === 'birthDate' || key === 'deathDate') && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 4)
  return String(value)
}

function whoAndWhen(ghost) {
  if (ghost?.source === 'draft') return t('Pas encore envoyé : il part avec « Envoyer »')
  if (ghost?.source === 'sent') return t('Envoyé, en attente de relecture par la personne qui gère l’arbre')
  const date = ghost?.createdAt ? new Date(ghost.createdAt) : null
  const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(dateLocale, { day: 'numeric', month: 'long' }) : ''
  if (ghost?.label && when) return t('Proposé par {name}, le {date}', { name: ghost.label, date: when })
  if (ghost?.label) return t('Proposé par {name}', { name: ghost.label })
  return t('Proposé par la famille')
}

function ReviewActions({ ghost, review }) {
  if (!review || ghost?.source !== 'pending') return null
  const { busy, error, onAccept, onReject, onOpenDetails } = review
  return (
    <div className="proposal-actions">
      {error && <p className="pz-error proposal-error" role="alert">{error}</p>}
      <div className="proposal-buttons">
        <button type="button" className="pz-btn pz-btn--primary pz-btn--sm" onClick={onAccept} disabled={busy}>
          <PzBusy busy={busy} busyLabel={t('Relecture en cours')}>{t('Accepter')}</PzBusy>
        </button>
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={onReject} disabled={busy}>{t('Refuser')}</button>
        {onOpenDetails && (
          <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm proposal-details" onClick={onOpenDetails} disabled={busy}>{t('Voir le détail')}</button>
        )}
      </div>
    </div>
  )
}

/**
 * @param {Object} props
 * @param {Object} props.person - la personne proposée (fantôme, `person.ghost` porte la provenance)
 * @param {string} props.summary - ce que contient la proposition entière (summarizeChanges)
 * @param {Object|null} props.review - { busy, error, onAccept, onReject, onOpenDetails } pour qui gère l'arbre
 */
export default function ProposalCard({ person, summary = '', review = null, onClose }) {
  const ghost = person?.ghost
  const years = [person?.birthYear, person?.deathYear].filter(Boolean).join(' – ')
  const name = [firstNameLabel(person), person?.lastName].filter(Boolean).join(' ')
  const initials = initialsOf(person)
  return (
    <div className="person-card proposal-card" role="dialog" aria-label={t('Proposition : {name}', { name })}>
      <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pc-close" onClick={onClose} aria-label={t('Fermer')}>
        <X size={18} strokeWidth={2} />
      </button>
      <header className="pc-head">
        <div className="pc-photo-wrap">
          <div className="pc-photo proposal-photo"><span className="pc-photo-initials">{initials}</span></div>
        </div>
        <div className="pc-id">
          <p className="pz-eyebrow proposal-eyebrow">{ghost?.source === 'draft' ? t('Brouillon') : ghost?.source === 'sent' ? t('En attente') : t('Proposition')}</p>
          <h2 className="pc-name">
            {person?.firstName ? person.firstName : <span className="pc-name-unknown">{firstNameLabel(person)}</span>}
            {person?.lastName && <>{' '}<em>{person.lastName}</em></>}
          </h2>
          {years && <p className="proposal-years">{years}</p>}
        </div>
      </header>
      <div className="proposal-body">
        <p className="proposal-who">{whoAndWhen(ghost)}</p>
        {summary && <p className="proposal-summary">{t('Dans cette proposition : {summary}.', { summary })}</p>}
        <ReviewActions ghost={ghost} review={review} />
      </div>
    </div>
  )
}

/**
 * Bandeau d'une fiche existante dont une modification est proposée.
 * @param {Object} props.patch - { fields, deleted, ghost }
 */
export function ProposalBanner({ patch, review = null }) {
  if (!patch) return null
  const entries = Object.entries(patch.fields || {}).filter(([key]) => FIELD_LABELS[key])
  return (
    <section className="proposal-banner" aria-label={t('Modification proposée')}>
      <p className="proposal-who">{whoAndWhen(patch.ghost)}</p>
      {patch.deleted ? (
        <p className="proposal-change">{t('Supprimer cette personne de l’arbre')}</p>
      ) : (
        <ul className="proposal-fields">
          {entries.map(([key, value]) => (
            <li key={key}><span className="proposal-field">{FIELD_LABELS[key]}</span> {formatValue(key, value)}</li>
          ))}
        </ul>
      )}
      <ReviewActions ghost={patch.ghost} review={review} />
    </section>
  )
}
