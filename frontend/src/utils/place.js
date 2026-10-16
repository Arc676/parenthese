// Lieu lisible à l'affichage : un arbre importé de Heredis avant le nettoyage à l'import garde ses lieux bruts
// (« La Roche-sur-Yon,85191,Vendée,Pays de la Loire,France, »). On montre les noms seulement, sans case vide,
// sans code INSEE ni postal, sans répétition. La valeur enregistrée ne change pas (même règle qu'à l'import).
export function formatPlace(value) {
  if (!value) return value
  const parts = []
  for (const raw of String(value).split(',')) {
    const part = raw.trim()
    if (!part || /^(\d{4,5}|2[AB]\d{3})$/i.test(part)) continue
    if (parts.length && parts[parts.length - 1].toLowerCase() === part.toLowerCase()) continue
    parts.push(part)
  }
  return parts.join(', ')
}
