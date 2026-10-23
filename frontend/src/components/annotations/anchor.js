// Ancre d'une annotation, rangée dans son style : la personne la plus proche au moment où on la pose et le
// décalage à son portrait. Chaque onglet de famille recalcule le placement : x et y ne disent plus où la
// redessiner, l'ancre si (Anaïs, 23/10 : un texte posé chez une famille réapparaissait au même endroit chez l'autre).

export function readAnchor(ann) {
  const a = ann?.style?.anchor
  if (!a || a.personId == null || !Number.isFinite(a.dx) || !Number.isFinite(a.dy)) return null
  return { personId: String(a.personId), dx: a.dx, dy: a.dy }
}

// Centre de chaque portrait du placement, par id de personne. `offsets` : glissements en cours (fratrie réordonnée)
export function layoutCenters(layout, offsets = null) {
  const centers = new Map()
  for (const node of layout?.children || []) {
    if (node._type !== 'person' || !node._data) continue
    centers.set(String(node._data.id), {
      cx: node.x + node.width / 2 + (offsets?.get(node.id)?.x || 0),
      cy: node.y + node.height / 2,
    })
  }
  return centers
}

export function nearestAnchor(x, y, centers) {
  let best = null
  let bestD2 = Infinity
  for (const [personId, c] of centers || []) {
    const dx = x - c.cx
    const dy = y - c.cy
    const d2 = dx * dx + dy * dy
    if (d2 < bestD2) { bestD2 = d2; best = { personId, dx, dy } }
  }
  return best
}

// Style rattaché à la personne la plus proche de (x, y) ; les autres clés du style sont gardées
export function withAnchor(style, x, y, centers) {
  const anchor = nearestAnchor(x, y, centers)
  return anchor ? { ...(style || {}), anchor } : { ...(style || {}) }
}

// Annotations à dessiner dans ce placement, à leur position : portrait de la personne + décalage. Celles dont
// la personne n'est pas dessinée ici sont laissées de côté. Sans ancre (placement vide), elle reste à x, y.
export function placeAnnotations(list, centers) {
  const shown = []
  for (const ann of list) {
    const a = readAnchor(ann)
    if (!a) { shown.push(ann); continue }
    const c = centers.get(a.personId)
    if (c) shown.push({ ...ann, x: c.cx + a.dx, y: c.cy + a.dy })
  }
  return shown
}

// Annotations d'avant l'ancrage (x, y seuls) : rattachées à la personne la plus proche de leurs coordonnées
// dans `centers`, le placement de l'onglet de départ. Seules celles qui ont trouvé une personne sont rendues.
export function anchorLegacy(list, centers) {
  const anchored = []
  for (const ann of list) {
    if (readAnchor(ann)) continue
    const style = withAnchor(ann.style, ann.x, ann.y, centers)
    if (style.anchor) anchored.push({ ...ann, style })
  }
  return anchored
}
