import { describe, it, expect } from 'vitest'
import { computeBlockLayout, filCroiseAutreFamille, lineToFamily } from './blockLayout'
import { COMPACT_W, PERSON_W } from './constants'

const person = (id) => ({ id, firstName: id, lastName: '' })
const union = (id, partner1Id, partner2Id) => ({ id, partner1Id, partner2Id, displayOrder: 1 })
const fil = (id, childId, unionId) => ({ id, childId, parentId: null, unionId, parentageType: 'biologique', displayOrder: 1 })

describe('computeBlockLayout, conjoints isolés', () => {
  // pa + ma → enfant e, marié à s (sans parent ni enfant dans l'arbre)
  const graph = {
    persons: ['pa', 'ma', 'e', 's'].map(person),
    unions: [union('u1', 'pa', 'ma'), union('u2', 'e', 's')],
    filiations: [fil('f1', 'e', 'u1')],
  }

  it('dessine en petit le conjoint sans parent ni enfant, pas son partenaire', () => {
    const { children } = computeBlockLayout(graph)
    const byId = new Map(children.map(n => [n.id, n]))
    expect(byId.get('p-s')).toMatchObject({ _compact: true, width: COMPACT_W, _compactPartner: 'p-e' })
    expect(byId.get('p-e')._compact).toBeUndefined()
    expect(byId.get('p-e').width).toBe(PERSON_W)
    expect(byId.get('u-u2')).toMatchObject({ _compact: true, width: 0 })
  })

  it('colle le petit portrait à son partenaire', () => {
    const { children } = computeBlockLayout(graph)
    const byId = new Map(children.map(n => [n.id, n]))
    const center = (id) => byId.get(id).x + byId.get(id).width / 2
    expect(Math.abs(center('p-s') - center('p-e'))).toBeLessThan(80)
  })

  it('garde en taille normale un conjoint qui a des enfants', () => {
    const { children } = computeBlockLayout({
      ...graph,
      persons: [...graph.persons, person('k')],
      filiations: [...graph.filiations, fil('f2', 'k', 'u2')],
    })
    expect(children.find(n => n.id === 'p-s')._compact).toBeUndefined()
  })
})

describe('computeBlockLayout, ordre de la fratrie', () => {
  const kids = ['a', 'b', 'c']
  const graphWith = (orders) => ({
    persons: ['pa', 'ma', ...kids].map(person),
    unions: [union('u1', 'pa', 'ma')],
    filiations: kids.map((k, i) => ({ ...fil(`f-${k}`, k, 'u1'), displayOrder: orders[i] })),
  })
  const order = (graph) => {
    const { children } = computeBlockLayout(graph)
    return children.filter(n => kids.includes(n._data?.id)).sort((l, r) => l.x - r.x).map(n => n._data.id)
  }

  it('place les enfants selon displayOrder', () => {
    expect(order(graphWith([3, 1, 2]))).toEqual(['b', 'c', 'a'])
  })

  it("garde l'ordre d'arrivée quand displayOrder est égal partout", () => {
    expect(order(graphWith([1, 1, 1]))).toEqual(['a', 'b', 'c'])
  })
})

describe('computeBlockLayout, renvoi seulement si le fil croise une autre famille', () => {
  // Structure type : l'enfant (P) a sa fratrie à côté, son conjoint (Z) est dans la lignée de l'autre parent
  // Jacqueline + Roger ont 6 enfants, dont Marie, en couple avec Philippe ; Marcel + Yvette ont 5 enfants, dont Philippe
  const graph = {
    persons: ['jac', 'rog', 'marie', 'philippe', 'anais', 'greg', 'marcel', 'yvette', 'severine', 'isabelle', 'laurent', 'stephane', 'k1', 'k2', 'k3', 'k4', 'k5'].map(person),
    unions: [union('uJR', 'jac', 'rog'), union('uMP', 'marie', 'philippe'), union('uMY', 'marcel', 'yvette')],
    filiations: [
      ...['k1', 'k2', 'k3', 'k4', 'k5'].map((k, i) => fil(`f${k}`, k, 'uJR', i + 1)), fil('fmarie', 'marie', 'uJR', 6),
      fil('fa', 'anais', 'uMP'), fil('fg', 'greg', 'uMP'),
      fil('fs', 'severine', 'uMY', 1), fil('fi', 'isabelle', 'uMY', 2), fil('fl', 'laurent', 'uMY', 3),
      fil('fst', 'stephane', 'uMY', 4), fil('fp', 'philippe', 'uMY', 5),
    ],
  }

  it('garde le fil vers Philippe quand la fratrie de son autre famille est à côté de lui', () => {
    const { edges } = computeBlockLayout(graph)
    expect(edges.find(e => e.sources[0] === 'u-uMY' && e.targets[0] === 'p-philippe')._renvoi).toBeUndefined()
  })
})

