import { useCallback, useEffect, useRef, useState } from 'react'

// Délai pendant lequel une suppression reste annulable avant de partir au serveur
export const UNDO_DELAY_MS = 6000

// Une suppression annulable à la fois. L'écran change tout de suite ; la requête ne part qu'à la fin du délai,
// à la suppression suivante, ou à la fermeture de la page (fetch keepalive).
// Une action : { message, commit({ keepalive }), undo(), reapply?() } ; reapply refait le retrait local
// après un rechargement de l'arbre pendant le délai, et renvoie true s'il a changé quelque chose.
export function useUndoable() {
  const pendingRef = useRef(null)
  const [message, setMessage] = useState('')

  const commit = useCallback(async (action, options = {}) => {
    if (pendingRef.current !== action) return
    pendingRef.current = null
    clearTimeout(action.timer)
    setMessage('')
    await action.commit(options)
  }, [])

  const start = useCallback((action) => {
    // La précédente part maintenant
    if (pendingRef.current) commit(pendingRef.current)
    action.timer = setTimeout(() => commit(action), UNDO_DELAY_MS)
    pendingRef.current = action
    setMessage(action.message)
  }, [commit])

  const undo = useCallback(async () => {
    const action = pendingRef.current
    if (!action) return
    pendingRef.current = null
    clearTimeout(action.timer)
    setMessage('')
    await action.undo()
  }, [])

  const reapply = useCallback(() => Boolean(pendingRef.current?.reapply?.()), [])

  // Page fermée pendant le délai : la suppression part quand même
  useEffect(() => {
    const flush = () => {
      if (pendingRef.current) commit(pendingRef.current, { keepalive: true })
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [commit])

  // Ctrl+Z (Cmd+Z) annule, hors des champs de saisie
  useEffect(() => {
    if (!message) return undefined
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [message, undo])

  return { message, start, undo, reapply }
}
