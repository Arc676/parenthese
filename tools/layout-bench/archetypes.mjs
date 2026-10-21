// Archétypes : petits arbres de 6 à 40 personnes, un par situation que le placement doit savoir dessiner.
// Format d'entrée de computeLayout (persons, unions, filiations). Aucune dépendance, importable par vitest.
// Le rendu texte validé de chacun est le témoin : frontend/src/components/galaxy/__snapshots__/archetypes/.

const P = (id, extra = {}) => ({ id, firstName: id, lastName: '', ...extra })
const U = (id, a, b, displayOrder = 1) => ({ id, partner1Id: a, partner2Id: b, displayOrder })
const L = (childId, unionId, displayOrder = 1, parentageType = 'biologique') => ({ id: `f-${childId}-${unionId}`, childId, unionId, parentId: null, parentageType, displayOrder })
const D = (childId, parentId, displayOrder = 1) => ({ id: `f-${childId}-${parentId}`, childId, unionId: null, parentId, parentageType: 'biologique', displayOrder })
const ids = (...lists) => lists.flat().map((x) => (typeof x === 'string' ? P(x) : x))

export const archetypes = [
  {
    slug: 'fratrie-ordre',
    note: "Trois enfants dans l'ordre choisi par la famille (C, A, B), pas celui de saisie.",
    reference: 'A',
    graph: {
      persons: ids(['Pa', 'Ma', 'A', 'B', 'C']),
      unions: [U('u', 'Pa', 'Ma')],
      filiations: [L('A', 'u', 2), L('B', 'u', 3), L('C', 'u', 1)],
    },
  },
  {
    slug: 'issue-67',
    note: 'Lignée de la mère sur trois générations, lignée du père sur deux. Les deux couples de grands-parents partagent une rangée.',
    reference: 'Kid',
    graph: {
      persons: ids(['GGGa', 'GGGb', 'GGa', 'GGb', 'GM1', 'GF1', 'M', 'GM2', 'GF2', 'GGx', 'GGy', 'F', 'Kid']),
      unions: [U('u1', 'GGGa', 'GGGb'), U('u2', 'GGa', 'GGb'), U('u3', 'GM1', 'GF1'), U('u4', 'GM2', 'GF2'), U('u5', 'M', 'F')],
      filiations: [L('GGa', 'u1'), L('GM1', 'u2'), L('M', 'u3'), L('F', 'u4'), L('Kid', 'u5'), D('GM2', 'GGy'), D('GF2', 'GGx')],
    },
  },
  {
    slug: 'branche-courte',
    note: 'Branche courte (B0 → Y et son frère S) mariée dans une branche longue (A0 → A3 → X). Toute la branche courte descend.',
    reference: 'K',
    graph: {
      persons: ids(['A0', 'A0w', 'A1', 'A1w', 'A2', 'A2w', 'A3', 'A3w', 'X', 'B0', 'B0w', 'Y', 'S', 'K']),
      unions: [U('uA0', 'A0', 'A0w'), U('uA1', 'A1', 'A1w'), U('uA2', 'A2', 'A2w'), U('uA3', 'A3', 'A3w'), U('uB0', 'B0', 'B0w'), U('uXY', 'X', 'Y')],
      filiations: [L('A1', 'uA0'), L('A2', 'uA1'), L('A3', 'uA2'), L('X', 'uA3'), L('Y', 'uB0', 1), L('S', 'uB0', 2), L('K', 'uXY')],
    },
  },
  {
    slug: 'marc-nadia',
    note: 'Deux fratries saisies à la main, un enfant de chaque se marie (cas Anaïs). Le couple se tourne vers ses familles.',
    reference: 'Anais',
    graph: {
      persons: ids(['Pierre', 'Odile', 'Louis', 'Helene', 'Luc', 'Paul', 'Mireil', 'Nadia', 'Marc', 'Claire', 'Julien', 'Sophie', 'Eric', 'Anais']),
      unions: [U('uN', 'Pierre', 'Odile'), U('uB', 'Louis', 'Helene'), U('uM', 'Marc', 'Nadia')],
      filiations: [
        L('Luc', 'uN', 1), L('Paul', 'uN', 2), L('Mireil', 'uN', 3), L('Nadia', 'uN', 4),
        L('Marc', 'uB', 1), L('Claire', 'uB', 2), L('Julien', 'uB', 3), L('Sophie', 'uB', 4), L('Eric', 'uB', 5),
        L('Anais', 'uM'),
      ],
    },
  },
  {
    slug: 'petit-conjoint',
    note: 'E2 épouse S2, sans parent ni enfant dans l arbre : petit portrait collé. S1 a un enfant : taille normale.',
    reference: 'E1',
    graph: {
      persons: ids(['Pa', 'Ma', 'E1', 'E2', 'S1', 'S2', 'K']),
      unions: [U('u', 'Pa', 'Ma'), U('u1', 'E1', 'S1'), U('u2', 'E2', 'S2')],
      filiations: [L('E1', 'u', 1), L('E2', 'u', 2), L('K', 'u1')],
    },
  },
  {
    slug: 'fratrie-12',
    note: 'Douze enfants, chacun marié, les six premiers avec deux enfants, les autres avec un. La ligne de fratrie est longue, c est normal.',
    reference: 'K1',
    graph: (() => {
      const persons = ids(['Pa', 'Ma'])
      const unions = [U('u', 'Pa', 'Ma')]
      const filiations = []
      for (let i = 1; i <= 12; i++) {
        persons.push(P(`K${i}`), P(`S${i}`))
        unions.push(U(`u${i}`, `K${i}`, `S${i}`))
        filiations.push(L(`K${i}`, 'u', i))
        const n = i <= 6 ? 2 : 1
        for (let j = 1; j <= n; j++) { persons.push(P(`K${i}${String.fromCharCode(96 + j)}`)); filiations.push(L(`K${i}${String.fromCharCode(96 + j)}`, `u${i}`, j)) }
      }
      return { persons, unions, filiations }
    })(),
  },
  {
    slug: 'remariage',
    note: 'H a deux unions, deux enfants de la première, un de la seconde. Les deux foyers restent côte à côte.',
    reference: 'A',
    graph: {
      persons: ids(['H', 'W1', 'W2', 'A', 'B', 'C']),
      unions: [U('u1', 'H', 'W1', 1), U('u2', 'H', 'W2', 2)],
      filiations: [L('A', 'u1', 1), L('B', 'u1', 2), L('C', 'u2')],
    },
  },
  {
    slug: 'cousins',
    note: 'Deux cousins germains se marient (implexe de même degré). Aucun conflit de rangée.',
    reference: 'K',
    graph: {
      persons: ids(['G', 'Gw', 'P1', 'P1w', 'P2', 'P2w', 'C1', 'C2', 'K']),
      unions: [U('uG', 'G', 'Gw'), U('u1', 'P1', 'P1w'), U('u2', 'P2', 'P2w'), U('uC', 'C1', 'C2')],
      filiations: [L('P1', 'uG', 1), L('P2', 'uG', 2), L('C1', 'u1'), L('C2', 'u2'), L('K', 'uC')],
    },
  },
  {
    slug: 'oncle-niece',
    note: 'O épouse N, la fille de son frère P. Conflit de rangée assumé : les conjoints restent ensemble, un fil saute.',
    reference: 'G',
    graph: {
      persons: ids(['G', 'Gw', 'O', 'P', 'Pw', 'N']),
      unions: [U('uG', 'G', 'Gw'), U('uP', 'P', 'Pw'), U('uON', 'O', 'N')],
      filiations: [L('O', 'uG', 1), L('P', 'uG', 2), L('N', 'uP')],
    },
  },
  {
    slug: 'parent-seul',
    note: 'M seule avec deux enfants (partenaire inconnu). X et Y, jamais en couple, ont un enfant Z (couple séparé en pointillés).',
    reference: 'A',
    graph: {
      persons: ids(['M', 'A', 'B', 'X', 'Y', 'Z']),
      unions: [],
      filiations: [D('A', 'M', 1), D('B', 'M', 2), D('Z', 'X'), D('Z', 'Y')],
    },
  },
  {
    slug: 'adoption',
    note: 'A est né du couple, B est adopté. Même fratrie, le fil de B est pointillé.',
    reference: 'A',
    graph: {
      persons: ids(['Pa', 'Ma', 'A', 'B']),
      unions: [U('u', 'Pa', 'Ma')],
      filiations: [L('A', 'u', 1), L('B', 'u', 2, 'adoption')],
    },
  },
  {
    slug: 'deux-familles',
    note: 'Deux familles sans lien entre elles, datées : la seconde se cale sur les années de la première.',
    reference: 'A',
    graph: {
      persons: ids([P('A', { birthDate: '1900-01-01' }), P('Aw', { birthDate: '1902-01-01' }), P('B', { birthDate: '1930-01-01' }), P('Bw', { birthDate: '1931-01-01' }), P('E', { birthDate: '1960-01-01' }),
        P('C', { birthDate: '1932-01-01' }), P('Cw', { birthDate: '1935-01-01' }), P('D', { birthDate: '1961-01-01' })]),
      unions: [U('ua', 'A', 'Aw'), U('ub', 'B', 'Bw'), U('uc', 'C', 'Cw')],
      filiations: [L('B', 'ua'), L('E', 'ub'), L('D', 'uc')],
    },
  },
  {
    slug: 'belle-famille',
    note: 'E (de la référence) épouse S, dont les parents, la fratrie et les grands-parents sont saisis. La belle-famille se pose à côté.',
    reference: 'E',
    graph: {
      persons: ids(['Pa', 'Ma', 'E', 'E2', 'S', 'S2', 'S3', 'SP', 'SM', 'SG', 'SGw', 'K1', 'K2']),
      unions: [U('u', 'Pa', 'Ma'), U('uE', 'E', 'S'), U('uS', 'SP', 'SM'), U('uG', 'SG', 'SGw')],
      filiations: [L('E', 'u', 1), L('E2', 'u', 2), L('S', 'uS', 1), L('S2', 'uS', 2), L('S3', 'uS', 3), L('SP', 'uG'), L('K1', 'uE', 1), L('K2', 'uE', 2)],
    },
  },
  {
    slug: 'trois-belles-familles',
    note: 'A1 épouse B1, B2 épouse C1 : trois familles enchaînées par deux mariages.',
    reference: 'X',
    graph: {
      persons: ids(['A', 'Aw', 'A1', 'A2', 'B', 'Bw', 'B1', 'B2', 'C', 'Cw', 'C1', 'X', 'Y']),
      unions: [U('uA', 'A', 'Aw'), U('uB', 'B', 'Bw'), U('uC', 'C', 'Cw'), U('uAB', 'A1', 'B1'), U('uBC', 'B2', 'C1')],
      filiations: [L('A1', 'uA', 1), L('A2', 'uA', 2), L('B1', 'uB', 1), L('B2', 'uB', 2), L('C1', 'uC'), L('X', 'uAB'), L('Y', 'uBC')],
    },
  },
]
