import { useEffect, useState } from 'react'
import {
  listContributionSessions,
  submitContributionSession,
  reviewContributionSession,
  batchAnnotations,
} from '../api/treeApi'
import { getAccountErrorMessage } from '../utils/errorMessages'
import { t } from '../i18n/index.js'

const EMPTY_CONTRIB_STATE = {
  visible: false,
  loading: false,
  error: '',
  submitLoading: false,
  submitError: '',
  sessions: [],
  reviewingSessionId: '',
}

export function useContributions({ canEditCurrentTree, canSubmitContribution, treeContext, refreshCurrentTreeGraph }) {
  const [contribState, setContribState] = useState({ ...EMPTY_CONTRIB_STATE })

  // Pastille « Propositions à relire » : le compte se charge dès que le propriétaire ouvre son arbre, et se
  // remet à jour quand il revient sur l'onglet, sans attendre qu'il ouvre le panneau des propositions
  const { treeId, accessToken } = treeContext
  useEffect(() => {
    if (!canEditCurrentTree || !treeId || !accessToken) return undefined
    let cancelled = false
    const load = async () => {
      try {
        const sessions = await listContributionSessions(treeId, accessToken, 'pending')
        if (!cancelled) setContribState((current) => ({ ...current, sessions }))
      } catch {
        // Le panneau affichera l'erreur s'il est ouvert ; la pastille reste telle quelle
      }
    }
    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible) }
  }, [canEditCurrentTree, treeId, accessToken])

  const resetContribState = () => {
    setContribState({ ...EMPTY_CONTRIB_STATE })
  }

  const refreshContributionSessions = async () => {
    if (!canEditCurrentTree || !treeContext.treeId || !treeContext.accessToken) {
      setContribState((current) => ({
        ...current,
        loading: false,
        error: '',
        sessions: [],
      }))
      return
    }

    setContribState((current) => ({
      ...current,
      loading: true,
      error: '',
    }))

    try {
      const sessions = await listContributionSessions(treeContext.treeId, treeContext.accessToken, 'pending')
      setContribState((current) => ({
        ...current,
        loading: false,
        sessions,
      }))
    } catch (error) {
      setContribState((current) => ({
        ...current,
        loading: false,
        error: getAccountErrorMessage(error),
      }))
    }
  }

  const handleOpenContributionPanel = async () => {
    if (!canEditCurrentTree) {
      return
    }

    setContribState((current) => ({
      ...current,
      visible: true,
      submitError: '',
      error: '',
    }))

    if (canEditCurrentTree) {
      await refreshContributionSessions()
    }
  }

  const handleCloseContributionPanel = () => {
    setContribState((current) => ({
      ...current,
      visible: false,
      submitError: '',
      error: '',
      reviewingSessionId: '',
    }))
  }

  const handleSubmitContributionSession = async (payload) => {
    if (!treeContext.treeId || !treeContext.accessToken || !canSubmitContribution) {
      return { ok: false, error: t('Soumission non autorisée.') }
    }

    setContribState((current) => ({
      ...current,
      submitLoading: true,
      submitError: '',
    }))

    try {
      const result = await submitContributionSession(treeContext.treeId, payload, treeContext.accessToken)

      if (result?.session?.status === 'approved') {
        await refreshCurrentTreeGraph()
      }

      setContribState((current) => ({
        ...current,
        submitLoading: false,
        submitError: '',
      }))

      if (canEditCurrentTree) {
        await refreshContributionSessions()
      }
      return { ok: true }
    } catch (error) {
      const message = getAccountErrorMessage(error)
      setContribState((current) => ({
        ...current,
        submitLoading: false,
        submitError: message,
      }))
      return { ok: false, error: message }
    }
  }

  const handleSubmitContributionCreatePerson = async (payload) => {
    await handleSubmitContributionSession({
      title: payload.title,
      changes: [
        {
          entityType: 'person',
          action: 'create',
          after: {
            firstName: payload.firstName,
            lastName: payload.lastName,
            birthDate: payload.birthDate || null,
          },
        },
      ],
    })
  }

  const handleSubmitContributionUpdatePerson = async (payload) => {
    await handleSubmitContributionSession({
      title: payload.title,
      changes: [
        {
          entityType: 'person',
          action: 'update',
          entityId: payload.personId,
          after: {
            firstName: payload.firstName,
            lastName: payload.lastName,
            birthDate: payload.birthDate || null,
          },
        },
      ],
    })
  }

  const handleSubmitContributionDeletePerson = async (payload) => {
    await handleSubmitContributionSession({
      title: payload.title,
      changes: [
        {
          entityType: 'person',
          action: 'delete',
          entityId: payload.personId,
        },
      ],
    })
  }

  const handleReviewContributionSession = async (sessionId, reviewPayload) => {
    if (!canEditCurrentTree || !treeContext.treeId || !treeContext.accessToken) {
      return
    }

    setContribState((current) => ({
      ...current,
      reviewingSessionId: sessionId,
      error: '',
    }))

    try {
      await reviewContributionSession(
        treeContext.treeId,
        sessionId,
        reviewPayload,
        treeContext.accessToken,
      )

      // Appliquer côté frontend les annotations approuvées (le backend ne les gère pas)
      const session = contribState.sessions.find((s) => s.id === sessionId)
      if (session) {
        const isAllApproved = reviewPayload.decision === 'approved'
        const approvedIds = new Set(
          (reviewPayload.changeDecisions || [])
            .filter((d) => d.decision === 'approved')
            .map((d) => d.changeId),
        )
        const approvedAnnotations = (session.changes || []).filter((c) =>
          c.entityType === 'annotation' && (isAllApproved || approvedIds.has(c.id)),
        )
        if (approvedAnnotations.length > 0) {
          const batchPayload = {
            create: approvedAnnotations
              .filter((c) => c.action === 'create')
              .map((c) => c.afterJson || c.after),
            update: approvedAnnotations
              .filter((c) => c.action === 'update')
              .map((c) => ({ id: c.entityId, ...(c.afterJson || c.after) })),
            delete: approvedAnnotations
              .filter((c) => c.action === 'delete')
              .map((c) => c.entityId),
          }
          try {
            await batchAnnotations(treeContext.treeId, batchPayload, treeContext.accessToken)
          } catch (annErr) {
            console.error('Failed to apply approved annotations:', annErr)
          }
        }
      }

      await refreshCurrentTreeGraph()

      await refreshContributionSessions()

      setContribState((current) => ({
        ...current,
        reviewingSessionId: '',
      }))
    } catch (error) {
      setContribState((current) => ({
        ...current,
        reviewingSessionId: '',
        error: getAccountErrorMessage(error),
      }))
    }
  }

  return {
    contribState,
    resetContribState,
    handleOpenContributionPanel,
    handleCloseContributionPanel,
    refreshContributionSessions,
    handleSubmitContributionSession,
    handleSubmitContributionCreatePerson,
    handleSubmitContributionUpdatePerson,
    handleSubmitContributionDeletePerson,
    handleReviewContributionSession,
  }
}
