// Compare deux rapports du banc (out/rapport-<tag>.json), par arbre et par colonne. Usage : node diff.mjs <tag A> <tag B>
import { readFileSync } from 'node:fs'
const [a, b] = process.argv.slice(2)
if (!a || !b) { console.error('Usage : node diff.mjs <tag A> <tag B>'); process.exit(1) }
const read = (t) => new Map(JSON.parse(readFileSync(new URL(`./out/rapport-${t}.json`, import.meta.url), 'utf8')).map((r) => [r.arbre, r]))
const A = read(a), B = read(b)
const cols = ['invariants', 'rangees_fausses', 'fratries_coupees', 'renvois', 'renvois_sang', 'fils_sur_etranger', 'croisements', 'superpositions', 'cables_ecran', 'foyers_larges', 'proches_ecran', 'max_bouges', 'max_deplacement_px', 'largeur']
for (const [name, ra] of A) {
  const rb = B.get(name)
  if (!rb) continue
  const changes = cols.filter((c) => ra[c] !== rb[c]).map((c) => `${c} ${ra[c]} → ${rb[c]}`)
  console.log(name.padEnd(22), changes.length ? changes.join(' · ') : 'identique')
}
