// Temps du placement sans écran, et empreinte du résultat pour prouver qu'une optimisation ne change rien.
// Usage : node --import ./register.mjs layout-time.mjs [arbre ...]   (mêmes noms d'arbres que run.mjs)
//   SRC=<dossier frontend/src> mesure une autre version du code (un autre worktree), comme le banc.
// Par arbre : la liste des onglets (familyTabsOf), l'arbre de départ avec onglets, l'arbre entier sans onglets, puis
// chaque onglet comme l'app l'ouvre. L'empreinte couvre positions, arêtes, couples et onglets : deux versions qui
// rendent les mêmes trois empreintes placent l'arbre à l'identique.
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { loadTree, SRC, archetypeNames } from './load.mjs'

const bl = await import(pathToFileURL(`${SRC}components/galaxy/blockLayout.js`).href)
const elk = await import(pathToFileURL(`${SRC}components/galaxy/elkLayout.js`).href)

const fingerprint = (result) => {
  const h = createHash('sha1')
  for (const n of result.children) h.update(`${n.id}|${n.x.toFixed(2)}|${n.y.toFixed(2)}|${n.width}|${n._generation}|${n._familyTab ? JSON.stringify(n._familyTab) : ''};`)
  for (const e of result.edges || []) h.update(`${e.id}|${e.sources}|${e.targets}|${e._external ? 1 : 0};`)
  h.update(JSON.stringify(elk.coupleBarMeta.map((m) => [m.elkId, m.p1Key, m.p2Key])))
  return h.digest('hex').slice(0, 12)
}
const timed = (f) => { const t = performance.now(); const v = f(); return [v, Math.round(performance.now() - t)] }

const names = process.argv.slice(2)
for (const name of names.length ? names : [...archetypeNames, 'desc-3', 'asc-23']) {
  const tree = loadTree(name)
  const ref = tree.reference
  const [tabs, msTabs] = timed(() => bl.familyTabsOf(tree.graph, ref))
  const [withTabs, msWithTabs] = timed(() => bl.computeBlockLayout(tree.graph, ref, { familyTabs: true }))
  const fpTabs = fingerprint(withTabs)
  const [whole, msWhole] = timed(() => bl.computeBlockLayout(tree.graph, ref, { familyTabs: false }))
  const fpWhole = fingerprint(whole)
  const h = createHash('sha1')
  h.update(JSON.stringify(tabs.map((tb) => [tb.key, tb.label, tb.count, tb.referenceId, tb.parentKey, tb.hinges, tb.personIds ? [...tb.personIds].sort() : null])))
  let msEachTab = 0, msWorstTab = 0
  for (const tb of tabs) {
    if (!tb.personIds) continue
    const [r, ms] = timed(() => bl.computeBlockLayout(bl.subgraphOf(tb.personIds, tree.graph), tb.referenceId, { familyTabs: true }))
    msEachTab += ms; msWorstTab = Math.max(msWorstTab, ms); h.update(fingerprint(r))
  }
  console.log(JSON.stringify({
    name, persons: tree.graph.persons.length, tabs: tabs.length,
    ms_familyTabsOf: msTabs, ms_layout_tabs: msWithTabs, ms_layout_whole: msWhole, ms_each_tab: msEachTab, ms_worst_tab: msWorstTab,
    fingerprint: [fpTabs, fpWhole, h.digest('hex').slice(0, 12)].join(' '),
  }))
}
