// Plafond d'échecs par arbre, en plus de la limite par adresse : un mot de passe de partage est choisi par
// une famille (« 123soleil »), un dictionnaire envoyé depuis beaucoup d'adresses finirait par le trouver.
// Au-delà du plafond, l'arbre refuse les essais jusqu'à la fin de la fenêtre, même le bon mot de passe.
// En mémoire : l'API tourne en un seul processus (pm2 fork, un conteneur).
//
// L'essai est compté avant la comparaison bcrypt, puis rendu s'il réussit : compter après coup laissait
// passer en entier une rafale de requêtes simultanées, toutes vérifiées avant que le premier échec soit noté.

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 30

const attemptsByTree = new Map<string, number[]>()

function recentAttempts(treeId: string, now: number): number[] {
  const recent = (attemptsByTree.get(treeId) ?? []).filter((at) => now - at < WINDOW_MS)
  if (recent.length > 0) {
    attemptsByTree.set(treeId, recent)
  } else {
    attemptsByTree.delete(treeId)
  }
  return recent
}

export function isTreeUnlockLocked(treeId: string, now = Date.now()): boolean {
  return recentAttempts(treeId, now).length >= MAX_FAILURES
}

// Réserve une place d'essai : renvoie de quoi la rendre si le mot de passe est bon, ou null si l'arbre est bloqué
export function reserveTreeUnlockAttempt(treeId: string, now = Date.now()): (() => void) | null {
  const recent = recentAttempts(treeId, now)
  if (recent.length >= MAX_FAILURES) return null
  recent.push(now)
  attemptsByTree.set(treeId, recent)
  return () => {
    const current = attemptsByTree.get(treeId)
    if (!current) return
    const index = current.indexOf(now)
    if (index >= 0) current.splice(index, 1)
    if (current.length === 0) attemptsByTree.delete(treeId)
  }
}

export function recordTreeUnlockFailure(treeId: string, now = Date.now()): void {
  const recent = recentAttempts(treeId, now)
  recent.push(now)
  attemptsByTree.set(treeId, recent)
}

export function resetTreeUnlockGuard(): void {
  attemptsByTree.clear()
}

// Une comparaison bcrypt coûte ≈ 250 ms au coût 12. Même calculée hors de la boucle (bcrypt natif), des essais
// lancés en parallèle depuis quelques adresses occuperaient tous les fils de calcul, connexions comprises. Les
// comparaisons de mot de passe de partage passent une par une.
// Au-delà de MAX_WAITING comparaisons en attente, on refuse tout de suite (null) plutôt que d'allonger la file.
const MAX_WAITING = 20
let queue: Promise<unknown> = Promise.resolve()
let waiting = 0

export function serializePasswordCheck<T>(task: () => Promise<T>): Promise<T> | null {
  if (waiting >= MAX_WAITING) return null
  waiting += 1
  const run = queue.then(task, task).finally(() => {
    waiting -= 1
  })
  queue = run.catch(() => undefined)
  return run
}
