import { Check, ChevronRight, Globe, HelpCircle, LogIn, LogOut, Plus, Settings, Share2, TreeDeciduous, User, UserPlus } from 'lucide-react'
import { t } from '../../i18n/index.js'
import LanguageSwitch from './LanguageSwitch'
import { NavMenu, NavMenuGroup, NavMenuItem, NavMenuSep } from './NavMenu'
import './AvatarMenu.css'

const ICON = { size: 18, strokeWidth: 2, 'aria-hidden': true }

/**
 * Menu du rond de compte. Connecté : identité, propositions à relire, arbres, paramètres, aide, langue, déconnexion.
 * Sans compte : se connecter, créer son arbre, aide, langue.
 */
function AvatarMenu({
  phone = false,
  triggerRef,
  guest = false,
  onClose,
  userDisplayName,
  userEmail,
  linkedPersonName = '',
  trees = [],
  activeTreeId,
  activeTreeName = '',
  isOwner = false,
  pendingContributions = 0,
  onContributionsClick,
  onShareClick,
  helpUrl = '',
  onAccountClick,
  onSelectTree,
  onCreateTree,
  onSettings,
  onLogin,
  onRegister,
  onLogout,
}) {
  const displayName = linkedPersonName || userDisplayName || t('Mon compte')
  const currentTreeName = trees.find((entry) => String(entry.id) === String(activeTreeId))?.name
    || activeTreeName || trees[0]?.name || t('Aucun arbre')

  const helpRow = (
    <div className="navm-row">
      {helpUrl ? (
        <NavMenuItem
          icon={<HelpCircle {...ICON} />}
          label={t('Aide')}
          onSelect={() => { window.open(helpUrl, '_blank', 'noopener'); onClose() }}
        />
      ) : (
        <span className="navm-item navm-text" aria-hidden="true">
          <span className="navm-ic"><Globe {...ICON} /></span>
          <span>{t('Langue')}</span>
        </span>
      )}
      <LanguageSwitch />
    </div>
  )

  const body = guest ? (
    <>
      <NavMenuItem icon={<LogIn {...ICON} />} label={t('Se connecter')} onSelect={() => { onClose(); onLogin?.() }} />
      {onRegister && <NavMenuItem icon={<UserPlus {...ICON} />} label={t('Créer mon arbre')} onSelect={() => { onClose(); onRegister() }} />}
      {/* Visiteur d'un arbre partagé : il dit qui il est, cette personne le suit dans chaque onglet de famille */}
      {activeTreeId && onAccountClick && (
        <>
          <NavMenuSep />
          <NavMenuItem
            icon={<User {...ICON} />}
            label={linkedPersonName || t('Qui êtes-vous dans cet arbre ?')}
            onSelect={() => { onClose(); onAccountClick() }}
            right={<ChevronRight size={16} aria-hidden="true" className="navm-chevron" />}
          />
        </>
      )}
      <NavMenuSep />
      {helpRow}
    </>
  ) : (
    <>
      <button type="button" role="menuitem" className="navm-item navm-head" onClick={() => { onClose(); onAccountClick?.() }}>
        <span className="navm-head-mono" aria-hidden="true">{displayName.trim().charAt(0).toUpperCase()}</span>
        <span className="navm-text">
          <strong>{displayName}</strong>
          <small>{userEmail || t('Mon compte')}</small>
        </span>
        <ChevronRight size={16} aria-hidden="true" className="navm-chevron" />
      </button>

      {isOwner && onContributionsClick && pendingContributions > 0 && (
        <NavMenuItem
          icon={<Share2 {...ICON} />}
          label={t('Propositions à relire')}
          onSelect={() => { onClose(); onContributionsClick() }}
          right={<span className="navm-badge">{pendingContributions > 99 ? '99+' : pendingContributions}</span>}
        />
      )}

      <NavMenuSep />
      <NavMenuGroup label={t('Mes arbres')}>
        {trees.length > 1 ? trees.map((tree) => {
          // L'arbre en cours : affiché comme courant (coche terracotta), non cliquable, pas grisé
          const isActive = String(tree.id) === String(activeTreeId)
          return (
            <NavMenuItem
              key={tree.id}
              icon={<span className="navm-tree-mono" aria-hidden="true">{(tree.name || '?').trim().charAt(0).toUpperCase()}</span>}
              label={tree.name}
              onSelect={isActive ? undefined : () => { onClose(); onSelectTree?.(tree.id) }}
              disabled={isActive}
              className={isActive ? 'navm-current' : undefined}
              right={isActive ? <Check size={16} aria-hidden="true" className="navm-check" /> : null}
            />
          )
        }) : (
          <NavMenuItem
            icon={<TreeDeciduous {...ICON} />}
            label={currentTreeName}
            disabled
            className="navm-current"
            right={<Check size={16} aria-hidden="true" className="navm-check" />}
          />
        )}
        <NavMenuItem icon={<Plus {...ICON} />} label={t('Créer un nouvel arbre')} onSelect={() => { onClose(); onCreateTree?.() }} />
      </NavMenuGroup>

      {isOwner && onShareClick && (
        <NavMenuItem icon={<Share2 {...ICON} />} label={t("Partager l'arbre")} onSelect={() => { onClose(); onShareClick() }} />
      )}

      {isOwner && (
        <NavMenuItem icon={<Settings {...ICON} />} label={t("Paramètres de l'arbre")} onSelect={() => { onClose(); onSettings?.() }} />
      )}

      <NavMenuSep />
      {helpRow}
      <NavMenuSep />
      <NavMenuItem danger icon={<LogOut {...ICON} />} label={t('Se déconnecter')} onSelect={() => { onClose(); onLogout?.() }} />
    </>
  )

  return (
    <NavMenu phone={phone} label={t('Menu compte')} onClose={onClose} triggerRef={triggerRef}>
      {body}
    </NavMenu>
  )
}

export default AvatarMenu
