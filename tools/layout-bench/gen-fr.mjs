// Arbres de test réalistes, au format de GET /trees/:id/graph. Personnes fictives, noms tirés au hasard,
// générateur déterministe (même graine = même arbre).
//   asc   : ce qu'importe un généalogiste. Un « moi » né en 1985, son ascendance sur 12 générations qui se
//           raréfie en remontant, les frères et sœurs de chaque ancêtre (familles nombreuses avant 1900),
//           une partie des collatéraux redescendus jusqu'à aujourd'hui, quelques mariages entre cousins (implexe).
//   desc  : ce que saisit une famille à la main. Un couple fondateur vers 1840, toute sa descendance, et pour
//           une partie des conjoints leurs parents et leur fratrie.
// Usage en script : node gen-fr.mjs <asc|desc> <sortie.json> [graine]
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const M = ['Jean', 'Pierre', 'Louis', 'Joseph', 'François', 'Jacques', 'Antoine', 'Michel', 'André', 'René', 'Henri', 'Paul', 'Marcel', 'Georges', 'Étienne', 'Claude', 'Nicolas', 'Julien', 'Thomas', 'Lucas', 'Hugo', 'Marc', 'Éric', 'Philippe', 'Gaston', 'Émile', 'Victor', 'Auguste', 'Alphonse', 'Lucien']
const F = ['Marie', 'Jeanne', 'Anne', 'Marguerite', 'Louise', 'Catherine', 'Françoise', 'Madeleine', 'Germaine', 'Suzanne', 'Odile', 'Hélène', 'Simone', 'Yvonne', 'Claire', 'Sophie', 'Julie', 'Camille', 'Léa', 'Emma', 'Nadia', 'Rose', 'Victorine', 'Joséphine', 'Eugénie', 'Augustine', 'Céline', 'Mireille', 'Isabelle', 'Anaïs']
const S = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guerin', 'Muller', 'Henry', 'Roussel', 'Nicolas', 'Perrin', 'Morin', 'Mathieu', 'Clement', 'Gauthier', 'Dumont', 'Lopez', 'Fontaine', 'Chevalier', 'Robin', 'Masson']

