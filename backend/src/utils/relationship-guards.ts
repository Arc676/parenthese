import type { Prisma, PrismaClient } from '../generated/prisma/client.js'

type RelationReader = Pick<PrismaClient, 'parentChildLink' | 'union'>

type UnionLite = {
  id: string
  partner1PersonId: string
  partner2PersonId: string | null
}

type LinkLite = {
  id: string
  parentPersonId: string
  childPersonId: string
  viaUnionId: string | null
}

type RelationSnapshot = {
  unionsById: Map<string, UnionLite>
  links: LinkLite[]
}

type BuildSnapshotOptions = {
  excludeLinkId?: string | null
  extraUnions?: UnionLite[]
}

export type RelationshipValidationCode =
  | 'invalid_union_partners'
  | 'forbidden_union_with_ancestor_descendant'
  | 'invalid_parent_child_link'
  | 'parent_child_cycle_detected'
  | 'parent_child_conflicts_with_union'
  | 'parent_not_in_union'
  | 'child_cannot_be_union_partner'
  | 'invalid_union_reference'

type ParentChildValidationOptions = {
  excludeLinkId?: string | null
  viaUnionId?: string | null
  resolvedViaUnion?: UnionLite | null
}

function addEdge(adjacency: Map<string, Set<string>>, parentId: string, childId: string): void {
  if (!adjacency.has(parentId)) {
    adjacency.set(parentId, new Set())
  }

  adjacency.get(parentId)?.add(childId)
}

function buildAdjacency(snapshot: RelationSnapshot): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>()

  snapshot.links.forEach((link) => {
    addEdge(adjacency, link.parentPersonId, link.childPersonId)

    if (link.viaUnionId) {
      const viaUnion = snapshot.unionsById.get(link.viaUnionId)
      if (viaUnion) {
        addEdge(adjacency, viaUnion.partner1PersonId, link.childPersonId)
        if (viaUnion.partner2PersonId) {
          addEdge(adjacency, viaUnion.partner2PersonId, link.childPersonId)
        }
      }
    }
  })

  return adjacency
}

function hasDirectedPath(adjacency: Map<string, Set<string>>, source: string, target: string): boolean {
  if (source === target) {
    return true
  }

  const queue: string[] = [source]
  const visited = new Set<string>([source])

  while (queue.length > 0) {
    const current = queue.shift() as string
    const children = adjacency.get(current)
    if (!children) continue

    for (const child of children) {
      if (child === target) {
        return true
      }

      if (!visited.has(child)) {
        visited.add(child)
        queue.push(child)
      }
    }
  }

  return false
}

async function loadRelationSnapshot(
  tx: RelationReader,
  treeId: string,
  options: BuildSnapshotOptions = {},
): Promise<RelationSnapshot> {
  const linkWhere: Prisma.ParentChildLinkWhereInput = {
    treeId,
    deletedAt: null,
  }

  if (options.excludeLinkId) {
    linkWhere.id = { not: options.excludeLinkId }
  }

  const [links, unions] = await Promise.all([
    tx.parentChildLink.findMany({
      where: linkWhere,
      select: {
        id: true,
        parentPersonId: true,
        childPersonId: true,
        viaUnionId: true,
      },
    }),
    tx.union.findMany({
      where: {
        treeId,
        deletedAt: null,
      },
      select: {
        id: true,
        partner1PersonId: true,
        partner2PersonId: true,
      },
    }),
  ])

  const unionsById = new Map<string, UnionLite>()
  unions.forEach((union: UnionLite) => {
    unionsById.set(union.id, union)
  })

  options.extraUnions?.forEach((union) => {
    unionsById.set(union.id, union)
  })

  return { unionsById, links }
}

function isSameUnionPair(union: UnionLite, leftId: string, rightId: string): boolean {
  if (!union.partner2PersonId) {
    return false
  }

  return (
    (union.partner1PersonId === leftId && union.partner2PersonId === rightId) ||
    (union.partner1PersonId === rightId && union.partner2PersonId === leftId)
  )
}

export async function findUnionValidationError(
  tx: RelationReader,
  treeId: string,
  partner1PersonId: string,
  partner2PersonId: string | null | undefined,
): Promise<RelationshipValidationCode | null> {
  if (!partner2PersonId) {
    return null
  }

  if (partner1PersonId === partner2PersonId) {
    return 'invalid_union_partners'
  }

  const snapshot = await loadRelationSnapshot(tx, treeId)
  const adjacency = buildAdjacency(snapshot)

  if (
    hasDirectedPath(adjacency, partner1PersonId, partner2PersonId) ||
    hasDirectedPath(adjacency, partner2PersonId, partner1PersonId)
  ) {
    return 'forbidden_union_with_ancestor_descendant'
  }

  return null
}

export async function findParentChildValidationError(
  tx: RelationReader,
  treeId: string,
  parentPersonId: string,
  childPersonId: string,
  options: ParentChildValidationOptions = {},
): Promise<RelationshipValidationCode | null> {
  if (parentPersonId === childPersonId) {
    return 'invalid_parent_child_link'
  }

  const extraUnions = options.resolvedViaUnion ? [options.resolvedViaUnion] : []
  const snapshot = await loadRelationSnapshot(tx, treeId, {
    excludeLinkId: options.excludeLinkId ?? null,
    extraUnions,
  })
  const adjacency = buildAdjacency(snapshot)

  if (hasDirectedPath(adjacency, childPersonId, parentPersonId)) {
    return 'parent_child_cycle_detected'
  }

  for (const union of snapshot.unionsById.values()) {
    if (isSameUnionPair(union, parentPersonId, childPersonId)) {
      return 'parent_child_conflicts_with_union'
    }
  }

  const viaUnionId = options.viaUnionId ?? options.resolvedViaUnion?.id ?? null
  if (viaUnionId) {
    const viaUnion = snapshot.unionsById.get(viaUnionId) ?? (options.resolvedViaUnion && options.resolvedViaUnion.id === viaUnionId ? options.resolvedViaUnion : undefined)
    if (!viaUnion) {
      return 'invalid_union_reference'
    }

    const parentInUnion = viaUnion.partner1PersonId === parentPersonId || viaUnion.partner2PersonId === parentPersonId
    if (!parentInUnion) {
      return 'parent_not_in_union'
    }

    const childIsUnionPartner = viaUnion.partner1PersonId === childPersonId || viaUnion.partner2PersonId === childPersonId
    if (childIsUnionPartner) {
      return 'child_cannot_be_union_partner'
    }
  }

  return null
}
