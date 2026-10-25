// Fantômes (1.5.1) : ce qui est proposé mais pas encore dans l'arbre, dessiné en transparence à sa place.
// Trois sources, même format de changements que l'envoi d'une proposition :
// - « draft » : le brouillon de la famille, pas encore envoyé ;
// - « sent » : ce que la famille a envoyé, gardé dans son navigateur jusqu'à la relecture ;
// - « pending » : les propositions en attente, vues par qui gère l'arbre.
// Les fantômes ne touchent jamais aux données de l'arbre : ils ne s'ajoutent qu'au placement et au dessin.

function afterOf(change) {
  const after = change?.afterJson ?? change?.after
  return after && typeof after === 'object' && !Array.isArray(after) ? after : null
}

function yearOf(isoDate) {
  const match = typeof isoDate === 'string' ? isoDate.match(/^(\d{4})/) : null
  return match ? Number(match[1]) : null
}

function unionIdFor(parentId, unions) {
  const own = unions.filter((u) => String(u.partner1Id) === String(parentId) || String(u.partner2Id) === String(parentId))
  return own.length === 1 ? String(own[0].id) : null
}

/**
 * Fantômes d'une liste de changements.
 * @param {Array} changes - changements d'une proposition ({ entityType, action, entityId, after | afterJson, id })
 * @param {Object} meta - { source, key, sessionId?, label?, createdAt? } ; `key` rend les identifiants uniques
 * @param {Object} graph - { unions } de l'arbre, pour rattacher un enfant proposé au couple de son parent
 */
export function ghostsFromChanges(changes = [], meta = {}, graph = {}) {
  const key = String(meta.key || meta.sessionId || 'brouillon')
  const ghost = { ...meta, key }
  const refs = new Map()
  const persons = []
  const unions = []
  const filiations = []
  const annotations = []
  const patches = new Map()
  const resolve = (id) => (id == null ? null : refs.get(String(id)) || String(id))

  changes.forEach((change, index) => {
    if (change?.entityType !== 'person' || change.action !== 'create') return
    const after = afterOf(change)
    if (!after) return
    const id = `ghost:${key}:${after.ref || change.id || index}`
    if (after.ref) refs.set(String(after.ref), id)
    persons.push({
      id,
      firstName: after.firstName || '',
      lastName: after.lastName || '',
      birthName: after.birthName || null,
      nickname: after.nickname || null,
      sex: after.sex || null,
      birthDate: after.birthDate || null,
      deathDate: after.deathDate || null,
      birthYear: yearOf(after.birthDate),
      deathYear: yearOf(after.deathDate),
      isAlive: !after.deathDate && !after.isDeceased,
      photo: null,
      frameType: 'round',
      ghost,
    })
  })

  changes.forEach((change, index) => {
    if (change?.entityType !== 'union' || change.action !== 'create') return
    const after = afterOf(change)
    if (!after?.partner1PersonId || !after?.partner2PersonId) return
    unions.push({
      id: `ghost:${key}:u${change.id || index}`,
      partner1Id: resolve(after.partner1PersonId),
      partner2Id: resolve(after.partner2PersonId),
      unionType: after.unionType || 'mariage',
      displayOrder: 9999,
      ghost,
    })
  })

  const allUnions = [...(graph.unions || []), ...unions]
  changes.forEach((change, index) => {
    const after = afterOf(change)
    if (!after) return
    if (change.entityType === 'parent_child_link' && change.action === 'create') {
      if (!after.parentPersonId || !after.childPersonId) return
      const parentId = resolve(after.parentPersonId)
      const unionId = after.viaUnionId ? String(after.viaUnionId) : unionIdFor(parentId, allUnions)
      filiations.push({
        id: `ghost:${key}:f${change.id || index}`,
        childId: resolve(after.childPersonId),
        parentId: unionId ? null : parentId,
        unionId,
        parentageType: after.parentageType || 'biologique',
        displayOrder: 9999,
        ghost,
      })
    } else if (change.entityType === 'person' && (change.action === 'update' || change.action === 'delete') && change.entityId) {
      const previous = patches.get(String(change.entityId))
      patches.set(String(change.entityId), {
        ...previous,
        fields: { ...(previous?.fields || {}), ...(change.action === 'update' ? after : {}) },
        deleted: change.action === 'delete' || Boolean(previous?.deleted),
        ghost,
      })
    } else if (change.entityType === 'annotation' && change.action === 'create' && meta.source !== 'draft') {
      // Le brouillon dessine déjà ses annotations : seules celles envoyées ou en attente deviennent fantômes
      annotations.push({
        id: `ghost:${key}:a${change.id || index}`,
        type: after.type,
        x: Number(after.x) || 0,
        y: Number(after.y) || 0,
        content: after.content || '',
        style: after.style || {},
        zIndex: after.zIndex || 0,
        ghost,
      })
    }
  })

  return { persons, unions, filiations, annotations, patches }
}

