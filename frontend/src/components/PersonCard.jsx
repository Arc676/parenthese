import { useState, useEffect, useRef, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { Save, Trash2, Plus, X, Search, Check, Play, ImagePlus, Camera, Crop, Sparkles, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { getParents, getChildren, getPersonUnions, getPersonMedias, getPersonTaggedMedias, getDemoLife, getPersonById, filiations, persons, unions } from '../data/mockData'
import { deleteLifeEvent, fetchPersonLife } from '../api/treeApi.js'
import LifeTimeline from './LifeTimeline.jsx'
import MomentSheet from './MomentSheet.jsx'
import { fetchImmichConfig } from '../api/immichApi.js'
import GeoMediaThumbnail from './GeoMediaThumbnail'
import ImmichFacePanel from './ImmichFacePanel.jsx'
import './PersonCard.css'
import PzBusy from './PzBusy.jsx'
import { useSheetDrag, useSheetMode } from '../hooks/useSheetDrag'
import { rememberOrigin } from '../utils/openOrigin'
import PortraitCropModal from './PortraitCropModal.jsx'
import { imagePlacement } from '../utils/portraitCrop.js'
import { t, dateLocale } from '../i18n/index.js'
import { formatPlace } from '../utils/place.js'
import { firstNameLabel, fullNameLabel, isFirstNameUnknown } from '../utils/personName.js'
import { isYearOnly } from '../utils/dateInput.js'
import DateField from './DateField.jsx'
import { runOnce } from '../utils/saveOnLeave.js'
import { normalizeSex, SEX_CHOICES } from '../utils/personSex.js'
import { ProposalBanner } from './ProposalCard.jsx'
import { initialsOf } from '../utils/initial.js'
import { blurPlaceholder } from '../utils/blurhash.js'

// Aucune modification en cours (référence stable)
const NO_EDITS = Object.freeze({})

const TYPE_LABELS = {
  photo: t('Photo'),
  video: t('Vidéo'),
  audio: t('Audio'),
  document: t('Document'),
  citation: t('Citation'),
  geojson: t('Carte GPS'),
  gpx: t('Trace GPX'),
}

// Type d'union affiché (la valeur stockée reste l'enum français)
const UNION_TYPE_LABELS = {
  mariage: t('mariage'),
  union: t('union'),
}
const unionTypeLabel = (type) => UNION_TYPE_LABELS[type] || type

// Hauteurs fixes de l'onde du lecteur vocal (pas d'aléatoire au rendu)
const VOICE_WAVE = [40, 64, 48, 82, 58, 92, 70, 46, 68, 86, 52, 74, 42, 62, 88, 56, 46, 72, 84, 50, 64, 42]

const PersonCard = ({
  person,
  onClose,
  onMediaSelect,
  editMode = false,
  canManageMedia = false,
  onManageMedia,
  onAvatarUpload,
  onAvatarDelete,
  onAvatarCrop,
  treeId = null,
  immichToken = null,
  onImmichChange,
  avatarActionLoading = false,
  avatarActionError = '',
  isAdmin = false,
  onSave,
  onDelete,
  onAddRelation,
  onRemoveRelation,
  onSetParentage,
  pendingParentage = null,
  // Modification proposée et pas encore relue (fantôme, 1.5.1) : { fields, deleted, ghost }, et sa relecture
  proposal = null,
  proposalReview = null,
  // Créer un proche qui n'est pas encore dans l'arbre (1.5.1) : (type, nom tapé) ouvre l'ajout déjà rempli
  onCreateRelative = null,
  relationActionLoading = false,
  relationActionSuccess = '',
  relationActionError = '',
  siblingPlace = null,
  onMoveSibling,
  onUploadMomentFile,
  onMomentSaved,
  // Suppression annulable (App, hooks/useUndoable.js)
  onUndoable,
  saveOnLeaveRef = null,
  // Administrateur, hors démo : la fiche passe en modification d'un clic, sans chercher le crayon de l'arbre
  onQuickEdit,
}) => {
  // Souvenirs d'abord quand il y en a, ou quand on peut en ajouter : c'est là qu'est le bouton
  const [tab, setTab] = useState(() => (getPersonMedias(person.id).length > 0 || getPersonTaggedMedias(person.id).length > 0 || canManageMedia ? 'medias' : 'infos'))
  const [lifeState, setLifeState] = useState({ personId: null, data: null, loading: false, failed: false })

  const lifeRequestedFor = useRef(null)
  // Fiche « Ajouter un moment » : null fermée, {} pour ajouter, { event } pour modifier
  const [momentSheet, setMomentSheet] = useState(null)
  const [lifeRevision, setLifeRevision] = useState(0)
  // Moment envoyé par la famille : on dit qu'il attend la relecture
  const [lifeNotice, setLifeNotice] = useState('')

  useEffect(() => {
    if (tab !== 'vie' || lifeRequestedFor.current === person.id) return undefined
    lifeRequestedFor.current = person.id
    if (!treeId || !immichToken) {
      setLifeState({ personId: person.id, data: getDemoLife(person.id), loading: false, failed: false })
      return undefined
    }
    let cancelled = false
    // Retour sur l'onglet : on garde la frise affichée pendant qu'elle se rafraîchit
    setLifeState((prev) => (prev.personId === person.id && prev.data ? prev : { personId: person.id, data: null, loading: true, failed: false }))
    fetchPersonLife(treeId, person.id, immichToken)
      .then((data) => { if (!cancelled) setLifeState({ personId: person.id, data, loading: false, failed: false }) })
      .catch(() => { if (!cancelled) setLifeState({ personId: person.id, data: null, loading: false, failed: true }) })
    return () => {
      cancelled = true
      lifeRequestedFor.current = null
    }
  }, [tab, person.id, treeId, immichToken, lifeRevision])

  // Modifications en cours, rattachées à la personne qu'elles concernent. Au changement de fiche,
  // le premier rendu ne doit pas voir celles de la personne d'avant : un champ qui s'initialise à
  // ce moment-là (DateField) les garderait, et la date d'une personne passait sur une autre.
  const [editState, setEditState] = useState(() => ({ personId: person.id, values: {}, changed: false }))
  const ownEdits = editState.personId === person.id
  const edits = ownEdits ? editState.values : NO_EDITS
  const hasChanges = ownEdits && editState.changed
  // Prénom inconnu (case cochée) et saisie de prénom vide sans case : le prénom est demandé avant l'enregistrement
  const [unknownFirstName, setUnknownFirstName] = useState(() => isFirstNameUnknown(person))
  const [firstNameMissing, setFirstNameMissing] = useState(false)
  const [lastNameMissing, setLastNameMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState('')
  // Enregistrement en cours : un second appel (bouton, puis changement de fiche) reçoit la même promesse
  const saveInFlight = useRef(null)
  const [showImmichPanel, setShowImmichPanel] = useState(false)
  // null : connexion Immich de l'arbre inconnue, puis booléen. Le menu de source ne se propose
  // qu'à qui peut agir (owner/admin de l'arbre, comme pour toute action Immich) et seulement
  // si l'arbre est connecté ou qu'une association passée demande un nettoyage.
  const [immichConfigured, setImmichConfigured] = useState(null)
  const [showSourceMenu, setShowSourceMenu] = useState(false)
  const [sourceMenuPos, setSourceMenuPos] = useState({ top: 0, left: 0 })
  const sourceBtnRef = useRef(null)
  // Menu du badge appareil photo (position, ou null fermé) et fenêtre de recadrage ({ src, mode, ownsUrl }, ou null)
  const [photoMenuPos, setPhotoMenuPos] = useState(null)
  const [cropState, setCropState] = useState(null)
  // Taille naturelle de la photo affichée dans la fiche, pour placer le portrait recadré
  const [photoSize, setPhotoSize] = useState(null)

  // Inline relation search state
  const [activeRelationSearch, setActiveRelationSearch] = useState(null) // 'parent' | 'spouse' | 'child' | null
  const [relationSearchQuery, setRelationSearchQuery] = useState('')
  const relationSearchRef = useRef(null)
  const avatarInputRef = useRef(null)
  // Infos en modification : champs ouverts depuis une pastille (et leur focus)
  const [openedFields, setOpenedFields] = useState([])
  const [focusField, setFocusField] = useState(null)
  const bodyRef = useRef(null)
  // Feuille du bas (téléphone) : on la ferme en la glissant par la poignée ou l'en-tête, comme la croix
  const sheetMode = useSheetMode()
  const drag = useSheetDrag({ enabled: sheetMode, zone: '.pc-grab, .pc-head, .pc-close', onClose })
  // La barre des familles (en haut à gauche) ne s'écarte que si la fiche, posée en bas, monte jusqu'à elle
  const cardRef = useRef(null)
  useEffect(() => {
    const el = cardRef.current
    if (!el) return undefined
    const update = () => document.body.toggleAttribute('data-fiche-haute', el.getBoundingClientRect().top < 72)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      document.body.removeAttribute('data-fiche-haute')
    }
  }, [])

  // Reset edits quand la personne change
  useEffect(() => {
    setEditState({ personId: person.id, values: {}, changed: false })
    setUnknownFirstName(isFirstNameUnknown(person))
    setFirstNameMissing(false)
    setLastNameMissing(false)
    setActiveRelationSearch(null)
    setRelationSearchQuery('')
    setSaveSuccess(false)
    setSaveError('')
    setShowSourceMenu(false)
    setMomentSheet(null)
    setLifeNotice('')
    setPhotoMenuPos(null)
    setCropState(null)
    setPhotoSize(null)
    setOpenedFields([])
    setFocusField(null)
  }, [person.id])

  // Pastille cliquée : le champ s'ouvre à sa place et prend le focus
  useEffect(() => {
    if (!focusField) return
    const target = bodyRef.current?.querySelector(`[data-pc-field="${focusField}"] input, [data-pc-field="${focusField}"] textarea`)
    target?.focus()
    setFocusField(null)
  }, [focusField])

  // Connexion Immich de l'arbre : métadonnées sans clé. Une erreur (rôle périmé, réseau) se
  // traduit par « non configuré » : la fiche reste utilisable, simplement sans choix de source.
  // Seul un administrateur de l'arbre voit l'option Immich, comme côté serveur.
  // Dépend de la présence de onImmichChange, pas de sa valeur : App le recrée à chaque rendu, ce qui
  // relançait la lecture de la config et refermait le menu des sources juste après son ouverture
  const canChangeImmich = Boolean(onImmichChange)
  useEffect(() => {
    let cancelled = false
    setImmichConfigured(null)
    setShowSourceMenu(false)
    if (!editMode || !isAdmin || !treeId || !canChangeImmich || !immichToken) return undefined
    fetchImmichConfig(treeId, immichToken)
      .then(({ config }) => { if (!cancelled) setImmichConfigured(Boolean(config?.configured)) })
      .catch(() => { if (!cancelled) setImmichConfigured(false) })
    return () => { cancelled = true }
  }, [editMode, isAdmin, treeId, immichToken, canChangeImmich])

  useEffect(() => {
    if (!showSourceMenu) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') setShowSourceMenu(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showSourceMenu])

  // Escape ferme le menu du badge
  useEffect(() => {
    if (!photoMenuPos) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') setPhotoMenuPos(null) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [photoMenuPos])

  const openPhotoMenu = () => {
    if (avatarActionLoading) return
    const rect = sourceBtnRef.current?.getBoundingClientRect()
    if (rect) {
      setPhotoMenuPos({
        top: Math.round(rect.bottom) + 6,
        left: Math.round(Math.min(rect.left, window.innerWidth - 232)),
      })
    }
  }

  // Fermer la fenêtre de recadrage ; l'aperçu envoyé est libéré
  const closeCrop = () => {
    if (cropState?.ownsUrl) URL.revokeObjectURL(cropState.src)
    setCropState(null)
  }

  // Placement du portrait dans la fiche (carrée), comme le canevas
  const photoPlacement = photoSize ? imagePlacement(photoSize.w, photoSize.h, 1, person.avatarCrop) : null
  const photoStyle = photoPlacement
    ? { position: 'absolute', maxWidth: 'none', left: `${photoPlacement.left}%`, top: `${photoPlacement.top}%`, width: `${photoPlacement.width}%`, height: `${photoPlacement.height}%` }
    : undefined
  // Même forme de cadre que dans l'arbre (renderers.js)
  const treeFrameType = getPersonById(person.id)?.frameType || person.frameType

  const immichUsable = isAdmin && Boolean(immichConfigured || person.avatarFromImmich)
  const openAvatarPicker = () => {
    if (avatarActionLoading) return
    if (immichUsable) {
      const rect = sourceBtnRef.current?.getBoundingClientRect()
      if (rect) {
        setSourceMenuPos({
          top: Math.round(rect.bottom) + 6,
          left: Math.round(Math.min(rect.left, window.innerWidth - 252)),
        })
      }
      setShowSourceMenu(true)
    } else {
      avatarInputRef.current?.click()
    }
  }
  const chooseFileSource = () => { setShowSourceMenu(false); avatarInputRef.current?.click() }
  const chooseImmichSource = () => { setShowSourceMenu(false); setShowImmichPanel(true) }

  // Focus search input when relation search opens
  useEffect(() => {
    if (activeRelationSearch) {
      setTimeout(() => relationSearchRef.current?.focus(), 50)
    }
  }, [activeRelationSearch])

  // Close relation search on click outside
  useEffect(() => {
    if (!activeRelationSearch) return

    function handleClick(e) {
      if (!e.target.closest('.relation-search-inline')) {
        setActiveRelationSearch(null)
        setRelationSearchQuery('')
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activeRelationSearch])

  const getEditValue = (field, fallback) => {
    return field in edits ? edits[field] : (fallback ?? '')
  }

  const handleFieldChange = (field, value) => {
    const personId = person.id
    setEditState(prev => ({
      personId,
      values: { ...(prev.personId === personId ? prev.values : {}), [field]: value },
      changed: true,
    }))
  }

  // Onglet Infos en modification : seuls les champs remplis (ou ouverts) s'affichent, le reste est en pastilles
  const isFilled = (value) => value !== null && value !== undefined && String(value).trim() !== ''
  // Un champ ouvert par sa pastille, ou en cours de saisie, reste affiché jusqu'à l'enregistrement,
  // même vidé : sinon il disparaît sous les doigts et la frappe part dans le champ suivant
  const openedHas = (field) => openedFields.includes(field) || field in edits
  const openField = (field) => {
    setOpenedFields((prev) => (prev.includes(field) ? prev : [...prev, field]))
    setFocusField(field)
  }
  const birthFilled = isFilled(getEditValue('birthYear', person.birthDate || person.birthYear))
  const deathFilled = isFilled(getEditValue('deathYear', person.deathDate || person.deathYear))
  const deceasedNow = editMode ? !getEditValue('isAlive', person.isAlive) : !person.isAlive
  const editSex = normalizeSex(getEditValue('sex', person.sex))
  const notesShown = editMode && (isFilled(getEditValue('note', person.note)) || openedHas('note'))
  // En lecture : toujours visible si demandé (naissance, décès d'une personne décédée), sinon si rempli
  const infoRow = (field, label, filled, content, always = false) => {
    const shown = editMode ? (filled || openedHas(field)) : (always || filled)
    if (!shown) return null
    return (
      <div className="pc-row" data-pc-field={field}>
        <span className="pc-label">{label}</span>
        {content}
      </div>
    )
  }
  const chipCandidates = [
    { field: 'nickname', label: t('Surnom'), filled: isFilled(getEditValue('nickname', person.nickname)), relevant: true },
    { field: 'birthYear', label: t('Date de naissance'), filled: birthFilled, relevant: true },
    { field: 'birthPlace', label: t('Lieu de naissance'), filled: isFilled(getEditValue('birthPlace', person.birthPlace)), relevant: true },
    { field: 'deathYear', label: t('Date de décès'), filled: deathFilled, relevant: deceasedNow },
    { field: 'deathPlace', label: t('Lieu de décès'), filled: isFilled(getEditValue('deathPlace', person.deathPlace)), relevant: deceasedNow },
    { field: 'birthName', label: t('Nom de naissance'), filled: isFilled(getEditValue('birthName', person.birthName)), relevant: true },
    { field: 'profession', label: t('Métier'), filled: isFilled(getEditValue('profession', person.profession)), relevant: true },
    { field: 'region', label: t('Région'), filled: isFilled(getEditValue('region', person.region)), relevant: true },
    { field: 'nationality', label: t('Nationalité'), filled: isFilled(getEditValue('nationality', person.nationality)), relevant: true },
    { field: 'note', label: t('Notes'), filled: isFilled(getEditValue('note', person.note)), relevant: true },
  ]
  const emptyChips = editMode ? chipCandidates.filter((c) => c.relevant && !c.filled && !openedHas(c.field)) : []

  // Enregistre les modifications de cette fiche (bouton « Enregistrer » et départ de la fiche).
  // Résultat : 'saved', 'unchanged' (rien à enregistrer) ou 'blocked' (validation, ou échec réseau :
  // le message reste sur la fiche, la saisie n'est pas jetée).
  const persistEdits = () => runOnce(saveInFlight, async () => {
    if (!hasChanges || !onSave) return 'unchanged'
    if (!unknownFirstName && 'firstName' in edits && !String(edits.firstName).trim()) {
      setFirstNameMissing(true)
      return 'blocked'
    }
    // Prénom inconnu : il faut alors un nom de famille
    if (unknownFirstName && !String(getEditValue('lastName', person.lastName) ?? '').trim()) {
      setLastNameMissing(true)
      return 'blocked'
    }
    const savedFor = person.id
    setSaving(true)
    setSaveError('')
    try {
      await onSave(savedFor, edits)
      setEditState(prev => (prev.personId === savedFor ? { ...prev, changed: false } : prev))
      setOpenedFields([])
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      return 'saved'
    } catch (error) {
      // Serveur injoignable (status 0, message traduit par le client) ; droits retirés entre-temps (un co-gestionnaire
      // retiré, issue #145) : réessayer ne servirait à rien ; sinon un texte clair, jamais un message technique
      setSaveError(error?.status === 0
        ? error.message
        : error?.status === 403
          ? t("Vous ne pouvez plus modifier cet arbre. Rechargez la page pour voir vos droits actuels.")
          : t("L'enregistrement a échoué. Vos modifications sont gardées, réessayez."))
      return 'blocked'
    } finally {
      setSaving(false)
    }
  })

  // App enregistre la fiche avant de la quitter (changement de personne, fermeture, sortie du mode
  // modification) : la référence suit toujours la dernière version de persistEdits
  useEffect(() => {
    if (!saveOnLeaveRef) return undefined
    saveOnLeaveRef.current = persistEdits
    return () => { if (saveOnLeaveRef.current === persistEdits) saveOnLeaveRef.current = null }
  })

  // Sortie du mode modification : les modifications restantes (abandonnées) ne reviennent pas à la prochaine entrée
  useEffect(() => {
    if (!editMode) setEditState({ personId: person.id, values: {}, changed: false })
  }, [editMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => { persistEdits() }

  const handleDelete = () => {
    if (!onDelete) return
    onDelete(person.id)
  }

  const handleAvatarFileChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !onAvatarUpload) return
    const result = await onAvatarUpload(person.id, file)
    // Juste après l'envoi, la fenêtre de recadrage s'ouvre (« Garder tel quel » laisse la photo entière)
    if (result?.previewUrl) setCropState({ src: result.previewUrl, mode: 'new', ownsUrl: true })
  }

  // Relation actions
  const handleRelationAdd = (targetPerson, relationType) => {
    onAddRelation?.(person.id, targetPerson.id, relationType)
    setActiveRelationSearch(null)
    setRelationSearchQuery('')
  }

  const handleRelationRemove = (targetPersonId, relationType) => {
    onRemoveRelation?.(person.id, targetPersonId, relationType)
  }

  const toYear = (val) => {
    if (val === null || val === undefined) return Number.NaN
    if (Number.isFinite(val)) return Number(val)
    const m = String(val).match(/^(\d{4})/)
    return m ? Number(m[1]) : Number.NaN
  }

  const birthYearNumber = toYear(person.birthYear ?? person.birthDate)
  const deathYearNumber = toYear(person.deathYear ?? person.deathDate)
  const hasBirthYear = Number.isFinite(birthYearNumber)
  const hasDeathYear = Number.isFinite(deathYearNumber)
  const age = hasBirthYear
    ? person.isAlive
      ? new Date().getFullYear() - birthYearNumber
      : hasDeathYear
        ? deathYearNumber - birthYearNumber
        : null
    : null

  const parentsList = getParents(person.id)
  const childrenList = getChildren(person.id)
  const personUnions = getPersonUnions(person.id)
  const childFiliations = filiations
    .filter((f) => String(f.childId) === String(person.id))
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
  const preferredFiliation = (() => {
    if (childFiliations.length === 0) return null

    // Prefer an explicit union-based parentage when present.
    const viaUnion = childFiliations.find((f) => f.unionId && unions.some((u) => String(u.id) === String(f.unionId)))
    if (viaUnion) return viaUnion

    // If multiple parents exist, avoid stale "parent unique" metadata.
    if (parentsList.length > 1) {
      return childFiliations.find((f) => (f.parentageType || 'biologique') === 'biologique') || childFiliations[0]
    }

    return childFiliations[0]
  })()
  const personMedias = getPersonMedias(person.id)
  // Souvenirs des autres où la personne est identifiée : après les siens, ouverts au nom de leur propriétaire
  const taggedMedias = getPersonTaggedMedias(person.id).filter((m) => m.type === 'photo' || m.type === 'video')
  // Filiation d'adoption entre un enfant et un parent (lien direct ou via une union)
  const parentageAdopted = (childId, parentId) => filiations.some((f) => (
    String(f.childId) === String(childId)
    && f.parentageType === 'adoption'
    && (String(f.parentId) === String(parentId) || (f.unionId && personUnions.some((u) => String(u.id) === String(f.unionId))))
  ))
  // Un contributeur voit son choix en attente avant l'envoi ; sinon le lien enregistré
  const parentsAdopted = pendingParentage ? pendingParentage === 'adoption' : filiations.some((f) => String(f.childId) === String(person.id) && f.parentageType === 'adoption')
  const adoptedChildLabel = (child) => {
    if (!parentageAdopted(child.id, person.id)) return null
    return child.sex === 'female' ? t('adoptée') : t('adopté')
  }

  // Frise de vie : la famille vient de l'arbre déjà chargé, les événements de la route /life,
  // demandée seulement à l'ouverture de l'onglet (la démo a ses propres données)
  const siblingsList = (() => {
    const seen = new Map()
    for (const parent of parentsList) {
      for (const child of getChildren(parent.id)) if (child.id !== person.id) seen.set(child.id, child)
    }
    return [...seen.values()]
  })()
  // Ajouter un moment : l'administrateur, et la famille qui peut proposer des souvenirs (relu ensuite).
  // Modifier un moment ou compléter une naissance : l'administrateur. La démo reste en lecture.
  const canAddMoment = Boolean(onUploadMomentFile && treeId && immichToken && (isAdmin || canManageMedia))
  const canEditMoments = canAddMoment && isAdmin
  const lifeFamily = {
    parents: parentsList,
    children: childrenList,
    siblings: siblingsList,
    unions: personUnions.map((union) => ({
      ...union,
      partner: persons.find((p) => p.id === (union.partner1Id === person.id ? union.partner2Id : union.partner1Id)) || null,
      // Enfants du couple : placent dans la frise une union dont la date manque
      childIds: filiations.filter((f) => f.unionId && String(f.unionId) === String(union.id)).map((f) => f.childId),
    })),
  }

  // Filter persons for relation search (exclude current person + already linked)
  const getFilteredPersonsForRelation = (relationType) => {
    const excludeIds = new Set([person.id])

    // Exclude persons already in that relation
    if (relationType === 'parent') {
      parentsList.forEach(p => excludeIds.add(p.id))
    } else if (relationType === 'child') {
      childrenList.forEach(c => excludeIds.add(c.id))
    } else if (relationType === 'spouse') {
      personUnions.forEach(u => {
        excludeIds.add(u.partner1Id === person.id ? u.partner2Id : u.partner1Id)
      })
      // Basic guardrail: never propose direct parent/child as spouse.
      parentsList.forEach(p => excludeIds.add(p.id))
      childrenList.forEach(c => excludeIds.add(c.id))
    }

    return persons.filter(p => {
      if (excludeIds.has(p.id)) return false
      if (!relationSearchQuery) return true
      const fullName = `${p.firstName} ${p.lastName || ''}`.toLowerCase()
      return fullName.includes(relationSearchQuery.toLowerCase())
    })
  }

  const getParentageLabel = () => {
    if (!preferredFiliation) return null
    if (preferredFiliation.unionId) {
      const union = unions.find(u => u.id === preferredFiliation.unionId)
      if (union) {
        const p1 = persons.find(p => p.id === union.partner1Id)
        const p2 = persons.find(p => p.id === union.partner2Id)
        // Union sans type (fréquent après un import GEDCOM) : pas de « (null) » à côté des prénoms
        const kind = union.unionType ? ` (${unionTypeLabel(union.unionType)})` : ''
        return `${p1 ? firstNameLabel(p1) : '?'} + ${p2 ? firstNameLabel(p2) : '?'}${kind}`
      }
    }

    if (preferredFiliation.parentId && parentsList.length <= 1) {
      const parent = persons.find(p => p.id === preferredFiliation.parentId)
      if (preferredFiliation.parentageType === 'inconnu') {
        return t('{name} (parent unique, autre parent inconnu)', { name: parent ? firstNameLabel(parent) : '?' })
      }
      return t('{name} (parent unique)', { name: parent ? firstNameLabel(parent) : '?' })
    }
    return null
  }

  const renderMediaIcon = (media) => {
    if (media.type === 'photo') {
      return media.url
        ? <img src={media.url} alt="" {...blurPlaceholder(media.blurhash)} />
        : <span>&#128247;</span>
    }

    if (media.type === 'video') return <span>&#9654;</span>
    if (media.type === 'audio') return <span>&#9835;</span>
    if (media.type === 'document') return <span>&#128196;</span>
    if (media.type === 'citation') return <span>&laquo;</span>

    if (media.type === 'geojson' || media.type === 'gpx') {
      return <GeoMediaThumbnail media={media} className="person-card-media-thumb" />
    }

    return <span>{media.type?.toUpperCase?.() || '?'}</span>
  }

  // Rendu d'un champ éditable ou lecture seule
  const renderEditableValue = ({ field, value, placeholder, type = 'text', format = null, emptyLabel = '-' }) => {
    if (!editMode) {
      const isEmptyValue = value === null || value === undefined || value === ''
      // Une date complète se lit « 22 octobre 1928 », une année seule « 1928 », pas « 1 janvier 1928 »
      let shown = format ? format(value) : value
      if (type === 'date' && isYearOnly(value)) shown = String(value).slice(0, 4)
      else if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
        shown = new Date(`${String(value).slice(0, 10)}T00:00:00Z`).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      }
      return <span className="value">{isEmptyValue ? emptyLabel : shown}</span>
    }
    if (type === 'date') {
      return (
        <DateField
          key={`${person.id}-${field}`}
          className="pc-input value--editable"
          value={getEditValue(field, value)}
          onChange={(next) => handleFieldChange(field, next)}
        />
      )
    }
    return (
      <input
        type={type}
        className="pc-input value--editable"
        value={getEditValue(field, value)}
        onChange={(e) => handleFieldChange(field, e.target.value)}
        placeholder={placeholder || '...'}
      />
    )
  }

  // Souvenirs regroupés par nature : citation, voix, images, autres
  const quoteMedia = personMedias.find((m) => m.type === 'citation' && m.label)
  const voiceMedias = personMedias.filter((m) => m.type === 'audio')
  const visualMedias = personMedias.filter((m) => m.type === 'photo' || m.type === 'video')
  const otherMedias = personMedias.filter((m) => !['citation', 'audio', 'photo', 'video'].includes(m.type) || (m.type === 'citation' && m !== quoteMedia))

  const initials = initialsOf(person)
  const lifeLine = (() => {
    const born = person.birthYear || (person.birthDate ? String(person.birthDate).slice(0, 4) : '')
    const died = person.deathYear || (person.deathDate ? String(person.deathDate).slice(0, 4) : '')
    const parts = []
    // <bdi> : un lieu en arabe ou en hébreu ne retourne pas l'ordre de la ligne (« 1980, الدار البيضاء · 46 ans »)
    if (born) parts.push(person.birthPlace ? <>{born}, <bdi>{formatPlace(person.birthPlace)}</bdi></> : born)
    if (!person.isAlive) parts.push(died || '?')
    return parts.length ? parts.reduce((line, part) => <>{line} – {part}</>) : null
  })()
  const ageLabel = age === null ? null : person.isAlive ? t('{age} ans', { age }) : t('{age} ans au décès', { age })
  // Une seule ligne sous le nom : surnom, repères de vie, âge, séparés par un point médian
  const metaItems = [
    person.nickname && { key: 'nick', node: <em className="pc-nick"><bdi>{person.nickname}</bdi></em>, nowrap: true },
    lifeLine && { key: 'life', node: lifeLine },
    ageLabel && { key: 'age', node: ageLabel, nowrap: true },
  ].filter(Boolean)

  // removable : un frère ou une sœur passe par ses parents, il ne se retire pas d'ici
  const renderRelationRow = (target, relationType, meta, removable = true) => (
    <div key={`${relationType}-${target?.id}`} className="pc-rel-row">
      <span className="pc-rel-avatar" aria-hidden="true">
        {target?.photo ? <img src={target.photo} alt="" /> : <span>{target?.firstName?.[0] || '?'}</span>}
      </span>
      <span className="pc-rel-name">{target ? fullNameLabel(target) : ''}</span>
      {meta && <span className="pc-rel-meta">{meta}</span>}
      {removable && <button
        type="button"
        className="pz-btn pz-btn--ghost pz-btn--icon pc-rel-remove"
        aria-label={t('Retirer {name}', { name: target ? fullNameLabel(target) : '' })}
        onClick={() => handleRelationRemove(target.id, relationType)}
        disabled={relationActionLoading}
      >
        <X size={15} strokeWidth={2} />
      </button>}
    </div>
  )

  const renderRelationAdd = (relationType, label, placeholder) => (
    activeRelationSearch === relationType ? (
      <RelationSearchInline
        ref={relationSearchRef}
        query={relationSearchQuery}
        onQueryChange={setRelationSearchQuery}
        results={getFilteredPersonsForRelation(relationType)}
        onSelect={(p) => handleRelationAdd(p, relationType)}
        onClose={() => { setActiveRelationSearch(null); setRelationSearchQuery('') }}
        placeholder={placeholder}
        // La recherche ne trouvait que les personnes déjà dans l'arbre : sans résultat, on s'arrêtait là
        onCreate={onCreateRelative ? (query) => { setActiveRelationSearch(null); setRelationSearchQuery(''); onCreateRelative(relationType, query) } : null}
        createLabel={relationType === 'parent' ? t('comme parent') : relationType === 'child' ? t('comme enfant') : t('comme conjoint·e')}
      />
    ) : (
      <button type="button" className="pc-rel-add" onClick={() => setActiveRelationSearch(relationType)} disabled={relationActionLoading}>
        <Plus size={15} strokeWidth={2} />
        {label}
      </button>
    )
  )

  return (
    <div
      ref={cardRef}
      className={`person-card ${editMode ? 'person-card--edit-mode' : ''}`}
      role="dialog"
      aria-label={t('Fiche de {name}', { name: fullNameLabel(person) })}
      style={drag.style}
      data-dragging={drag.dragging || undefined}
      {...drag.bind}
    >
      <span className="pc-grab" aria-hidden="true" />
      <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pc-close" onClick={onClose} aria-label={t('Fermer la fiche')}>
        <X size={18} strokeWidth={2} />
      </button>

      {/* ── En-tête : visage, nom, repères ── */}
      <header className="pc-head">
        <div className="pc-photo-wrap">
          {onAvatarUpload && (
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="pc-hidden-input"
              onChange={handleAvatarFileChange}
              disabled={avatarActionLoading}
            />
          )}
          {/* Hors modification, le portrait se regarde : la photo s'ajoute ou se change en mode modification */}
          {/* Aperçu flou du portrait sur le cadre pendant le chargement (le recadrage s'applique à l'image) */}
          <div className="pc-photo" style={person.photo ? blurPlaceholder(person.avatarBlurhash).style : undefined}>
            {person.photo
              ? <img src={person.photo} alt={fullNameLabel(person)} onLoad={(event) => { event.currentTarget.parentElement.style.backgroundImage = 'none'; setPhotoSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight }) }} style={photoStyle} />
              : <span className="pc-photo-initials">{initials}</span>}
          </div>
          {editMode && onAvatarUpload && (
            <button
              ref={sourceBtnRef}
              type="button"
              className="pc-photo-badge"
              onClick={openPhotoMenu}
              disabled={avatarActionLoading}
              aria-label={t('Changer la photo')}
              title={t('Changer la photo')}
              aria-haspopup="menu"
              aria-expanded={showSourceMenu}
            >
              <Camera size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="pc-id">
          {editMode ? (
            <div className="pc-name-edit">
              <input
                type="text"
                className="pc-input pc-input--name"
                value={getEditValue('firstName', person.firstName)}
                onChange={(e) => {
                  setFirstNameMissing(false)
                  handleFieldChange('firstName', e.target.value)
                }}
                placeholder={t('Prénom')}
                aria-label={t('Prénom')}
                disabled={unknownFirstName}
                aria-invalid={firstNameMissing}
              />
              <input
                type="text"
                className="pc-input pc-input--name pc-input--last"
                value={getEditValue('lastName', person.lastName)}
                onChange={(e) => {
                  setLastNameMissing(false)
                  handleFieldChange('lastName', e.target.value)
                }}
                placeholder={t('Nom')}
                aria-label={t('Nom')}
              />
              {firstNameMissing && <p className="pc-name-error">{t('Il faut au moins un prénom.')}</p>}
              {lastNameMissing && <p className="pc-name-error">{t('Il faut au moins un nom si le prénom est inconnu.')}</p>}
            </div>
          ) : (
            <h2 className="pc-name">
              {isFirstNameUnknown(person) ? <span className="pc-name-unknown">{firstNameLabel(person)}</span> : person.firstName}
              {person.lastName && <>{' '}<em>{person.lastName}</em></>}
            </h2>
          )}
          {!editMode && metaItems.length > 0 && (
            <p className="pc-meta">
              {metaItems.map((item, i) => (
                <span key={item.key} className={`pc-meta-item${item.nowrap ? ' pc-meta-item--nowrap' : ''}`}>
                  {item.node}
                  {i < metaItems.length - 1 && <span className="pc-meta-sep" aria-hidden="true">·</span>}
                </span>
              ))}
            </p>
          )}
          <div className="pc-chips">
            {editMode && siblingPlace && (
              <span className="pz-tag pc-order" role="group" aria-label={t('Place {n} sur {total} parmi les frères et sœurs', { n: siblingPlace.index + 1, total: siblingPlace.count })}>
                <button type="button" className="pc-order-btn" onClick={() => onMoveSibling?.(-1)} disabled={siblingPlace.index === 0} aria-label={t('Déplacer à gauche')} title={t('Déplacer à gauche')}>
                  <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
                </button>
                <span className="pc-order-label" aria-hidden="true">{siblingPlace.index + 1}/{siblingPlace.count}</span>
                <button type="button" className="pc-order-btn" onClick={() => onMoveSibling?.(1)} disabled={siblingPlace.index === siblingPlace.count - 1} aria-label={t('Déplacer à droite')} title={t('Déplacer à droite')}>
                  <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            )}
            {!editMode && person.toVerify && <span className="pz-tag pz-tag--accent pz-tag--dot">{t('À vérifier')}</span>}
            {!editMode && person.profession && <span className="pz-tag">{person.profession}</span>}
            {!editMode && onQuickEdit && (
              <button type="button" className="pc-quick-edit" onClick={() => { setTab('infos'); onQuickEdit() }}>
                <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                {t('Modifier')}
              </button>
            )}
          </div>
        </div>
        {editMode && ((unknownFirstName || !String(getEditValue('firstName', person.firstName) ?? '').trim())) && (
          <label className="pc-unknown-first">
            <input
              type="checkbox"
              checked={unknownFirstName}
              onChange={(e) => {
                setUnknownFirstName(e.target.checked)
                setFirstNameMissing(false)
                setLastNameMissing(false)
                handleFieldChange('firstName', '')
              }}
            />
            {t('Je ne connais pas son prénom')}
          </label>
        )}
      </header>
      {!editMode && proposal && <ProposalBanner patch={proposal} review={proposalReview} />}

      {avatarActionError && <div className="pz-error pc-inline-msg">{avatarActionError}</div>}

      {/* ── Onglets ── */}
      <div className="pz-tabs pc-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'medias'} className="pz-tab" onClick={() => setTab('medias')}>
          {t('Souvenirs')}{personMedias.length > 0 ? ` · ${personMedias.length}` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'vie'} className="pz-tab" onClick={() => setTab('vie')}>
          {t('Vie')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'infos'} className="pz-tab" onClick={() => setTab('infos')}>
          {t('Infos')}
        </button>
        {editMode && (
          <button type="button" role="tab" aria-selected={tab === 'relations'} className="pz-tab" onClick={() => setTab('relations')}>
            {t('Liens')}
          </button>
        )}
      </div>

      <div className="pc-body">
        {/* ── Souvenirs ── */}
        {tab === 'medias' && (
          <div className="pc-souvenirs">
            {personMedias.length === 0 && taggedMedias.length === 0 && (
              <div className="pc-empty">
                <p className="pz-sub">{t('Pas encore de souvenir pour {name}.', { name: firstNameLabel(person) })}</p>
                <p className="pz-small">{canManageMedia ? t('Une photo, une anecdote, sa voix. Vous pouvez ajouter le premier.') : t('Une photo, une anecdote, sa voix.')}</p>
              </div>
            )}

            {quoteMedia && (
              <button type="button" className="pc-quote" onClick={() => onMediaSelect?.(quoteMedia, person)}>
                « {quoteMedia.label} »
                {quoteMedia.source && <small>{quoteMedia.source}</small>}
              </button>
            )}

            {voiceMedias.map((media) => (
              <button key={media.id} type="button" className="pc-voice" onClick={() => onMediaSelect?.(media, person)}>
                <span className="pc-voice-play" aria-hidden="true"><Play size={13} fill="currentColor" strokeWidth={0} /></span>
                <span className="pc-voice-wave" aria-hidden="true">{VOICE_WAVE.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
                <span className="pc-voice-label">{media.label || t('Enregistrement')}</span>
              </button>
            ))}

            {visualMedias.length > 0 && (
              <div className="pc-grid">
                {visualMedias.map((media) => (
                  <button
                    key={media.id}
                    type="button"
                    className={`pc-tile pc-tile--${media.type}`}
                    onClick={(e) => { rememberOrigin(e.currentTarget); onMediaSelect?.(media, person) }}
                    title={media.label || TYPE_LABELS[media.type]}
                  >
                    {media.type === 'photo' && media.url
                      ? <img src={media.url} alt={media.label || ''} loading="lazy" {...blurPlaceholder(media.blurhash)} />
                      : <span className="pc-tile-video"><Play size={18} fill="currentColor" strokeWidth={0} /></span>}
                    {media.label && <span className="pc-tile-label">{media.label}</span>}
                  </button>
                ))}
                {canManageMedia && (
                  <button type="button" className="pc-tile pc-tile--add" onClick={() => onManageMedia?.()} aria-label={t('Ajouter des souvenirs')}>
                    <Plus size={20} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            )}

            {taggedMedias.length > 0 && (
              <section className="pc-tagged" aria-label={t('Avec {name}', { name: firstNameLabel(person) })}>
                <h3 className="pc-tagged-title">{t('Avec {name}', { name: firstNameLabel(person) })}</h3>
                <div className="pc-grid">
                  {taggedMedias.map((media) => {
                    const owner = getPersonById(media.personId)
                    return (
                      <button
                        key={media.id}
                        type="button"
                        className={`pc-tile pc-tile--${media.type}`}
                        onClick={(e) => { if (!owner) return; rememberOrigin(e.currentTarget); onMediaSelect?.(media, owner) }}
                        title={media.label || TYPE_LABELS[media.type]}
                      >
                        {media.type === 'photo' && media.url
                          ? <img src={media.url} alt={media.label || ''} loading="lazy" {...blurPlaceholder(media.blurhash)} />
                          : <span className="pc-tile-video"><Play size={18} fill="currentColor" strokeWidth={0} /></span>}
                        {media.label && <span className="pc-tile-label">{media.label}</span>}
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {otherMedias.length > 0 && (
              <div className="pc-list">
                {otherMedias.map((media) => (
                  <button key={media.id} type="button" className="pc-list-item" onClick={() => onMediaSelect?.(media, person)}>
                    <span className={`pc-list-icon pc-list-icon--${media.type}`}>{renderMediaIcon(media)}</span>
                    <span className="pc-list-text">
                      <span className="pc-list-label">{media.label || TYPE_LABELS[media.type]}</span>
                      <span className="pc-list-type">{TYPE_LABELS[media.type] || media.type}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {canManageMedia && (
              <button type="button" className={`pz-btn pz-btn--block ${isAdmin ? 'pz-btn--soft' : 'pz-btn--primary'}`} onClick={() => onManageMedia?.()}>
                <Plus size={16} strokeWidth={2} />
                {isAdmin ? t('Ajouter ou ranger des souvenirs') : t('Ajouter un souvenir')}
              </button>
            )}
          </div>
        )}

        {/* ── Vie ── */}
        {tab === 'vie' && (
          <LifeTimeline
            person={person}
            family={lifeFamily}
            life={lifeState.personId === person.id ? lifeState.data : null}
            loading={lifeState.personId !== person.id || lifeState.loading}
            failed={lifeState.personId === person.id && lifeState.failed}
            medias={personMedias}
            canAdd={canAddMoment}
            canEdit={canEditMoments}
            notice={lifeNotice}
            onAdd={() => { setLifeNotice(''); setMomentSheet({ entry: null }) }}
            onEdit={(entry) => { setLifeNotice(''); setMomentSheet({ entry }) }}
            onOpenMedia={(media) => onMediaSelect?.(media, person)}
          />
        )}

        {/* ── Infos ── */}
        {tab === 'infos' && (
          <div className="pc-infos" ref={bodyRef}>
            <section className="pc-section">
              <h3 className="pz-eyebrow">{t('État civil')}</h3>
              <div className="pc-rows">
                {infoRow('birthYear', t('Naissance'), birthFilled, renderEditableValue({ field: 'birthYear', value: person.birthDate || person.birthYear, placeholder: t('Date de naissance'), type: 'date' }), true)}
                {infoRow('birthPlace', t('Lieu'), isFilled(getEditValue('birthPlace', person.birthPlace)), renderEditableValue({ field: 'birthPlace', value: person.birthPlace || '', placeholder: t('Lieu de naissance'), format: formatPlace }))}
                {infoRow('birthName', t('Nom de naissance'), isFilled(getEditValue('birthName', person.birthName)), renderEditableValue({ field: 'birthName', value: person.birthName || '', placeholder: t('Nom de naissance') }))}
                {infoRow('nickname', t('Surnom'), isFilled(getEditValue('nickname', person.nickname)), renderEditableValue({ field: 'nickname', value: person.nickname || '', placeholder: t('Surnom') }))}
                {editMode && (
                  <div className="pc-row pc-row--seg" data-pc-field="sex">
                    <span className="pc-label" id="pc-sex-label">{t('Sexe')}</span>
                    <div className="pz-tabs pc-seg" role="group" aria-labelledby="pc-sex-label">
                      {SEX_CHOICES.map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={editSex === value}
                          className={`pz-tab ${editSex === value ? 'is-active' : ''}`}
                          onClick={() => handleFieldChange('sex', editSex === value ? null : value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {editMode && (
                  <div className="pc-row">
                    <span className="pc-label">{t('Statut')}</span>
                    <button
                      type="button"
                      className={`pc-alive ${getEditValue('isAlive', person.isAlive) ? 'is-alive' : 'is-deceased'}`}
                      onClick={() => handleFieldChange('isAlive', !getEditValue('isAlive', person.isAlive))}
                    >
                      <span className="pc-alive-dot" />
                      {getEditValue('isAlive', person.isAlive) ? t('En vie') : editSex === 'male' ? t('Décédé') : editSex === 'female' ? t('Décédée') : t('Décédé(e)')}
                    </button>
                  </div>
                )}
                {editMode && (
                  // La famille n'est pas sûre de cette personne : marquée sur l'arbre et dans la fiche (retour d'Anaïs, 23/10)
                  <div className="pc-row">
                    <span className="pc-label">{t('Vérification')}</span>
                    <button
                      type="button"
                      aria-pressed={Boolean(getEditValue('toVerify', person.toVerify))}
                      className={`pc-alive pc-verify ${getEditValue('toVerify', person.toVerify) ? 'is-on' : ''}`}
                      onClick={() => handleFieldChange('toVerify', !getEditValue('toVerify', person.toVerify))}
                    >
                      <span className="pc-alive-dot" />
                      {t('À vérifier')}
                    </button>
                  </div>
                )}
                {infoRow('deathYear', t('Décès'), deathFilled, renderEditableValue({ field: 'deathYear', value: person.deathDate || person.deathYear || '', placeholder: t('Date de décès'), type: 'date', emptyLabel: t('Date inconnue') }), deceasedNow)}
                {infoRow('deathPlace', t('Lieu de décès'), isFilled(getEditValue('deathPlace', person.deathPlace)), renderEditableValue({ field: 'deathPlace', value: person.deathPlace || '', placeholder: t('Lieu de décès'), format: formatPlace }))}
                {!editMode && (
                  <div className="pc-row">
                    <span className="pc-label">{t('Âge')}</span>
                    <span className="value">{ageLabel || '-'}</span>
                  </div>
                )}
                {infoRow('region', t('Région'), isFilled(getEditValue('region', person.region)), renderEditableValue({ field: 'region', value: person.region || '', placeholder: t('Région') }))}
                {infoRow('nationality', t('Nationalité'), isFilled(getEditValue('nationality', person.nationality)), renderEditableValue({ field: 'nationality', value: person.nationality || '', placeholder: t('Nationalité') }))}
                {infoRow('profession', t('Métier'), isFilled(getEditValue('profession', person.profession)), renderEditableValue({ field: 'profession', value: person.profession || '', placeholder: t('Métier') }))}
              </div>
              {/* Modification : une pastille par champ vide, qui ouvre le champ à sa place */}
              {editMode && emptyChips.length > 0 && (
                <div className="pc-fill-chips">
                  {emptyChips.map((chip) => (
                    <button key={chip.field} type="button" className="pc-fill-chip" onClick={() => openField(chip.field)}>
                      + {chip.label}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {!editMode && (parentsList.length > 0 || personUnions.length > 0 || childrenList.length > 0) && (
              <section className="pc-section">
                <h3 className="pz-eyebrow">{t('Famille')}</h3>
                <div className="pc-rows">
                  {parentsList.length > 0 && (
                    <div className="pc-row">
                      <span className="pc-label">{t('Parents')}</span>
                      <span className="value">{getParentageLabel() || parentsList.map(p => fullNameLabel(p)).join(t(' et '))}</span>
                    </div>
                  )}
                  {preferredFiliation && preferredFiliation.parentageType !== 'biologique' && parentsList.length <= 1 && (
                    <div className="pc-row">
                      <span className="pc-label">{t('Filiation')}</span>
                      <span className="value">{preferredFiliation.parentageType === 'adoption' ? t('Adoption') : t('Parent inconnu')}</span>
                    </div>
                  )}
                  {personUnions.length > 0 && (
                    <div className="pc-row">
                      <span className="pc-label">{personUnions.length > 1 ? t('Unions') : t('Union')}</span>
                      <span className="value">
                        {personUnions.map(u => {
                          const partnerId = u.partner1Id === person.id ? u.partner2Id : u.partner1Id
                          const partner = persons.find(p => p.id === partnerId)
                          const yearRange = u.startYear ? (u.endYear ? `${u.startYear}–${u.endYear}` : t('depuis {year}', { year: u.startYear })) : ''
                          return `${partner ? firstNameLabel(partner) : '?'} ${partner?.lastName || ''}${yearRange ? ` (${yearRange})` : ''}`
                        }).join(', ')}
                      </span>
                    </div>
                  )}
                  {childrenList.length > 0 && (
                    <div className="pc-row">
                      <span className="pc-label">{t('Enfants')}</span>
                      <span className="value">{childrenList.map(c => firstNameLabel(c)).join(', ')}</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Ajouter un proche sans passer par « Modifier » puis l'onglet Relations (1.5.1) */}
            {!editMode && onCreateRelative && (
              // Les mêmes pastilles que « + Surnom », « + Métier » en modification (Patch, 26/10)
              <div className="pc-fill-chips pc-quick-add" role="group" aria-label={t('Ajouter un proche')}>
                <button type="button" className="pc-fill-chip" onClick={() => onCreateRelative('parent', '')}>+ {t('Parent')}</button>
                <button type="button" className="pc-fill-chip" onClick={() => onCreateRelative('spouse', '')}>+ {t('Conjoint·e')}</button>
                <button type="button" className="pc-fill-chip" onClick={() => onCreateRelative('child', '')}>+ {t('Enfant')}</button>
                {parentsList.length > 0 && (
                  <button type="button" className="pc-fill-chip" onClick={() => onCreateRelative('sibling', '')}>+ {t('Frère ou sœur')}</button>
                )}
              </div>
            )}

            {(editMode ? notesShown : person.note) && (
              <section className="pc-section" data-pc-field="note">
                <h3 className="pz-eyebrow">{t('Notes')}</h3>
                {editMode ? (
                  <textarea
                    className="pc-input pc-note-input"
                    value={getEditValue('note', person.note || '')}
                    onChange={(e) => handleFieldChange('note', e.target.value)}
                    placeholder={t("Une anecdote, un trait de caractère, ce qu'on se raconte à son sujet")}
                    rows={3}
                  />
                ) : (
                  <p className="pc-note">{person.note}</p>
                )}
              </section>
            )}
          </div>
        )}

        {/* ── Liens (édition) ── */}
        {tab === 'relations' && editMode && (
          <div className="pc-infos">
            {(relationActionLoading || relationActionSuccess || relationActionError) && (
              <div className={relationActionError ? 'pz-error pc-inline-msg' : relationActionSuccess ? 'pz-success pc-inline-msg' : 'pc-inline-msg pc-inline-msg--loading'}>
                {relationActionLoading ? t('Mise à jour des liens…') : relationActionError || relationActionSuccess}
              </div>
            )}

            <section className="pc-section">
              <div className="pc-section-head">
                <h3 className="pz-eyebrow">{t('Parents')}</h3>
                {parentsAdopted && parentsList.length > 0 && <span className="pc-adopt-tag">{t('Parents adoptifs')}</span>}
              </div>
              {parentsList.length > 0 ? parentsList.map(p => renderRelationRow(p, 'parent')) : <p className="pc-rel-empty">{t("Aucun parent pour l'instant")}</p>}
              {renderRelationAdd('parent', t('Ajouter un parent'), t('Rechercher un parent'))}
              {parentsList.length > 0 && (
                <div className="pc-parentage">
                  <span className="pc-label">{t('Lien avec ses parents')}</span>
                  <div className="pz-tabs pc-seg" role="radiogroup" aria-label={t('Lien avec ses parents')}>
                    <button type="button" role="radio" aria-checked={!parentsAdopted} className={`pz-tab ${!parentsAdopted ? 'is-active' : ''}`} onClick={() => onSetParentage?.(person.id, 'biologique')}>{t('Naissance')}</button>
                    <button type="button" role="radio" aria-checked={parentsAdopted} className={`pz-tab ${parentsAdopted ? 'is-active' : ''}`} onClick={() => onSetParentage?.(person.id, 'adoption')}>{t('Adoption')}</button>
                  </div>
                </div>
              )}
            </section>

            <section className="pc-section">
              <h3 className="pz-eyebrow">{t('Conjoint·e·s')}</h3>
              {personUnions.length > 0 ? personUnions.map(u => {
                const partnerId = u.partner1Id === person.id ? u.partner2Id : u.partner1Id
                const partner = persons.find(p => p.id === partnerId)
                return renderRelationRow(partner || { id: partnerId, firstName: '?' }, 'spouse', unionTypeLabel(u.unionType))
              }) : <p className="pc-rel-empty">{t('Aucun·e conjoint·e')}</p>}
              {renderRelationAdd('spouse', t('Ajouter un·e conjoint·e'), t('Rechercher un·e conjoint·e'))}
            </section>

            <section className="pc-section">
              <h3 className="pz-eyebrow">{t('Enfants')}</h3>
              {childrenList.length > 0 ? childrenList.map(c => renderRelationRow(c, 'child', adoptedChildLabel(c))) : <p className="pc-rel-empty">{t('Aucun enfant')}</p>}
              {renderRelationAdd('child', t('Ajouter un enfant'), t('Rechercher un enfant'))}
            </section>

            {onCreateRelative && (
              <section className="pc-section">
                <h3 className="pz-eyebrow">{t('Frères et sœurs')}</h3>
                {siblingsList.length > 0
                  ? siblingsList.map(c => renderRelationRow(c, 'sibling', null, false))
                  : <p className="pc-rel-empty">{t('Aucun frère ni sœur')}</p>}
                {/* Un frère ou une sœur reçoit les mêmes parents : sans parent, on le dit avant d'ouvrir l'ajout */}
                {parentsList.length > 0 ? (
                  <button type="button" className="pc-rel-add" onClick={() => onCreateRelative('sibling', '')}>
                    <Plus size={15} strokeWidth={2} />
                    {t('Ajouter un frère ou une sœur')}
                  </button>
                ) : (
                  <p className="pc-rel-empty">{t("Ajoutez d'abord un parent pour lui rattacher un frère ou une sœur.")}</p>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* ── Actions d'édition ── */}
      {editMode && saveError && <p className="pc-save-error" role="alert">{saveError}</p>}
      {editMode && (
        <footer className="pc-foot">
          {isAdmin && (
            <button type="button" className="pz-btn pz-btn--danger-ghost pz-btn--sm" onClick={handleDelete}>
              <Trash2 size={15} strokeWidth={2} />
              {t('Supprimer')}
            </button>
          )}
          <button
            type="button"
            className={`pz-btn pz-btn--primary pc-save ${saveSuccess ? 'is-saved' : ''}`}
            disabled={(!hasChanges && !saveSuccess) || saving}
            onClick={handleSave}
          >
            {saveSuccess ? (<><Check size={16} strokeWidth={2.5} />{t('Enregistré')}</>) : (<PzBusy busy={saving} busyLabel={t('Enregistrement en cours')}><Save size={16} strokeWidth={2} />{t('Enregistrer')}</PzBusy>)}
          </button>
        </footer>
      )}

      {/* ── Choix de la source du portrait (menu contextuel) ── */}
      {showSourceMenu && (
        createPortal(
          <>
            <div className="pc-source-backdrop" onClick={() => setShowSourceMenu(false)} />
            <div className="pc-source-menu pz-menu" role="menu" aria-label={t('Source du portrait')} style={{ top: `${sourceMenuPos.top}px`, left: `${sourceMenuPos.left}px` }}>
              <button type="button" role="menuitem" className="pz-menu-item" onClick={chooseFileSource}>
                <ImagePlus size={16} aria-hidden="true" /> {t('Depuis un fichier')}
              </button>
              <button type="button" role="menuitem" className="pz-menu-item" onClick={chooseImmichSource}>
                <Sparkles size={16} aria-hidden="true" /> {t('Depuis Immich')}
              </button>
            </div>
          </>,
          document.body,
        )
      )}

      {/* ── Menu du badge : changer, recadrer, retirer ── */}
      {photoMenuPos && (
        createPortal(
          <>
            <div className="pc-source-backdrop" onClick={() => setPhotoMenuPos(null)} />
            <div className="pc-source-menu pz-menu" role="menu" aria-label={t('Options du portrait')} style={{ top: `${photoMenuPos.top}px`, left: `${photoMenuPos.left}px` }}>
              <button type="button" role="menuitem" className="pz-menu-item" onClick={() => { setPhotoMenuPos(null); openAvatarPicker() }}>
                <ImagePlus size={16} aria-hidden="true" /> {t('Changer la photo')}
              </button>
              {person.photo && !person.avatarFromImmich && onAvatarCrop && (
                <button type="button" role="menuitem" className="pz-menu-item" onClick={() => { setPhotoMenuPos(null); setCropState({ src: person.photo, mode: 'recrop', ownsUrl: false }) }}>
                  <Crop size={16} aria-hidden="true" /> {t('Recadrer')}
                </button>
              )}
              {person.photo && (
                <button type="button" role="menuitem" className="pz-menu-item pz-menu-item--danger" onClick={() => { setPhotoMenuPos(null); onAvatarDelete?.(person.id, person.avatarFromImmich) }} disabled={avatarActionLoading}>
                  <Trash2 size={16} aria-hidden="true" /> {t('Retirer')}
                </button>
              )}
            </div>
          </>,
          document.body,
        )
      )}

      {/* ── Recadrage du portrait (fenêtre pz) ── */}
      {cropState && onAvatarCrop && (
        <PortraitCropModal
          src={cropState.src}
          frameType={treeFrameType}
          name={fullNameLabel(person)}
          mode={cropState.mode}
          initialCrop={cropState.mode === 'new' ? null : person.avatarCrop}
          saving={avatarActionLoading}
          error={avatarActionError}
          onSave={async (crop) => {
            const saved = await onAvatarCrop(person.id, crop)
            if (saved) closeCrop()
          }}
          onClose={closeCrop}
        />
      )}

      {/* ── Association d'un visage Immich (modale) ── */}
      {showImmichPanel && treeId && (
        <ImmichFacePanel
          person={person}
          treeId={treeId}
          token={immichToken}
          onClose={() => setShowImmichPanel(false)}
          onImmichChange={onImmichChange}
        />
      )}

      {/* ── Ajouter ou modifier un moment de l'onglet Vie (modale) ── */}
      {momentSheet && canAddMoment && (
        <MomentSheet
          person={person}
          entry={momentSheet.entry}
          treeId={treeId}
          token={immichToken}
          medias={personMedias}
          isAdmin={canEditMoments}
          onUploadFile={onUploadMomentFile}
          onClose={() => setMomentSheet(null)}
          onDelete={onUndoable && treeId && immichToken ? (event) => {
            // Le moment quitte la frise tout de suite ; la requête part à la fin du délai d'annulation
            setMomentSheet(null)
            setLifeState((prev) => (prev.data?.events ? { ...prev, data: { ...prev.data, events: prev.data.events.filter((e) => e.id !== event.id) } } : prev))
            onUndoable({
              message: t('Le moment est supprimé.'),
              commit: async ({ keepalive = false } = {}) => {
                try {
                  await deleteLifeEvent(treeId, event.id, immichToken, { keepalive })
                } catch {
                  if (keepalive) return
                  setLifeRevision((r) => r + 1)
                  setLifeNotice(t('La suppression n’a pas abouti. Réessayez dans un instant.'))
                }
              },
              undo: () => setLifeRevision((r) => r + 1),
            })
          } : undefined}
          onSaved={({ pending, uploaded }) => {
            setMomentSheet(null)
            if (pending) setLifeNotice(t('Merci, c’est envoyé. Le moment apparaîtra dans sa vie quand la personne qui gère l’arbre l’aura accepté.'))
            // Nouveaux souvenirs : la fiche les recharge, puis la frise se relit
            if (uploaded && !pending) onMomentSaved?.(person.id)
            setLifeRevision((r) => r + 1)
          }}
        />
      )}
    </div>
  )
}

/**
 * Recherche en ligne pour ajouter un lien (parent, conjoint·e, enfant)
 */
const RelationSearchInline = forwardRef(function RelationSearchInline(
  { query, onQueryChange, results, onSelect, onClose, placeholder, onCreate = null, createLabel = '' },
  ref
) {
  const filtered = results.slice(0, 6)

  return (
    <div className="relation-search-inline pc-search">
      <div className="pc-search-field">
        <Search size={15} strokeWidth={2} className="pc-search-icon" />
        <input
          ref={ref}
          type="text"
          className="pc-search-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              onClose()
            }
          }}
        />
        <button type="button" className="pz-btn pz-btn--ghost pz-btn--icon pc-search-close" onClick={onClose} aria-label={t('Fermer la recherche')}>
          <X size={15} strokeWidth={2} />
        </button>
      </div>
      {filtered.length > 0 ? (
        <ul className="pc-search-list">
          {filtered.map((p) => (
            <li key={p.id}>
              <button type="button" className="pc-search-item" onClick={() => onSelect(p)}>
                <span className="pc-rel-avatar" aria-hidden="true">
                  {p.photo ? <img src={p.photo} alt="" /> : <span>{p.firstName[0]}</span>}
                </span>
                <span className="pc-rel-name">{firstNameLabel(p)} <em>{p.lastName || ''}</em></span>
                {p.birthYear && <span className="pc-rel-meta">{p.birthYear}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : query && !onCreate ? (
        <p className="pc-rel-empty">{t('Aucune personne ne correspond')}</p>
      ) : null}
      {onCreate && query.trim() && (
        <button type="button" className="pc-search-item pc-search-create" onClick={() => onCreate(query.trim())}>
          <span className="pc-rel-avatar" aria-hidden="true"><Plus size={14} strokeWidth={2.2} /></span>
          <span className="pc-rel-name">{t('Créer « {name} »', { name: query.trim() })} <em>{createLabel}</em></span>
        </button>
      )}
    </div>
  )
})

export default PersonCard
