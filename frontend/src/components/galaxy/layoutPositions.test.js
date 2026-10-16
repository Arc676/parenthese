import { describe, expect, it } from 'vitest'
import {
  applyManualPersonPositions,
  buildManualPositionOverrides,
  captureAutomaticPersonPositions,
  describePositionChange,
  positionUnionJunctions,
} from './layoutPositions'

const makeLayout = () => ({
  children: [
    { id: 'p-1', _type: 'person', _data: { id: '1', layoutX: 300, layoutY: 400 }, x: 10, y: 20, width: 80, height: 80 },
    { id: 'p-2', _type: 'person', _data: { id: '2' }, x: 110, y: 120, width: 80, height: 80 },
    { id: 'u-1', _type: 'union', _data: { id: 'u-1' }, x: 50, y: 70, width: 20, height: 20 },
  ],
  edges: [{ id: 'edge-1', sources: ['p-1'], targets: ['p-2'] }],
})

describe('manual person layout positions', () => {
  it('uses draft coordinates ahead of persisted coordinates and leaves relationships intact', () => {
    const layout = makeLayout()
    const automaticPositions = captureAutomaticPersonPositions(layout)

    applyManualPersonPositions(layout, {
      draftPositions: { 1: { layoutX: 500, layoutY: 600 } },
      automaticPositions,
    })

    expect(layout.children[0]).toMatchObject({ x: 460, y: 560, _manualPosition: true })
    expect(layout.edges).toEqual([{ id: 'edge-1', sources: ['p-1'], targets: ['p-2'] }])
    expect(layout.children[2].x).toBe(50)
  })

  it('restores automatic coordinates when draft positions are discarded', () => {
    const layout = makeLayout()
    layout.children[0]._data.layoutX = null
    layout.children[0]._data.layoutY = null
    const automaticPositions = captureAutomaticPersonPositions(layout)
    layout.children[0].x = 900
    layout.children[0].y = 900

    applyManualPersonPositions(layout, { automaticPositions })

    expect(layout.children[0]).toMatchObject({ x: 10, y: 20, _manualPosition: false })
  })

  it('ignores incomplete coordinates and falls back to saved person coordinates', () => {
    const layout = makeLayout()

    applyManualPersonPositions(layout, {
      draftPositions: { 1: { layoutX: 500 } },
      automaticPositions: captureAutomaticPersonPositions(layout),
    })

    expect(layout.children[0]).toMatchObject({ x: 260, y: 360, _manualPosition: true })
  })
})

describe('dynamic union junction positions', () => {
  it('keeps the junction centered between partners after their positions change', () => {
    const positions = new Map([
      ['p-1', { cx: 400, cy: 250 }],
      ['p-2', { cx: 700, cy: 350 }],
      ['u-1', { cx: 100, cy: 100 }],
    ])

    positionUnionJunctions(
      [{ elkId: 'u-1', p1Key: 'p-1', p2Key: 'p-2' }],
      positions,
    )

    expect(positions.get('u-1')).toEqual({ cx: 550, cy: 300 })
  })

  it('leaves a junction unchanged if either partner position is unavailable', () => {
    const originalJunction = { cx: 100, cy: 100 }
    const positions = new Map([
      ['p-1', { cx: 400, cy: 250 }],
      ['u-1', originalJunction],
    ])

    positionUnionJunctions(
      [{ elkId: 'u-1', p1Key: 'p-1', p2Key: 'p-2' }],
      positions,
    )

    expect(positions.get('u-1')).toBe(originalJunction)
  })
})

describe('positions manuelles du brouillon', () => {
  it('reprend toutes les personnes déplacées dans le brouillon, pas seulement la dernière', () => {
    const draft = {
      '1': { layoutX: 10, layoutY: 20 },
      '2': { layoutX: 30, layoutY: 40, firstName: 'Hugo' },
    }
    expect(buildManualPositionOverrides(draft)).toEqual({
      '1': { layoutX: 10, layoutY: 20 },
      '2': { layoutX: 30, layoutY: 40 },
    })
  })

  it('ignore les personnes sans position complète', () => {
    expect(buildManualPositionOverrides({ 3: { layoutX: 5 }, 4: { firstName: 'Anne' } })).toEqual({})
    expect(buildManualPositionOverrides(undefined)).toEqual({})
  })
})

describe("ligne « Position dans l'arbre » en relecture", () => {
  it('dit déplacée ou replacée automatiquement, sans coordonnée brute', () => {
    expect(describePositionChange(null, { layoutX: 320.5, layoutY: 110 })).toEqual({
      key: 'layout',
      label: "Position dans l'arbre",
      oldVal: undefined,
      newVal: 'Déplacée',
    })
    expect(describePositionChange({ layoutX: 320, layoutY: 110 }, { layoutX: null, layoutY: null })).toMatchObject({
      oldVal: 'Déplacée',
      newVal: 'Replacée automatiquement',
    })
  })

  it('montre le passage automatique vers déplacée, et rien si la ligne ne bouge pas de libellé', () => {
    expect(describePositionChange({ layoutX: null, layoutY: null }, { layoutX: 1, layoutY: 2 })).toMatchObject({
      oldVal: 'Automatique',
      newVal: 'Déplacée',
    })
    expect(describePositionChange({ layoutX: 1, layoutY: 2 }, { layoutX: 3, layoutY: 4 })).toMatchObject({
      oldVal: undefined,
      newVal: 'Déplacée',
    })
  })

  it('ne concerne pas une contribution qui ne touche pas la position', () => {
    expect(describePositionChange({ firstName: 'Anne' }, { firstName: 'Ana' })).toBeNull()
  })
})
