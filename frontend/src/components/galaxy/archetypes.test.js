import { describe, it, expect } from 'vitest'
import { computeBlockLayout } from './blockLayout'
import { coupleBarMeta } from './elkLayout'
import { archetypes } from '../../../../tools/layout-bench/archetypes.mjs'
import { renderAscii } from '../../../../tools/layout-bench/ascii.mjs'
import { checkInvariants, HARD } from '../../../../tools/layout-bench/invariants.mjs'

// Chaque archétype a un rendu texte validé une fois à l'œil (__snapshots__/archetypes/<slug>.txt) : il devient
// le témoin. Un changement de placement qui le modifie doit être relu et le témoin mis à jour (vitest -u).
//
// Échecs connus, jusqu'à l'étape X du placement (le sang de la référence garde son enfant sous ses parents) :
// la belle-famille, plus nombreuse, revendique le couple la première et la fratrie de la référence se retrouve
// dans le désordre. Quand X est fait, ces cas passent et il faut les retirer d'ici (le test le signale).
const ECHECS_CONNUS = new Set(['belle-famille', 'trois-belles-familles'])

describe('archétypes du placement', () => {
  for (const a of archetypes) {
    describe(a.slug, () => {
      const result = computeBlockLayout(a.graph, a.reference)
      const meta = [...coupleBarMeta]
      const check = ECHECS_CONNUS.has(a.slug) ? it.fails : it
      check('respecte les invariants', () => {
        const inv = checkInvariants(result, meta, a.graph, a.reference)
        expect(Object.fromEntries(HARD.map((k) => [k, inv[k]]))).toEqual(Object.fromEntries(HARD.map((k) => [k, 0])))
      })
      it('garde son rendu validé', async () => {
        await expect(renderAscii(result, meta) + '\n').toMatchFileSnapshot(`./__snapshots__/archetypes/${a.slug}.txt`)
      })
    })
  }
})
