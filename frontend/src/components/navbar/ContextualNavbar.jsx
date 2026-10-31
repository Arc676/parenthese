import { useState, useRef, useEffect } from 'react'
import {
  Brush, ImagePlus, Plus, UserPlus, User, MousePointer2, Pencil, Type, Star, Trash2, Image, ArrowLeft, Search, TreeDeciduous,
} from 'lucide-react'
import { NavMenu, NavMenuGroup, NavMenuItem } from './NavMenu'
import AvatarMenu from './AvatarMenu'
import DrawingOptions from '../annotations/DrawingOptions'
import TextOptions from '../annotations/TextOptions'
import StickerPicker from '../annotations/StickerPicker'
import { toJourneyRole, toOpaqueTreeId, trackAppEvent } from '../../utils/analytics'
import { t } from '../../i18n/index.js'
import { PHONE_QUERY } from '../../utils/sheetDrag'
import './ContextualNavbar.css'
import { initialOf } from '../../utils/initial.js'
import Kbd from '../Kbd.jsx'

const ANNOT_TOOLS = [
  { id: 'pointer', label: t('Sélection'), Icon: MousePointer2 },
  { id: 'drawing', label: t('Dessin'), Icon: Pencil },
  { id: 'text', label: t('Texte'), Icon: Type },
  { id: 'sticker', label: t('Sticker'), Icon: Star },
  { id: 'photo', label: t('Photo'), Icon: Image },
]

// Téléphone, en modification : les outils de dessin passent dans le menu « + »
const ANNOT_MENU = [
  { id: 'drawing', label: t('Dessiner'), Icon: Pencil },
  { id: 'text', label: t('Écrire un texte'), Icon: Type },
  { id: 'sticker', label: t('Poser un sticker'), Icon: Star },
  { id: 'photo', label: t('Poser une photo'), Icon: Image },
]

// Téléphone (ou pointeur grossier) : le « + » et le compte s'ouvrent en feuille, sinon en popover (PHONE_QUERY, partagé avec la fiche)
const ICON = { size: 18, strokeWidth: 2, 'aria-hidden': true }