describe('filCroiseAutreFamille', () => {
  // Ligne d'une génération : union u (aplomb x=0 à 120), enfant c en x=600
  const at = (id, x, type = 'person', gen = 1) => ({ id, x, width: 120, _type: type, _generation: gen })
  const base = () => [at('u', 0, 'union', 0), at('c', 600), at('sib', 300), at('spouse', 700), at('other', 400)]
  const childrenOfUnion = new Map([['u', ['c', 'sib']]])
  const spouseKeysOf = new Map([['c', new Set(['spouse'])]])

  it('croise quand une personne d\'une autre famille est entre l\'union et l\'enfant', () => {
    expect(filCroiseAutreFamille(base(), childrenOfUnion, spouseKeysOf, 'u', 'c')).toBe(true)
  })

  it('ne croise pas quand seuls les frères et sœurs sont entre l\'union et l\'enfant', () => {
    const nodes = base().filter(n => n.id !== 'other')
    expect(filCroiseAutreFamille(nodes, childrenOfUnion, spouseKeysOf, 'u', 'c')).toBe(false)
  })

  it('ne croise pas pour le conjoint de l\'enfant placé du côté de l\'enfant', () => {
    const nodes = base().filter(n => n.id !== 'other').map(n => n.id === 'spouse' ? { ...n, x: 300 } : n)
    expect(filCroiseAutreFamille(nodes, childrenOfUnion, spouseKeysOf, 'u', 'c')).toBe(false)
  })

  it('ne croise pas pour le conjoint d\'un frère ou d\'une sœur', () => {
    const nodes = base().filter(n => n.id !== 'other').concat(at('beaufrere', 420))
    const spouses = new Map([...spouseKeysOf, ['sib', new Set(['beaufrere'])]])
    expect(filCroiseAutreFamille(nodes, childrenOfUnion, spouses, 'u', 'c')).toBe(false)
  })

  it('ignore une personne d\'une autre génération sur la même abscisse', () => {
    const nodes = base().filter(n => n.id !== 'other').concat(at('x', 400, 'person', 2))
    expect(filCroiseAutreFamille(nodes, childrenOfUnion, spouseKeysOf, 'u', 'c')).toBe(false)
  })
})

describe('computeBlockLayout, couple tourné vers les familles de chacun', () => {
  // Marc (fratrie de Louis et Hélène) épouse Nadia (fratrie de Pierre et Odile). La fratrie de Nadia est saisie
  // en premier, Marc avant Nadia : Marc se retrouvait à gauche du couple alors que sa famille est à droite,
  // et les deux fils se croisaient.
  const graph = {
    persons: ['pierre', 'odile', 'louis', 'helene', 'marc', 'claire', 'julien', 'sophie', 'eric', 'luc', 'paul', 'mireille', 'nadia', 'anais'].map(person),
    unions: [union('uPO', 'pierre', 'odile'), { ...union('uLH', 'louis', 'helene'), displayOrder: 2 }, { ...union('uMN', 'marc', 'nadia'), displayOrder: 3 }],
    filiations: [
      ...['luc', 'paul', 'mireille', 'nadia'].map((k, i) => ({ ...fil(`f-${k}`, k, 'uPO'), displayOrder: i + 1 })),
      ...['marc', 'claire', 'julien', 'sophie', 'eric'].map((k, i) => ({ ...fil(`f-${k}`, k, 'uLH'), displayOrder: i + 1 })),
      fil('f-anais', 'anais', 'uMN'),
    ],
  }

  it('place chaque conjoint du côté de ses propres parents', () => {
    const { children } = computeBlockLayout(graph)
    const x = (id) => { const n = children.find(c => c.id === id); return n.x + n.width / 2 }
    expect(Math.sign(x('p-marc') - x('p-nadia'))).toBe(Math.sign(x('u-uLH') - x('u-uPO')))
  })
})

describe('lineToFamily, ligne directe vers un onglet de famille', () => {
  // gp + gm → mere (+ pere) → moi ; mere a un frère (oncle) ; gm vient de la famille B (b1 + b2 → gm, b1 frère bx)
  const graph = {
    persons: ['gp', 'gm', 'mere', 'pere', 'oncle', 'moi', 'b1', 'b2', 'bx'].map(person),
    unions: [union('u1', 'gp', 'gm'), union('u2', 'pere', 'mere'), union('u3', 'b1', 'b2')],
    filiations: [fil('f1', 'mere', 'u1'), fil('f2', 'oncle', 'u1'), fil('f3', 'moi', 'u2'), fil('f4', 'gm', 'u3'), fil('f5', 'bx', 'u3')],
  }

  it("rend le chemin jusqu'au premier membre, avec les deux parents à chaque pas, sans fratrie", () => {
    const line = lineToFamily('moi', ['gm', 'b1', 'b2', 'bx'], graph)
    expect([...line].sort()).toEqual(['gp', 'mere', 'moi', 'pere'])
  })

  it('rend un ensemble vide si la personne est déjà membre ou inconnue', () => {
    expect(lineToFamily('gm', ['gm', 'b1'], graph).size).toBe(0)
    expect(lineToFamily('personne', ['gm'], graph).size).toBe(0)
    expect(lineToFamily(null, ['gm'], graph).size).toBe(0)
  })

  it('se dessine en entier avec la famille', () => {
    const members = ['gm', 'b1', 'b2', 'bx']
    const line = lineToFamily('moi', members, graph)
    const keep = new Set([...members, ...line])
    const sub = {
      persons: graph.persons.filter(p => keep.has(p.id)),
      unions: graph.unions.filter(u => keep.has(u.partner1Id) && keep.has(u.partner2Id)),
      filiations: graph.filiations.filter(f => keep.has(f.childId)),
    }
    const drawn = new Set(computeBlockLayout(sub, 'gm').children.filter(n => n._type === 'person').map(n => n.id))
    for (const id of line) expect(drawn.has(`p-${id}`)).toBe(true)
    expect(drawn.has('p-oncle')).toBe(false)
  })
})
