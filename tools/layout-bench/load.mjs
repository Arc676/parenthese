// Charge le code de production (SRC=<dossier frontend/src> pour mesurer une autre version) et les arbres :
// archétypes, arbres fictifs générés, et fixtures locales (fixtures/<nom>.json au format de GET /trees/:id/graph,
// jamais versionnées : ce sont les données d'une famille).
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { archetypes } from './archetypes.mjs'
import { generate } from './gen-fr.mjs'

export const SRC = (process.env.SRC || fileURLToPath(new URL('../../frontend/src/', import.meta.url))).replace(/\\/g, '/').replace(/\/?$/, '/')
const mockData = await import(pathToFileURL(`${SRC}data/mockData.js`).href)
export const constants = await import(pathToFileURL(`${SRC}components/galaxy/constants.js`).href)
export const layoutModule = await import(pathToFileURL(`${SRC}components/galaxy/elkLayout.js`).href)
const blockLayout = await import(pathToFileURL(`${SRC}components/galaxy/blockLayout.js`).href)

// Graphe de l'API → entrée de computeLayout (même conversion que l'app)
export function toGraph(rawGraph) {
  mockData.loadGraphData(rawGraph, { apiBaseUrl: '' })
  return { persons: mockData.persons, unions: mockData.unions, filiations: mockData.filiations, medias: mockData.medias }
}

// Placement de production. Renvoie aussi coupleBarMeta, état partagé peuplé par computeLayout.
export function layout(graph, referenceId = null) {
  const result = blockLayout.computeBlockLayout(graph, referenceId)
  return { result, coupleBarMeta: layoutModule.coupleBarMeta }
}

// Un arbre par nom : archétype (slug), « desc-<graine> » ou « asc-<graine> » (générés), ou fixtures/<nom>.json
export function loadTree(name) {
  const arch = archetypes.find((a) => a.slug === name)
  if (arch) return { name, graph: arch.graph, reference: arch.reference, archetype: true }
  const gen = name.match(/^(asc|desc)-(\d+)$/)
  if (gen) {
    const out = generate(gen[1], Number(gen[2]))
    return { name, graph: toGraph(out.graph), reference: out.rootPersonId }
  }
  const file = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url))
  const legacy = fileURLToPath(new URL(`./fixtures/${name}-graph.json`, import.meta.url))
  const path = existsSync(file) ? file : existsSync(legacy) ? legacy : null
  if (!path) throw new Error(`arbre inconnu : ${name} (archétype, desc-<graine>, asc-<graine> ou fixtures/${name}.json)`)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return { name, graph: toGraph(raw.graph || raw), reference: raw.rootPersonId || null }
}

export const archetypeNames = archetypes.map((a) => a.slug)