function ContextualNavbar({
  userRole,
  pendingContributions = 0,
  editModeActive = false,
  trees = [],
  activeTreeId = null,
  userDisplayName = '',
  userEmail = '',
  userAvatarPhoto = '',
  linkedPersonName = '',
  activeTreeName = '',
  onEditClick,
  onAddPersonClick,
  onAddSouvenirClick,
  onSearchClick,
  helpUrl = '',
  onShareClick,
  onTreeSelect,
  onCreateTree,
  onProfileClick,
  canRegister = true,
  signupPrompts = false,
  onAccountClick,
  onSettingsClick,
  onLogout,
  annotationTools = null,
}) {
  // Un seul menu ouvert à la fois : 'add' (le +), 'account' (le rond), ou null
  const [openMenu, setOpenMenu] = useState(null)
  const [annotPanel, setAnnotPanel] = useState(null)
  const [annotMode, setAnnotMode] = useState(false)
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches
  )

  const navRef = useRef(null)
  const addBtnRef = useRef(null)
  const avatarBtnRef = useRef(null)
  const photoInputRef = useRef(null)

  useEffect(() => {
    const mql = window.matchMedia(PHONE_QUERY)
    const handler = (event) => setIsPhone(event.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  // Clic dehors ferme le menu sur ordinateur (sur téléphone, c'est le voile)
  useEffect(() => {
    function handleClickOutside(event) {
      if (isPhone) return
      if (navRef.current && !navRef.current.contains(event.target)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isPhone])

  useEffect(() => {
    if (!annotPanel) return
    function handleClick(event) {
      if (navRef.current && navRef.current.contains(event.target)) return
      setAnnotPanel(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [annotPanel])

  // Échap ferme le menu ouvert et le panneau d'options
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setOpenMenu(null)
        setAnnotPanel(null)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  useEffect(() => {
    if (!editModeActive) {
      setAnnotPanel(null)
      setAnnotMode(false)
    }
  }, [editModeActive])

  const { navbarType, authenticated } = userRole
  const isOwner = navbarType === 'admin'
  const isFamily = (navbarType === 'contributor_anon' || navbarType === 'contributor_auth') && Boolean(onAddSouvenirClick)
  const isDemo = userRole.accessMode === 'demo' && !['admin', 'contributor_auth', 'contributor_anon', 'visitor'].includes(navbarType)
  const showMobileAnnot = isPhone && editModeActive && annotationTools
  const accountRole = toJourneyRole(userRole.role) || 'visitor'
  const accountClickProps = {
    role: accountRole,
    tree_id: toOpaqueTreeId(activeTreeId),
  }

  const closeMenus = () => setOpenMenu(null)

  // « Propositions à relire » ouvre la fenêtre de partage, positionnée sur la section des propositions
  const openProposals = () => {
    onShareClick?.()
    const scrollWhenReady = (retries) => {
      const section = document.getElementById('contrib-propositions')
      if (section) section.scrollIntoView({ block: 'start' })
      else if (retries > 0) setTimeout(() => scrollWhenReady(retries - 1), 100)
    }
    scrollWhenReady(20)
  }
  // Chaque action ferme le menu avant de se lancer
  const run = (action) => () => {
    closeMenus()
    action?.()
  }

  // Création de compte dans l'app
  // via : « ajouter » (menu Ajouter de la famille) ou « compte » (menu du compte)
  const handleCreateAccountClick = (via = 'compte') => {
    trackAppEvent('create_account_clicked', { ...accountClickProps, via })
    onProfileClick?.('register', via)
  }

  const handleAnnotToolClick = (toolId) => {
    annotationTools.onToolChange(toolId)
    if (toolId === 'photo') {
      setAnnotPanel(null)
      photoInputRef.current?.click()
    } else if (['drawing', 'text', 'sticker'].includes(toolId)) {
      setAnnotPanel((prev) => (prev === toolId ? null : toolId))
    } else {
      setAnnotPanel(null)
    }
  }

  // Corbeille des annotations : visible seulement quand il y a quelque chose à effacer
  const renderAnnotTrash = () => (
    <button
      className={`nav-annot-btn nav-annot-btn--trash${annotationTools.isDragging ? ' nav-annot-btn--drag-target' : ''}${annotationTools.isOverTrash ? ' nav-annot-btn--drag-over' : ''}`}
      onClick={annotationTools.onDelete}
      aria-label={t('Supprimer')}
      title={t('Supprimer')}
      data-annotation-trash=""
    >
      <Trash2 size={annotationTools.isOverTrash ? 22 : 18} strokeWidth={2} />
    </button>
  )

  // Le « + » : ce qu'on met sur l'arbre, et ce qu'on corrige
  const editLabel = editModeActive
    ? t('Terminer la modification')
    : isFamily
      ? t('Proposer des changements')
      : isDemo
        ? t('Modifier la démo')
        : t("Modifier l'arbre")

  let addGroups = []
  if (showMobileAnnot) {
    addGroups = [{
      label: t('Ajouter'),
      items: [
        { key: 'person', icon: <UserPlus {...ICON} />, label: t('Une personne'), onSelect: onAddPersonClick },
        ...ANNOT_MENU.map((tool) => ({
          key: tool.id,
          icon: <tool.Icon {...ICON} />,
          label: tool.label,
          onSelect: () => { setAnnotMode(true); handleAnnotToolClick(tool.id) },
        })),
      ],
    }]
  } else {
    const addItems = []
    if (onAddSouvenirClick) {
      addItems.push({ key: 'souvenir', icon: <ImagePlus {...ICON} />, label: t('Un souvenir'), sub: t('photo, vidéo, voix, document'), onSelect: onAddSouvenirClick })
    }
    if (isFamily || isOwner || isDemo) {
      addItems.push({ key: 'person', icon: <UserPlus {...ICON} />, label: t('Une personne'), onSelect: onAddPersonClick })
      addItems.push({ key: 'word', icon: <Brush {...ICON} />, label: t("Un mot ou un dessin sur l'arbre"), onSelect: onEditClick })
    }
    const fixItems = []
    if (isFamily) {
      fixItems.push({ key: 'edit', icon: <Pencil {...ICON} />, label: editLabel, sub: editModeActive ? null : t('dates, noms, liens, le propriétaire relit'), onSelect: onEditClick, shortcut: 'e' })
    } else if (isOwner || isDemo) {
      fixItems.push({ key: 'edit', icon: <Pencil {...ICON} />, label: editLabel, onSelect: onEditClick, shortcut: 'e' })
    }
    if (addItems.length) addGroups.push({ label: t('Ajouter'), items: addItems })
    if (fixItems.length) addGroups.push({ label: t('Corriger'), items: fixItems })
    // Chercher quelqu'un dans des sources publiques (décès INSEE, archives, presse) : panneau à droite de l'arbre
    if (onSearchClick) {
      addGroups.push({ label: t('Chercher'), items: [{ key: 'search', icon: <Search {...ICON} />, label: t("Quelqu'un ailleurs"), sub: t('décès depuis 1970, archives, presse'), onSelect: onSearchClick }] })
    }
  }
  // La famille sans compte trouve « Faire le mien » en bas du menu qu'elle ouvre, le menu Ajouter, et la ligne quitte
  // le menu du compte. Seulement si l'instance invite à créer son arbre (SIGNUP_PROMPTS).
  const ownTreeInAddMenu = signupPrompts && canRegister && isFamily && !authenticated && !showMobileAnnot
  if (ownTreeInAddMenu) {
    addGroups.push({ label: t('Votre famille'), items: [{ key: 'own-tree', icon: <TreeDeciduous {...ICON} />, label: t('Faire le mien'), sub: t('un arbre pour votre famille, gratuit'), onSelect: () => handleCreateAccountClick('ajouter') }] })
  }
  const hasAddMenu = addGroups.length > 0

  const renderAddMenu = () => (
    <NavMenu phone={isPhone} label={t('Ajouter ou corriger')} onClose={closeMenus} triggerRef={addBtnRef}>
      {addGroups.map((group) => (
        <NavMenuGroup key={group.label} label={group.label}>
          {group.items.map((item) => (
            <NavMenuItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              sub={item.sub}
              onSelect={run(item.onSelect)}
              right={item.shortcut ? <Kbd mod="ctrl" k={item.shortcut} /> : null}
            />
          ))}
        </NavMenuGroup>
      ))}
    </NavMenu>
  )

  const avatarInitial = initialOf(linkedPersonName || userDisplayName || userEmail, 'P')
  const pendingBadge = isOwner && onShareClick && pendingContributions > 0

  return (
    <nav
      ref={navRef}
      className={`contextual-navbar${isFamily && !editModeActive ? ' contextual-navbar--family' : ''}${showMobileAnnot ? ' contextual-navbar--annot-mobile' : ''}${annotationTools?.isDragging ? ' contextual-navbar--dragging' : ''}`}
    >
      {showMobileAnnot && annotPanel && (
        <div className="navbar-annot-panel">
          {annotPanel === 'drawing' && annotationTools.activeTool === 'drawing' && (
            <DrawingOptions
              currentStyle={annotationTools.currentStyle}
              onStyleChange={annotationTools.onStyleChange}
            />
          )}
          {annotPanel === 'text' && annotationTools.activeTool === 'text' && (
            <TextOptions
              currentStyle={annotationTools.currentStyle}
              onStyleChange={annotationTools.onStyleChange}
            />
          )}
          {annotPanel === 'sticker' && annotationTools.activeTool === 'sticker' && (
            <StickerPicker
              selected={annotationTools.selectedSticker}
              onSelect={annotationTools.onStickerSelect}
            />
          )}
        </div>
      )}

      {showMobileAnnot && (
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file && annotationTools.onPhotoFileSelected) {
              annotationTools.onPhotoFileSelected(file)
            }
            event.target.value = ''
          }}
        />
      )}

      <div className={`navbar-content${showMobileAnnot ? ' navbar-content--annot' : ''}`}>
        {showMobileAnnot && !annotMode ? (
          <>
            {/* Sortie de l'édition en toutes lettres : une croix seule à côté du « + » ne disait pas ce qu'elle faisait (Patch, 27/10) */}
            <button
              type="button"
              className="nav-annot-exit"
              onClick={onEditClick}
              title={t("Quitter l'édition")}
            >
              {t('Terminé')}
            </button>

            <button
              type="button"
              ref={addBtnRef}
              className={`nav-add${openMenu === 'add' ? ' is-open' : ''}`}
              onClick={() => setOpenMenu((v) => (v === 'add' ? null : 'add'))}
              aria-expanded={openMenu === 'add'}
              aria-haspopup="menu"
              aria-label={t('Ajouter ou corriger')}
            >
              <Plus size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
            {openMenu === 'add' && renderAddMenu()}

            {(annotationTools.selectedAnnotationId || annotationTools.isDragging) && renderAnnotTrash()}
          </>
        ) : showMobileAnnot ? (
          <>
            <button
              className="nav-annot-btn"
              onClick={() => {
                setAnnotPanel(null)
                setAnnotMode(false)
                annotationTools.onToolChange('pointer')
              }}
              aria-label={t('Terminé')}
              title={t('Terminé')}
            >
              <ArrowLeft size={18} strokeWidth={2.5} />
            </button>

            <div className="nav-annot-sep" />

            {ANNOT_TOOLS.map((tool) => (
              <button
                key={tool.id}
                className={`nav-annot-btn${annotationTools.activeTool === tool.id ? ' nav-annot-btn--active' : ''}${annotPanel === tool.id ? ' nav-annot-btn--panel-open' : ''}`}
                onClick={() => handleAnnotToolClick(tool.id)}
                aria-label={tool.label}
                title={tool.label}
              >
                <tool.Icon size={20} strokeWidth={2} />
              </button>
            ))}

            {(annotationTools.selectedAnnotationId || annotationTools.isDragging) && (
              <>
                <div className="nav-annot-sep" />
                {renderAnnotTrash()}
              </>
            )}
          </>
        ) : (
          <>
            {hasAddMenu && (
              <button
                type="button"
                ref={addBtnRef}
                className={`nav-add${isPhone ? '' : ' nav-add--label'}${openMenu === 'add' ? ' is-open' : ''}${editModeActive ? ' is-editing' : ''}`}
                onClick={() => setOpenMenu((v) => (v === 'add' ? null : 'add'))}
                aria-expanded={openMenu === 'add'}
                aria-haspopup="menu"
                aria-label={isOwner || isDemo ? t('Modifier') : t('Ajouter ou corriger')}
              >
                {/* Qui gère l'arbre (et la démo) : « Modifier » ; la famille garde « Ajouter », son geste est d'ajouter un souvenir */}
                {isOwner || isDemo
                  ? <Pencil size={18} strokeWidth={2.2} aria-hidden="true" />
                  : <Plus size={20} strokeWidth={2.2} aria-hidden="true" />}
                {!isPhone && <span className="nav-add-label">{isOwner || isDemo ? t('Modifier') : t('Ajouter')}</span>}
              </button>
            )}
            {hasAddMenu && openMenu === 'add' && renderAddMenu()}

            {/* Rond du compte : icône de profil hors connexion, initiale ou photo connecté */}
            <div className="nav-dropdown-wrapper">
              <button
                type="button"
                ref={avatarBtnRef}
                className={`nav-avatar${authenticated ? '' : ' nav-avatar--guest'}${userRole.isAdmin ? ' admin' : ''}${openMenu === 'account' ? ' active' : ''}`}
                onClick={() => setOpenMenu((v) => (v === 'account' ? null : 'account'))}
                aria-expanded={openMenu === 'account'}
                aria-haspopup="menu"
                aria-label={t('Menu compte')}
                title={t('Menu compte')}
              >
                {!authenticated ? (
                  <User size={20} strokeWidth={2} aria-hidden="true" />
                ) : userAvatarPhoto ? (
                  <img className="nav-avatar-photo" src={userAvatarPhoto} alt="" />
                ) : (
                  <span className="nav-avatar-initial" aria-hidden="true">{avatarInitial}</span>
                )}
                {pendingBadge && (
                  <span className="nav-avatar-badge" aria-hidden="true">{pendingContributions > 9 ? '9+' : pendingContributions}</span>
                )}
              </button>
              {openMenu === 'account' && (
                <AvatarMenu
                  phone={isPhone}
                  triggerRef={avatarBtnRef}
                  guest={!authenticated}
                  onClose={closeMenus}
                  userDisplayName={userDisplayName}
                  userEmail={userEmail}
                  linkedPersonName={linkedPersonName}
                  trees={trees}
                  activeTreeId={activeTreeId}
                  activeTreeName={activeTreeName}
                  isOwner={isOwner}
                  pendingContributions={pendingContributions}
                  onContributionsClick={openProposals}
                  onShareClick={onShareClick}
                  helpUrl={helpUrl}
                  onAccountClick={onAccountClick}
                  onSelectTree={onTreeSelect}
                  onCreateTree={onCreateTree}
                  onSettings={onSettingsClick}
                  onLogin={() => onProfileClick?.('login', 'compte')}
                  onRegister={canRegister && !ownTreeInAddMenu ? () => handleCreateAccountClick('compte') : undefined}
                  onLogout={onLogout}
                />
              )}
            </div>
          </>
        )}
      </div>
    </nav>
  )
}

export default ContextualNavbar
