import { describe, it, expect } from 'vitest'
import { computeBlockLayout } from './blockLayout'
import { coupleBarMeta } from './elkLayout'
import { archetypes } from '../../../../tools/layout-bench/archetypes.mjs'
import { renderAscii } from '../../../../tools/layout-bench/ascii.mjs'
import { checkInvariants, HARD } from '../../../../tools/layout-bench/invariants.mjs'

// Chaque archétype a un rendu texte validé une fois à l'œil (__snapshots__/archetypes/<slug>.txt) : il devient
// le témoin. Un changement de placement qui le modifie doit être relu et le témoin mis à jour (vitest -u).

describe('archétypes du placement', () => {
  for (const a of archetypes) {
    describe(a.slug, () => {
      const result = computeBlockLayout(a.graph, a.reference)
      const meta = [...coupleBarMeta]
      it('respecte les invariants', () => {
        const inv = checkInvariants(result, meta, a.graph, a.reference)
        expect(Object.fromEntries(HARD.map((k) => [k, inv[k]]))).toEqual(Object.fromEntries(HARD.map((k) => [k, 0])))
      })
      it('garde son rendu validé', async () => {
        await expect(renderAscii(result, meta) + '\n').toMatchFileSnapshot(`./__snapshots__/archetypes/${a.slug}.txt`)
      })
    })
  }
})