export function generate(kind, seedArg = 7, { implex = 0.08 } = {}) {
  let seed = Number(seedArg)
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1))

  const persons = [], unions = [], links = []
  const sibOrder = new Map()
  let pid = 0, uid = 0, lid = 0

  function person(sex, year, lastName, firstName) {
    const p = { id: `p${++pid}`, firstName: firstName || pick(sex === 'male' ? M : F), lastName, sex, birthDate: `${year}-01-01`, deathDate: year < 1935 ? `${year + between(40, 85)}-01-01` : null, _y: year, _married: false }
    persons.push(p)
    return p
  }
  function union(a, b) {
    const u = { id: `u${++uid}`, partner1PersonId: a.id, partner2PersonId: b.id, unionType: 'mariage', displayOrder: uid }
    unions.push(u)
    a._married = b._married = true
    return u
  }
  function link(child, u) {
    for (const par of [u.partner1PersonId, u.partner2PersonId]) {
      const n = (sibOrder.get(par) || 0) + 1
      sibOrder.set(par, n)
      links.push({ id: `l${++lid}`, childPersonId: child.id, parentPersonId: par, viaUnionId: u.id, parentageType: 'biologique', displayOrder: n })
    }
  }
  const familySize = (y) => y < 1850 ? between(3, 10) : y < 1920 ? between(2, 7) : y < 1960 ? between(1, 4) : between(1, 3)
  const spouseFor = (p) => person(p.sex === 'male' ? 'female' : 'male', p._y + between(-4, 4), pick(S))

  // Une fratrie autour d'un enfant déjà connu : frères et sœurs dans l'ordre de naissance
  function siblingsAround(known, u, father, { descend }) {
    const n = familySize(known._y)
    const at = between(0, n - 1)
    const kids = []
    for (let i = 0; i < n; i++) {
      if (i === at) { kids.push(known); continue }
      kids.push(person(rnd() < 0.5 ? 'male' : 'female', known._y + (i - at) * between(1, 3), father.lastName))
    }
    for (const k of kids) link(k, u)
    for (const k of kids) if (k !== known) descend(k)
    return kids
  }

  // Descendance d'un collatéral, jusqu'à aujourd'hui, qui s'amenuise
  function descendants(p, depth, pMarry, pKids) {
    if (p._y > 1995 || rnd() > pMarry) return
    const s = spouseFor(p)
    const u = union(p, s)
    if (depth <= 0 || rnd() > pKids) return
    const n = familySize(p._y + 28)
    const father = p.sex === 'male' ? p : s
    for (let i = 0; i < n; i++) {
      const k = person(rnd() < 0.5 ? 'male' : 'female', p._y + between(22, 34) + i * 2, father.lastName)
      link(k, u)
      descendants(k, depth - 1, pMarry, pKids * 0.8)
    }
  }

  if (kind === 'asc') {
    const cousins = []
    const me = person('male', 1985, 'Martin', 'Thomas')
    const maxDepth = 12
    function ascend(p, depth) {
      const pKnow = depth === 0 ? 1 : Math.max(0.3, 0.97 - depth * 0.06)
      if (depth >= maxDepth || rnd() > pKnow) return
      const y = p._y - between(24, 34)
      const father = person('male', y, p.lastName)
      let mother = null
      // Implexe : la mère est parfois une cousine déjà dans l'arbre (ses parents y sont déjà)
      if (depth >= 4 && rnd() < implex) {
        const c = cousins.find((c) => !c._married && c.sex === 'female' && Math.abs(c._y - y) <= 6)
        if (c) mother = c
      }
      const motherIsCousin = Boolean(mother)
      if (!mother) mother = person('female', y + between(-6, 3), pick(S))
      const u = union(father, mother)
      const recent = p._y > 1880
      siblingsAround(p, u, father, {
        descend: (k) => {
          cousins.push(k)
          if (recent) descendants(k, 3, 0.7, 0.6)
          else if (rnd() < 0.25) descendants(k, 2, 0.6, 0.5)
          else if (rnd() < 0.5) { const s = spouseFor(k); union(k, s) }
        },
      })
      ascend(father, depth + 1)
      if (!motherIsCousin) ascend(mother, depth + 1)
    }
    ascend(me, 0)
    const wife = person('female', 1987, 'Leroy', 'Julie')
    const u = union(me, wife)
    for (const n of ['Lucas', 'Emma']) link(person(n === 'Lucas' ? 'male' : 'female', 2015, 'Martin', n), u)
  } else if (kind === 'desc') {
    const a = person('male', 1838, 'Dupont', 'Jean'), b = person('female', 1842, 'Moreau', 'Marie')
    const root = union(a, b)
    function family(u, father, y, depth) {
      const n = familySize(y + 28)
      for (let i = 0; i < n; i++) {
        const k = person(rnd() < 0.5 ? 'male' : 'female', y + between(24, 32) + i * 2, father.lastName)
        link(k, u)
        if (k._y > 1995 || rnd() > 0.8) continue
        const s = spouseFor(k)
        // Un conjoint sur trois arrive avec ses parents et sa fratrie (la belle-famille saisie aussi)
        if (rnd() < 0.33) {
          const sf = person('male', s._y - between(25, 32), s.lastName), sm = person('female', s._y - between(23, 30), pick(S))
          const su = union(sf, sm)
          siblingsAround(s, su, sf, { descend: (sib) => { if (rnd() < 0.4) union(sib, spouseFor(sib)) } })
          if (rnd() < 0.3) { const gf = person('male', sf._y - 28, sf.lastName), gm = person('female', sf._y - 26, pick(S)); siblingsAround(sf, union(gf, gm), gf, { descend: () => {} }) }
        }
        const ku = union(k, s)
        if (depth < 6) family(ku, k.sex === 'male' ? k : s, k._y, depth + 1)
      }
    }
    family(root, a, a._y, 1)
  } else {
    throw new Error(`genre inconnu : ${kind} (asc ou desc)`)
  }

  for (const p of persons) { delete p._y; delete p._married }
  return { rootPersonId: 'p1', graph: { persons, unions, filiations: links, medias: [], annotations: [] } }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [kind, outFile, seedArg] = process.argv.slice(2)
  if (!kind || !outFile) { console.error('Usage : node gen-fr.mjs <asc|desc> <sortie.json> [graine]'); process.exit(1) }
  const out = generate(kind, seedArg || 7, { implex: Number(process.env.IMPLEX ?? 0.08) })
  writeFileSync(outFile, JSON.stringify(out))
  console.log(outFile, out.graph.persons.length, 'personnes', out.graph.unions.length, 'unions')
}
