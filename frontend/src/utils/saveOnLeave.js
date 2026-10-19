// Enregistrement d'une fiche en modification, partagé par le bouton « Enregistrer » et le départ de la fiche.
// Un appel pendant un enregistrement reçoit la même promesse : pas de double envoi.
export function runOnce(inFlightRef, run) {
  if (inFlightRef.current) return inFlightRef.current
  const promise = Promise.resolve().then(run).finally(() => { inFlightRef.current = null })
  inFlightRef.current = promise
  return promise
}
