import { useCallback, useEffect, useState } from 'react'
import {
  fetchContributionStatus,
  listContributionSessions,
  submitContributionSession,
  reviewContributionSession,
} from '../api/treeApi'
import { forgetSentProposal, readSentProposals, rememberSentProposal } from '../utils/sentProposals'
import { getAccountErrorMessage } from '../utils/errorMessages'
import { toOpaqueTreeId, trackAppEvent } from '../utils/analytics'
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

  // Ce que la famille a envoyé, gardé dans son navigateur jusqu'à la relecture : dessiné en fantôme « En attente »
  // (utils/ghosts.js). Chaque proposition est revérifiée au chargement et au retour sur l'onglet.
  const [sentProposals, setSentProposals] = useState([])
  const refreshSentProposals = useCallback(async () => {
    if (!treeId || !accessToken || canEditCurrentTree) { setSentProposals([]); return }
    const stored = readSentProposals(treeId)
    setSentProposals(stored)
    const stillPending = []
    for (const proposal of stored) {
      try {
        const status = await fetchContributionStatus(treeId, proposal.sessionId, accessToken)
        if (status === 'pending') stillPending.push(proposal)
        else forgetSentProposal(treeId, proposal.sessionId)
      } catch (error) {
        // Introuvable : relue puis effacée, ou d'un autre arbre. Hors ligne : on la garde
        if (error?.status === 404) forgetSentProposal(treeId, proposal.sessionId)
        else stillPending.push(proposal)
      }
    }
    setSentProposals(stillPending)
  }, [treeId, accessToken, canEditCurrentTree])
  useEffect(() => {
    refreshSentProposals()
    const onVisible = () => { if (document.visibilityState === 'visible') refreshSentProposals() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshSentProposals])

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
      } else if (result?.session?.id && !canEditCurrentTree) {
        rememberSentProposal(treeContext.treeId, {
          sessionId: result.session.id,
          label: payload.submittedByLabel || null,
          createdAt: result.session.createdAt || new Date().toISOString(),
          changes: payload.changes,
        })
        setSentProposals(readSentProposals(treeContext.treeId))
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

  // from : « tree » (depuis le fantôme) ou « panel », pour les compteurs d'édition
  const handleReviewContributionSession = async (sessionId, reviewPayload, from = 'panel') => {
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

      // Les annotations acceptées sont posées par le serveur, dans la même transaction (1.5.1)
      trackAppEvent('proposal_reviewed', { decision: reviewPayload.decision, from, partial: Boolean(reviewPayload.changeDecisions?.length), tree_id: toOpaqueTreeId(treeContext.treeId) })
      await refreshCurrentTreeGraph()

      await refreshContributionSessions()

      setContribState((current) => ({
        ...current,
        reviewingSessionId: '',
      }))
    } catch (error) {
      // Déjà relue ailleurs (un autre onglet, un co-gestionnaire) : l'arbre et la liste se remettent à jour, le
      // fantôme part avec elle
      if (error?.payload?.error === 'contribution_session_already_reviewed') {
        await refreshCurrentTreeGraph().catch(() => {})
        await refreshContributionSessions()
      }
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
    sentProposals,
    refreshSentProposals,
  }
}
