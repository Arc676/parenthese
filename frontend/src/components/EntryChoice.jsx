import logoUrl from '../assets/parenthese-logo.svg?url'
import './AccountScreens.css'
import LanguageSwitch from './navbar/LanguageSwitch'
import { t } from '../i18n/index.js'

// Accueil sans session (variante B validée le 18/10) : deux choix, rien d'autre au premier regard.
const EntryChoice = ({ onFamilyLink, onLogin, onRegister }) => (
  <div className="entry-choice pz-screen">
    <div className="pz-screen-inner">
      <img src={logoUrl} alt="Parenthèse" className="pz-screen-logo" />

      <h1 className="pz-title entry-choice-title">{t('Que voulez-vous faire ?')}</h1>

      <div className="entry-choice-card pz-card">
        <h2 className="entry-choice-name">{t("J'ai reçu un lien")}</h2>
        <p className="pz-sub">{t("Pas besoin de compte pour regarder l'arbre.")}</p>
        <button type="button" className="pz-btn pz-btn--primary pz-btn--block" onClick={onFamilyLink}>
          {t("J'ai reçu un lien de famille")}
        </button>
      </div>

      <div className="entry-choice-card pz-card">
        <h2 className="entry-choice-name">{t("J'ai déjà un compte")}</h2>
        <p className="pz-sub">{t('Pour retrouver vos arbres et ajouter des souvenirs.')}</p>
        <button type="button" className="pz-btn pz-btn--line pz-btn--block" onClick={onLogin}>
          {t('Se connecter')}
        </button>
      </div>

      {/* Absent quand l'instance n'accepte plus de compte (ALLOW_REGISTRATION=false) */}
      {onRegister && (
        <div className="pz-account-foot">
          <button type="button" className="pz-btn pz-btn--ghost pz-btn--sm" onClick={onRegister}>
            {t('Créer mon arbre')}
          </button>
        </div>
      )}

      <LanguageSwitch className="pz-lang--screen" />
    </div>
  </div>
)

export default EntryChoice
