import { useState, useEffect, useCallback, useRef } from 'react'

const DRAFT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 jours

/**
 * Hook pour gérer le mode édition avec auto-save
 *
 * Features:
 * - Active/désactive le mode édition
 * - Auto-save drafts dans localStorage toutes les 15s
 * - Restore drafts au chargement (si < 7 jours)
 * - Clear drafts au save ou cancel
 * - Timestamp du dernier save pour affichage
 *
 * @param {Object} options
 * @param {string} options.treeId - ID de l'arbre en cours
 * @param {boolean} options.canEdit - L'utilisateur peut-il éditer
 * @returns {Object} API du mode édition
 */
export function useEditMode({ treeId, canEdit }) {
  const [isActive, setIsActive] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [draftTimestamp, setDraftTimestamp] = useState(null)
  const autoSaveTimerRef = useRef(null)
  const draftDataRef = useRef({})

  // Storage key pour localStorage
  const getDraftKey = useCallback(() => {
    return `edit-draft-${treeId}`
  }, [treeId])

  // Charger draft existant au mount (avec vérification expiry 7 jours)
  useEffect(() => {
    if (!treeId) return

    try {
      const stored = localStorage.getItem(getDraftKey())
      if (stored) {
        const draft = JSON.parse(stored)
        const age = Date.now() - (draft.timestamp || 0)

        if (age > DRAFT_EXPIRY_MS) {
          // Draft expiré, le supprimer
          localStorage.removeItem(getDraftKey())
          return
        }

        draftDataRef.current = draft
        setHasDraft(true)
        setDraftTimestamp(draft.timestamp || null)
      }
    } catch (err) {
      console.error('Failed to load draft:', err)
    }
  }, [treeId, getDraftKey])

  // Clear auto-save timer au unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current)
      }
    }
  }, [])

  // Auto-save toutes les 15s quand mode édition actif
  useEffect(() => {
    if (isActive && treeId) {
      const interval = setInterval(() => {
        saveDraftInternal()
      }, 15000)

      autoSaveTimerRef.current = interval

      return () => clearInterval(interval)
    } else {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [isActive, treeId]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Save draft dans localStorage (interne, stable ref)
   */
  const saveDraftInternal = () => {
    if (!treeId) return

    try {
      const now = Date.now()
      const draft = {
        ...draftDataRef.current,
        timestamp: now,
      }

      localStorage.setItem(getDraftKey(), JSON.stringify(draft))
      setHasDraft(true)
      setDraftTimestamp(now)
    } catch (err) {
      console.error('Failed to save draft:', err)
    }
  }

  /**
   * Active le mode édition
   */
  const activate = useCallback(() => {
    if (!canEdit) {
      console.warn('Cannot activate edit mode: user lacks edit permission')
      return
    }
    setIsActive(true)
  }, [canEdit])

  /**
   * Désactive le mode édition (sans confirmation - c'est au caller de gérer)
   */
  const deactivate = useCallback(() => {
    setIsActive(false)
  }, [])

  /**
   * Toggle le mode édition
   * Retourne true si l'activation a eu lieu, false si désactivé ou bloqué
   */
  const toggle = useCallback(() => {
    if (isActive) {
      deactivate()
      return false
    } else {
      activate()
      return true
    }
  }, [isActive, activate, deactivate])

  /**
   * Save draft dans localStorage (public API)
   */
  const saveDraft = useCallback(() => {
    saveDraftInternal()
  }, [treeId, getDraftKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Update draft data (merge)
   */
  const updateDraft = useCallback((data) => {
    draftDataRef.current = {
      ...draftDataRef.current,
      ...data,
    }
    // Considérer qu'il y a désormais un draft actif (permet le bouton "Mettre à jour l'arbre")
    setHasDraft(true)
  }, [])

  /**
   * Clear draft (après save réussi ou cancel)
   */
  const clearDraft = useCallback(() => {
    if (!treeId) return

    try {
      localStorage.removeItem(getDraftKey())
      draftDataRef.current = {}
      setHasDraft(false)
      setDraftTimestamp(null)
    } catch (err) {
      console.error('Failed to clear draft:', err)
    }
  }, [treeId, getDraftKey])

  /**
   * Restore draft data
   */
  const restoreDraft = useCallback(() => {
    return { ...draftDataRef.current }
  }, [])

  return {
    // État
    isActive,
    hasDraft,
    draftTimestamp,

    // Actions
    activate,
    deactivate,
    toggle,

    // Draft management
    saveDraft,
    updateDraft,
    clearDraft,
    restoreDraft,
  }
}