export function emptyGhosts() {
  return { persons: [], unions: [], filiations: [], annotations: [], patches: new Map() }
}

export function mergeGhosts(list = []) {
  const merged = emptyGhosts()
  for (const g of list) {
    if (!g) continue
    merged.persons.push(...g.persons)
    merged.unions.push(...g.unions)
    merged.filiations.push(...g.filiations)
    merged.annotations.push(...g.annotations)
    for (const [id, patch] of g.patches) if (!merged.patches.has(id)) merged.patches.set(id, patch)
  }
  return merged
}

export function hasGhosts(g) {
  return Boolean(g && (g.persons.length || g.unions.length || g.filiations.length || g.annotations.length || g.patches.size))
}

/**
 * Le graphe à placer, fantômes compris. Dans un onglet de famille, seuls les fantômes reliés (de proche en
 * proche) à une personne de l'onglet y entrent ; l'arbre entier les prend tous.
 * @param {{persons, unions, filiations}} base
 * @param {ReturnType<typeof ghostsFromChanges>} ghosts
 * @param {boolean} whole - base = l'arbre entier
 */
export function withGhosts(base, ghosts, whole = false) {
  if (!hasGhosts(ghosts)) return base
  const keep = new Set(base.persons.map((p) => String(p.id)))
  const ghostById = new Map(ghosts.persons.map((p) => [String(p.id), p]))
  const allUnions = [...base.unions, ...ghosts.unions]
  const unionById = new Map(allUnions.map((u) => [String(u.id), u]))
  const parentsOf = (f) => (f.unionId ? [unionById.get(String(f.unionId))?.partner1Id, unionById.get(String(f.unionId))?.partner2Id] : [f.parentId]).filter((id) => id != null).map(String)

  if (whole) {
    for (const id of ghostById.keys()) keep.add(id)
  } else {
    let grew = true
    while (grew) {
      grew = false
      const touch = (a, b) => {
        if (keep.has(a) && ghostById.has(b) && !keep.has(b)) { keep.add(b); grew = true }
        if (keep.has(b) && ghostById.has(a) && !keep.has(a)) { keep.add(a); grew = true }
      }
      for (const u of ghosts.unions) touch(String(u.partner1Id), String(u.partner2Id))
      for (const f of ghosts.filiations) for (const p of parentsOf(f)) touch(p, String(f.childId))
    }
  }

  const persons = [...base.persons, ...[...ghostById.values()].filter((p) => keep.has(String(p.id)))]
  const unions = [...base.unions, ...ghosts.unions.filter((u) => keep.has(String(u.partner1Id)) && keep.has(String(u.partner2Id)))]
  const unionIds = new Set(unions.map((u) => String(u.id)))
  const filiations = [
    ...base.filiations,
    ...ghosts.filiations.filter((f) => keep.has(String(f.childId)) && (f.unionId ? unionIds.has(String(f.unionId)) : keep.has(String(f.parentId)))),
  ]
  return { persons, unions, filiations }
}

export function isGhostId(id) {
  return typeof id === 'string' && (id.startsWith('ghost:') || id.startsWith('p-ghost:'))
}
