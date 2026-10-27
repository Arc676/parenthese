// Les scripts en ligne de la landing (animation du logo, règles de préchargement des pages) ne passent la CSP de
// nginx que par leur empreinte exacte (deploy/nginx.conf). Un script modifié sans recalculer son empreinte ne
// casse rien de visible : l'animation ou le préchargement s'arrêtent sans bruit. Ce test le dit tout de suite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const landing = fileURLToPath(new URL('..', import.meta.url))
const csp = readFileSync(path.join(landing, '../deploy/nginx.conf'), 'utf8').match(/map \$host \$parenthese_landing_csp \{\s*default "([^"]+)"/)[1]
const autorisees = new Set([...csp.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]))
const empreinte = (texte) => createHash('sha256').update(texte, 'utf8').digest('base64')

function pages(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = path.join(dossier, nom)
    if (statSync(chemin).isDirectory()) return pages(chemin)
    return nom === 'index.html' ? [chemin] : []
  })
}
const toutes = [path.join(landing, 'index.html'), ...pages(path.join(landing, 'public'))]

test('chaque script en ligne des pages a son empreinte dans la CSP de la landing', () => {
  for (const fichier of toutes) {
    const html = readFileSync(fichier, 'utf8')
    for (const [, attributs, contenu] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\bsrc=|application\/ld\+json/.test(attributs)) continue
      assert.ok(autorisees.has(empreinte(contenu)), `${path.relative(landing, fichier)} : script en ligne sans empreinte dans deploy/nginx.conf (${empreinte(contenu)})`)
    }
  }
})

test('chaque page a ses règles de préchargement', () => {
  for (const fichier of toutes) {
    assert.match(readFileSync(fichier, 'utf8'), /<script type="speculationrules">/, path.relative(landing, fichier))
  }
})
