function readLayoutPosition(person) {
  if (!Number.isFinite(person?.layoutX) || !Number.isFinite(person?.layoutY)) return null
  return { x: person.layoutX, y: person.layoutY }
}

export function captureAutomaticPersonPositions(layoutData) {
  return new Map(
    layoutData.children
      .filter((node) => node._type === 'person')
      .map((node) => [node.id, { x: node.x, y: node.y }]),
  )
}

export function applyManualPersonPositions(
  layoutData,
  { draftPositions = {}, getPersonById, automaticPositions = new Map() } = {},
) {
  if (!layoutData) return

  for (const node of layoutData.children) {
    if (node._type !== 'person') continue

    const personId = String(node._data.id)
    const draftPosition = readLayoutPosition(draftPositions[personId])
    const person = getPersonById?.(node._data.id) || node._data
    const position = draftPosition || readLayoutPosition(person)

    if (position) {
      node.x = position.x - node.width / 2
      node.y = position.y - node.height / 2
      node._manualPosition = true
      continue
    }

    const automaticPosition = automaticPositions.get(node.id)
    if (automaticPosition) {
      node.x = automaticPosition.x
      node.y = automaticPosition.y
    }
    node._manualPosition = false
  }
}

export function positionUnionJunctions(coupleBarMeta, positionById) {
  for (const { elkId, p1Key, p2Key } of coupleBarMeta) {
    const partner1 = positionById.get(p1Key)
    const partner2 = positionById.get(p2Key)
    if (!partner1 || !partner2) continue

    positionById.set(elkId, {
      cx: (partner1.cx + partner2.cx) / 2,
      cy: (partner1.cy + partner2.cy) / 2,
    })
  }
}
