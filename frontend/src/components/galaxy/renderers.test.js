import { describe, it, expect } from 'vitest'
import { traceSibship } from './renderers'

// Contexte canvas minimal qui enregistre les appels de tracé
const recorder = () => {
  const calls = []
  const ctx = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]) } })
  return { ctx, calls, count: (n) => calls.filter(c => c[0] === n).length }
}
const src = { cx: 500, cy: 300 }

describe('traceSibship (accolade franche)', () => {
  it('trace toute la fratrie en un seul chemin et un seul stroke', () => {
    const { ctx, count } = recorder()
    traceSibship(ctx, 'u-1', src, [{ cx: 200, cy: 480 }, { cx: 420, cy: 480 }, { cx: 800, cy: 480 }])
    expect(count('beginPath')).toBe(1)
    expect(count('stroke')).toBe(1)
    expect(count('moveTo')).toBe(3)
  })

  it('un enfant seul rejoint la barre avec la même géométrie que dans la fratrie', () => {
    const child = { cx: 800, cy: 480 }
    const solo = recorder()
    traceSibship(solo.ctx, 'u-1', src, [child])
    const group = recorder()
    traceSibship(group.ctx, 'u-1', src, [child, { cx: 200, cy: 480 }])
    const soloArcs = solo.calls.filter(c => c[0] === 'arcTo')
    const groupArcs = group.calls.filter(c => c[0] === 'arcTo').slice(0, 2)
    expect(soloArcs.length).toBe(2)
    expect(groupArcs).toEqual(soloArcs)
  })

  it('un enfant à l\'aplomb de l\'union descend droit, sans virage', () => {
    const { ctx, count } = recorder()
    traceSibship(ctx, 'u-1', src, [{ cx: 505, cy: 480 }])
    expect(count('arcTo')).toBe(0)
  })
})
