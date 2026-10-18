import { useState, useEffect, useRef } from 'react'
import DateField from './DateField.jsx'
import { UserPlus, X, Search, ChevronDown } from 'lucide-react'
import './AddPersonPanel.css'
import PzBusy from './PzBusy.jsx'
import { t } from '../i18n/index.js'

// Titre traduit d'un bloc : le passage entre <em> et </em> garde son italique
function withEmphasis(text) {
  const [before, emphasized = '', after = ''] = text.split(/<\/?em>/)
  return <>{before}<em>{emphasized}</em>{after}</>
}

/**
 * Panneau slide-in gauche pour ajouter une personne
 * Visible uniquement en mode édition
 *
 * Features:
 * - Slide-in depuis la gauche (400px desktop, 90% mobile)
 * - Focus auto sur Prénom à l'ouverture
 * - Validation temps-réel (required)
 * - Section Relations avec dropdown searchable
 * - Reste ouvert après ajout réussi (reset form)
 *
 * @param {Object} props
 * @param {boolean} props.visible - Afficher le panneau
 * @param {Array} props.persons - Liste des personnes existantes pour les relations
 * @param {boolean} props.loading - Soumission en cours
 * @param {string} props.error - Message d'erreur
 * @param {Function} props.onSubmit - Handler soumission (formData)
 * @param {Function} props.onClose - Handler fermeture
 */
