// Banc du placement, sur le code de production.
// Usage : node --import ./register.mjs run.mjs [arbre ...]
//   sans argument : tous les archétypes, desc-3, asc-23 et chaque fixtures/*.json
//   SRC=<dossier frontend/src>  code mesuré (défaut : celui du dépôt)
//   TAG=<nom>                   nom du rapport, out/rapport-<nom>.json (défaut : « courant »)
//   ASCII=1                     imprime le rendu texte des archétypes
//   PERTURB=0                   saute le test de stabilité (lent sur les gros arbres)
// Lecture : d'abord les invariants (doivent valoir 0), puis les défauts sur le tracé réel dans l'ordre
// renvois, fils sur portraits étrangers, croisements, câbles d'un écran, foyers larges, puis la stabilité.
// La largeur ne départage qu'une égalité parfaite. Pas de score composite.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { loadTree, layout, archetypeNames } from './load.mjs'
import { checkInvariants, HARD } from './invariants.mjs'
import { computeDefects } from './defects.mjs'
import { perturbation } from './perturb.mjs'
import { renderAscii } from './ascii.mjs'
import { renderSvg } from './svg.mjs'

const OUT = fileURLToPath(new URL('./out/', import.meta.url))
mkdirSync(OUT, { recursive: true })
const tag = process.env.TAG || 'courant'
const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url))
const fixtures = (existsSync(fixturesDir) ? readdirSync(fixturesDir, { withFileTypes: true }) : []).filter((f) => f.isFile() && f.name.endsWith('.json')).map((f) => f.name.replace(/(-graph)?\.json$/, ''))
const names = process.argv.slice(2).length ? process.argv.slice(2) : [...archetypeNames, 'desc-3', 'asc-23', ...fixtures]

const rows = []
for (const name of names) {
  const tree = loadTree(name)
  const t0 = performance.now()
  const { result, coupleBarMeta } = layout(tree.graph, tree.reference)
  const ms = Math.round(performance.now() - t0)
  const inv = checkInvariants(result, coupleBarMeta, tree.graph, tree.reference)
  const def = computeDefects(result, coupleBarMeta, tree.graph, tree.reference)
  const stab = process.env.PERTURB === '0' ? {} : perturbation((g, r) => layout(g, r).result, tree.graph, tree.reference)
  const nodes = result.children
  const largeur = Math.round(Math.max(...nodes.map((n) => n.x + n.width)) - Math.min(...nodes.map((n) => n.x)))
  const { pires_foyers, ...defauts } = def
  const row = { arbre: name, personnes: nodes.filter((n) => n._type === 'person').length, ms, ...inv, ...defauts, ...stab, largeur }
  row.invariants = HARD.every((k) => inv[k] === 0) ? 'ok' : 'FAUX'
  rows.push({ ...row, pires_foyers })
  if (tree.archetype) {
    const text = renderAscii(result, coupleBarMeta)
    writeFileSync(`${OUT}${name}.txt`, text + '\n')
    if (process.env.ASCII) console.log(`\n── ${name} ──\n${text}`)
  } else {
    renderSvg(result, coupleBarMeta, `${OUT}${name}.svg`, name)
  }
}
const shown = ['arbre', 'personnes', 'invariants', 'rangees_fausses', 'conflits', 'fratries_coupees', 'renvois', 'renvois_sang', 'fils_sur_etranger', 'croisements', 'superpositions', 'cables_ecran', 'foyers_larges', 'proches_ecran', 'proches', 'max_bouges', 'max_deplacement_px', 'largeur', 'ms']
console.table(rows.map((r) => Object.fromEntries(shown.filter((k) => k in r).map((k) => [k, r[k]]))))
for (const r of rows) if (r.pires_foyers?.length && r.pires_foyers[0].etendue > 1440) console.log(`${r.arbre} : foyers les plus étendus`, r.pires_foyers.map((h) => `${h.enfants} enfants sur ${h.etendue} px`).join(' · '))
writeFileSync(`${OUT}rapport-${tag}.json`, JSON.stringify(rows, null, 2))
console.log(`\nrapport : out/rapport-${tag}.json · rendus texte des archétypes dans out/<slug>.txt · comparer deux rapports : node diff.mjs <tag A> <tag B>`)
