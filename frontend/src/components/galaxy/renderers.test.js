import { describe, expect, it } from 'vitest'
import { RENVOI_MIN_DX } from './constants'
import { shouldRenderRenvoi } from './renderers'

describe('renvoi rendering with manual positions', () => {
  it('replaces an eligible renvoi with a direct link once the nodes are close enough', () => {
    expect(shouldRenderRenvoi(
      { _renvoi: true, _renvoiEligible: true },
      { cx: 0, cy: 0 },
      { cx: RENVOI_MIN_DX, cy: 200 },
    )).toBe(false)
  })

  it('retains a renvoi for an eligible edge that is still far away', () => {
    expect(shouldRenderRenvoi(
      { _renvoiEligible: true },
      { cx: 0, cy: 0 },
      { cx: RENVOI_MIN_DX + 1, cy: 200 },
    )).toBe(true)
  })

  it('preserves the precomputed behavior for non-eligible edges', () => {
    expect(shouldRenderRenvoi({ _renvoi: true }, { cx: 0 }, { cx: 0 })).toBe(true)
    expect(shouldRenderRenvoi({}, { cx: 0 }, { cx: 1000 })).toBe(false)
  })
})