function AddPersonPanel({ visible, persons = [], loading = false, error = '', onSubmit, onClose }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [birthName, setBirthName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [deathDate, setDeathDate] = useState('')
  // Décédé(e) sans date connue (issue #77)
  const [isDeceased, setIsDeceased] = useState(false)
  // Les champs de date gardent leur texte : on les recrée après chaque ajout
  const [dateFieldsKey, setDateFieldsKey] = useState(0)
  const [relations, setRelations] = useState([])
  const [relationSearch, setRelationSearch] = useState('')
  const [relationDropdownOpen, setRelationDropdownOpen] = useState(false)
  const [selectedRelationType, setSelectedRelationType] = useState('parent')
  const [touched, setTouched] = useState({})
  const [justAdded, setJustAdded] = useState(false)

  const firstNameRef = useRef(null)
  const panelRef = useRef(null)

  // Focus sur Prénom à l'ouverture
  useEffect(() => {
    if (visible) {
      setTimeout(() => firstNameRef.current?.focus(), 300)
    }
  }, [visible])

  // ESC pour fermer
  useEffect(() => {
    if (!visible) return

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [visible, onClose])

  // Fermer dropdown relation au clic extérieur
  useEffect(() => {
    if (!relationDropdownOpen) return

    function handleClick(e) {
      if (!e.target.closest('.relation-dropdown-wrapper')) {
        setRelationDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [relationDropdownOpen])

  // Reset form après ajout réussi
  useEffect(() => {
    if (justAdded && !loading && !error) {
      setFirstName('')
      setLastName('')
      setBirthName('')
      setBirthDate('')
      setDeathDate('')
      setIsDeceased(false)
      setDateFieldsKey((k) => k + 1)
      setRelations([])
      setTouched({})
      setJustAdded(false)
      firstNameRef.current?.focus()
    }
  }, [justAdded, loading, error])

  const filteredPersons = persons.filter((p) => {
    if (!relationSearch) return true
    const fullName = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase()
    return fullName.includes(relationSearch.toLowerCase())
  })

  const handleAddRelation = (person) => {
    // Éviter les doublons
    if (relations.some((r) => r.personId === person.id)) return

    setRelations((prev) => [
      ...prev,
      { personId: person.id, personName: `${person.firstName} ${person.lastName || ''}`.trim(), type: selectedRelationType },
    ])
    setRelationSearch('')
    setRelationDropdownOpen(false)
  }

  const handleRemoveRelation = (personId) => {
    setRelations((prev) => prev.filter((r) => r.personId !== personId))
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    if (!firstName.trim()) {
      setTouched({ firstName: true })
      firstNameRef.current?.focus()
      return
    }

    setJustAdded(true)

    onSubmit({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthName: birthName.trim() || null,
      birthDate: birthDate || null,
      deathDate: deathDate || null,
      isDeceased: !deathDate && isDeceased,
      relations,
    })
  }

  const relationTypeLabels = {
    parent: t('Parent de'),
    child: t('Enfant de'),
    spouse: t('Conjoint·e de'),
    sibling: t('Frère·Sœur de'),
  }
  const relationTypeTabs = {
    parent: t('Parent'),
    child: t('Enfant'),
    spouse: t('Conjoint·e'),
    sibling: t('Frère·Sœur'),
  }

  return (
    <div
      className={`add-person-panel ${visible ? 'add-person-panel--open' : ''}`}
      ref={panelRef}
      role="dialog"
      aria-labelledby="addPersonTitle"
      aria-hidden={!visible}
    >
      <div className="apn-head">
        <div className="pz-modal-head">
          <p className="pz-eyebrow">{t('Nouvelle fiche')}</p>
          <h2 id="addPersonTitle" className="pz-title">{withEmphasis(t("Ajouter <em>quelqu'un</em>"))}</h2>
        </div>
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon apn-close" onClick={onClose} aria-label={t('Fermer')}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      <form className="apn-form" onSubmit={handleSubmit}>
        <div className="apn-scroll">
          <div className="pz-row2 apn-row">
            <div className="pz-field">
              <label htmlFor="ap-firstName">{t('Prénom')}</label>
              <input
                ref={firstNameRef}
                id="ap-firstName"
                type="text"
                className={touched.firstName && !firstName.trim() ? 'apn-input--error' : ''}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={t('Marie')}
                autoComplete="off"
                aria-invalid={touched.firstName && !firstName.trim()}
              />
            </div>
            <div className="pz-field">
              <label htmlFor="ap-lastName">{t('Nom')}</label>
              <input
                id="ap-lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={t('Dupont')}
                autoComplete="off"
              />
            </div>
          </div>
          {touched.firstName && !firstName.trim() && (
            <p className="apn-error-text">{t('Il faut au moins un prénom.')}</p>
          )}

          <div className="pz-field">
            <label htmlFor="ap-birthName">{t('Nom de naissance')} <span className="apn-optional">{t('si différent')}</span></label>
            <input
              id="ap-birthName"
              type="text"
              value={birthName}
              onChange={(e) => setBirthName(e.target.value)}
              placeholder={t('Martin')}
              autoComplete="off"
            />
          </div>

          <div className="pz-row2 apn-row">
            <div className="pz-field">
              <label htmlFor="ap-birthDate">{t('Naissance')}</label>
              <DateField key={`b-${dateFieldsKey}`} id="ap-birthDate" value={birthDate} onChange={setBirthDate} />
            </div>
            <div className="pz-field">
              <label htmlFor="ap-deathDate">{t('Décès')}</label>
              <DateField key={`d-${dateFieldsKey}`} id="ap-deathDate" value={deathDate} onChange={setDeathDate} />
              {!deathDate && (
                <label className="apn-deceased">
                  <input type="checkbox" checked={isDeceased} onChange={(e) => setIsDeceased(e.target.checked)} />
                  {t('Décédé(e), date inconnue')}
                </label>
              )}
            </div>
          </div>

          <section className="apn-section">
            <h3 className="pz-eyebrow">{t('Place dans la famille')}</h3>

            <div className="pz-tabs apn-types" role="radiogroup" aria-label={t('Type de lien')}>
              {Object.entries(relationTypeTabs).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={selectedRelationType === type}
                  className={`pz-tab ${selectedRelationType === type ? 'is-active' : ''}`}
                  onClick={() => setSelectedRelationType(type)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="pz-field relation-dropdown-wrapper apn-relation">
              <label htmlFor="ap-relationSearch">{relationTypeLabels[selectedRelationType]}</label>
              <div className="apn-search">
                <Search size={15} strokeWidth={2} className="apn-search-icon" />
                <input
                  id="ap-relationSearch"
                  type="text"
                  value={relationSearch}
                  onChange={(e) => {
                    setRelationSearch(e.target.value)
                    setRelationDropdownOpen(true)
                  }}
                  onFocus={() => setRelationDropdownOpen(true)}
                  placeholder={t("Chercher dans l'arbre")}
                  autoComplete="off"
                />
                <ChevronDown size={15} strokeWidth={2} className="apn-search-chevron" />
              </div>

              {relationDropdownOpen && filteredPersons.length > 0 && (
                <ul className="apn-dropdown">
                  {filteredPersons.slice(0, 8).map((p) => (
                    <li key={p.id}>
                      <button type="button" className="apn-dropdown-item" onClick={() => handleAddRelation(p)}>
                        <span className="apn-avatar" aria-hidden="true">
                          {p.photo ? <img src={p.photo} alt="" /> : (p.firstName || '?').charAt(0)}
                        </span>
                        <span className="apn-dropdown-name">{p.firstName} <em>{p.lastName || ''}</em></span>
                        {(p.birthYear || p.birthDate) && (
                          <span className="apn-dropdown-date">{p.birthYear || String(p.birthDate).slice(0, 4)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {relations.length > 0 && (
              <div className="apn-links">
                {relations.map((rel) => (
                  <div key={rel.personId} className="apn-link">
                    <span className="apn-link-type">{relationTypeLabels[rel.type]}</span>
                    <span className="apn-link-name">{rel.personName}</span>
                    <button
                      type="button"
                      className="pz-btn pz-btn--ghost pz-btn--icon apn-link-remove"
                      onClick={() => handleRemoveRelation(rel.personId)}
                      aria-label={t('Retirer {name}', { name: rel.personName })}
                    >
                      <X size={14} strokeWidth={2.2} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {error && <div className="pz-error" role="alert">{error}</div>}
        </div>

        <div className="apn-actions">
          <button type="button" className="pz-btn pz-btn--ghost" onClick={onClose}>
            {t('Annuler')}
          </button>
          {/* Toujours actif : sans prénom, l'appui le dit et ramène au champ (le dire dès qu'on quittait le prénom
              affichait une erreur avant même d'avoir rempli la fiche) */}
          <button type="submit" className="pz-btn pz-btn--primary" disabled={loading}>
            <UserPlus size={16} strokeWidth={2} />
            <PzBusy busy={loading} busyLabel={t('Ajout en cours')}>{t('Ajouter cette personne')}</PzBusy>
          </button>
        </div>
      </form>
    </div>
  )
}

export default AddPersonPanel
