import { useEffect, useMemo, useState } from 'react'
import { FileUp, ImagePlus } from 'lucide-react'
import './TreeCreationWizard.css'
import PzBusy from './PzBusy.jsx'
import { t } from '../i18n/index.js'

const INITIAL_STATE = {
  treeName: '',
  selfFirstName: '',
  selfLastName: '',
  selfBirthYear: '',
  photoFile: null,
  // « J'ai déjà un arbre » : fichier GEDCOM exporté d'un logiciel, importé à la création
  start: 'self',
  gedcomFile: null,
}

// Titre traduit d'un bloc : le passage entre <em> et </em> garde son italique
function withEmphasis(text) {
  const [before, emphasized = '', after = ''] = text.split(/<\/?em>/)
  return <>{before}<em>{emphasized}</em>{after}</>
}

function TreeCreationWizard({
  visible,
  loading,
  defaultFirstName = '',
  onClose,
  onSubmit,
}) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(INITIAL_STATE)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) {
      return
    }

    setStep(1)
    setError('')
    setForm((current) => ({
      ...INITIAL_STATE,
      treeName: current.treeName || '',
      selfFirstName: defaultFirstName || '',
    }))
  }, [defaultFirstName, visible])

  const canContinue = useMemo(() => form.treeName.trim().length >= 2 && !loading, [form.treeName, loading])
  const canCreate = useMemo(() => {
    if (loading) return false
    if (form.start === 'import') return Boolean(form.gedcomFile)
    return form.selfFirstName.trim().length > 0 && form.selfLastName.trim().length > 0
  }, [form.selfFirstName, form.selfLastName, form.start, form.gedcomFile, loading])

  if (!visible) {
    return null
  }

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleContinue = () => {
    if (!canContinue) return
    setError('')
    setStep(2)
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    if (!canCreate) return

    setError('')
    if (form.start === 'import') {
      const submitError = await onSubmit({ treeName: form.treeName.trim(), gedcomFile: form.gedcomFile })
      if (submitError) setError(submitError)
      return
    }
    const submitError = await onSubmit({
      treeName: form.treeName.trim(),
      selfFirstName: form.selfFirstName.trim(),
      selfLastName: form.selfLastName.trim(),
      selfBirthYear: form.selfBirthYear.trim(),
      photoFile: form.photoFile || null,
    })

    if (submitError) {
      setError(submitError)
    }
  }

  return (
    <div className="pz-overlay tree-wizard-overlay" role="dialog" aria-modal="true" aria-labelledby="treeWizardTitle">
      <div className="pz-modal tree-wizard-card">
        <div className="tw-steps" aria-label={t('Étape {step} sur 2', { step })}>
          <span className={`tw-step ${step >= 1 ? 'is-on' : ''}`} />
          <span className={`tw-step ${step >= 2 ? 'is-on' : ''}`} />
          <span className="pz-small">{t('Étape {step} sur 2', { step })}</span>
        </div>

        {step === 1 ? (
          <>
            <div className="pz-modal-head">
              <h2 id="treeWizardTitle" className="pz-title">{withEmphasis(t("Comment s'appelle <em>votre famille</em> ?"))}</h2>
              <p className="pz-sub">{t("Ce nom apparaîtra en haut de l'arbre et dans le lien que vous partagerez.")}</p>
            </div>

            <div className="pz-field">
              <label htmlFor="wizardTreeName">{t('Nom de la famille')}</label>
              <input
                id="wizardTreeName"
                type="text"
                autoFocus
                maxLength={120}
                value={form.treeName}
                onChange={(event) => updateField('treeName', event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleContinue() } }}
                placeholder={t('Famille Martin')}
                required
              />
            </div>

            <div className="pz-modal-actions">
              <button type="button" className="pz-btn pz-btn--ghost" onClick={onClose} disabled={loading}>
                {t('Fermer')}
              </button>
              <button type="button" className="pz-btn pz-btn--primary" onClick={handleContinue} disabled={!canContinue}>
                {t('Continuer')}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleCreate} className="tw-form">
            <div className="pz-tabs tw-start" role="tablist" aria-label={t('Point de départ')}>
              <button type="button" role="tab" aria-selected={form.start === 'self'} className={`pz-tab ${form.start === 'self' ? 'is-active' : ''}`} onClick={() => updateField('start', 'self')}>
                {t('Je pars de moi')}
              </button>
              <button type="button" role="tab" aria-selected={form.start === 'import'} className={`pz-tab ${form.start === 'import' ? 'is-active' : ''}`} onClick={() => updateField('start', 'import')}>
                {t("J'ai déjà un arbre")}
              </button>
            </div>

            {form.start === 'import' ? (
              <>
                <div className="pz-modal-head">
                  <h2 id="treeWizardTitle" className="pz-title">{withEmphasis(t('Importez <em>votre arbre</em>'))}</h2>
                  <p className="pz-sub">{t('Heredis, Geneanet, Gramps, MyHeritage ou Ancestry savent exporter un fichier .ged. Parenthèse reprend les personnes, les liens et les dates, puis vous aide à retrouver les photos.')}</p>
                </div>
                <div className="pz-field">
                  <label htmlFor="wizardGedcom" className="tw-photo">
                    <span className="tw-photo-icon" aria-hidden="true"><FileUp size={20} strokeWidth={1.8} /></span>
                    <span className="tw-photo-text">
                      <strong>{form.gedcomFile ? form.gedcomFile.name : t('Choisir le fichier .ged ou le zip')}</strong>
                      <span>{form.gedcomFile ? t('Cliquez pour en choisir un autre') : t('Exporté depuis votre logiciel. Un zip avec le .ged et ses photos fait tout en une fois.')}</span>
                    </span>
                  </label>
                  <input
                    id="wizardGedcom"
                    className="tw-photo-input"
                    type="file"
                    accept=".ged,.zip,.gdz,text/x-gedcom,text/plain,application/zip"
                    onChange={(event) => updateField('gedcomFile', event.target.files?.[0] || null)}
                  />
                </div>
              </>
            ) : (
              <>
            <div className="pz-modal-head">
              <h2 id="treeWizardTitle" className="pz-title">{withEmphasis(t('Commencez <em>par vous</em>'))}</h2>
              <p className="pz-sub">{t("L'arbre « {name} » démarre avec votre fiche. Vous ajouterez les autres ensuite.", { name: form.treeName.trim() })}</p>
            </div>

            <div className="pz-row2">
              <div className="pz-field">
                <label htmlFor="wizardSelfFirstName">{t('Votre prénom')}</label>
                <input
                  id="wizardSelfFirstName"
                  type="text"
                  maxLength={120}
                  autoComplete="given-name"
                  value={form.selfFirstName}
                  onChange={(event) => updateField('selfFirstName', event.target.value)}
                  required
                />
              </div>
              <div className="pz-field">
                <label htmlFor="wizardSelfLastName">{t('Votre nom')}</label>
                <input
                  id="wizardSelfLastName"
                  type="text"
                  maxLength={120}
                  autoComplete="family-name"
                  value={form.selfLastName}
                  onChange={(event) => updateField('selfLastName', event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="pz-field">
              <label htmlFor="wizardSelfBirthYear">{t('Année de naissance')} <span className="tw-optional">{t('facultatif')}</span></label>
              <input
                id="wizardSelfBirthYear"
                type="number"
                inputMode="numeric"
                min="1000"
                max="2999"
                value={form.selfBirthYear}
                onChange={(event) => updateField('selfBirthYear', event.target.value)}
                placeholder="1990"
              />
            </div>

            <div className="pz-field">
              <span className="pz-label">{t('Votre photo')} <span className="tw-optional">{t('facultatif')}</span></span>
              <label htmlFor="wizardSelfPhoto" className="tw-photo">
                <span className="tw-photo-icon" aria-hidden="true"><ImagePlus size={20} strokeWidth={1.8} /></span>
                <span className="tw-photo-text">
                  <strong>{form.photoFile ? form.photoFile.name : t('Choisir une photo')}</strong>
                  <span>{form.photoFile ? t('Cliquez pour en choisir une autre') : t("Un portrait où l'on voit bien votre visage")}</span>
                </span>
              </label>
              <input
                id="wizardSelfPhoto"
                className="tw-photo-input"
                type="file"
                accept="image/*"
                onChange={(event) => updateField('photoFile', event.target.files?.[0] || null)}
              />
            </div>
              </>
            )}

            {error && <div className="pz-error tree-wizard-error" role="alert">{error}</div>}

            <div className="pz-modal-actions">
              <button type="button" className="pz-btn pz-btn--ghost" onClick={() => setStep(1)} disabled={loading}>
                {t('Retour')}
              </button>
              <button type="submit" className="pz-btn pz-btn--primary" disabled={!canCreate}>
                <PzBusy busy={loading} busyLabel={form.start === 'import' ? t('Import en cours') : t("Création de l'arbre")}>
                  {form.start === 'import' ? t('Importer mon arbre') : t('Créer mon arbre')}
                </PzBusy>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default TreeCreationWizard
