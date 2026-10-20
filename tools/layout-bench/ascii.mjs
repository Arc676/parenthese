// Rendu texte d'un placement : une ligne par rangée, étiquettes centrées sur l'abscisse de chaque nœud,
// fils de fratrie en caractères de boîte entre deux rangées. Lisible dans un terminal, comparable en CI.
//
//   Pa ─ • ─ Ma            personnes et union (•) d'un couple, sur la même ligne
//          │               descente de l'union vers la ligne de fratrie
//     ┬────┴────┬          ligne de fratrie, ┴ sous l'union, ┬ au-dessus de chaque enfant
//     │         │          descente vers chaque enfant
//     A         B
//   ═                      deux lignes de fratrie qui se superposent
//   pa (minuscules)        petit conjoint (sans parent ni enfant dans l'arbre)
//   renvoi : ...           filiation dessinée en pastilles, pas en fil

export function renderAscii(result, coupleBarMeta, { px = 20 } = {}) {
  const nodes = result.children
  if (!nodes.length) return ''
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const minX = Math.min(...nodes.map((n) => n.x))
  const col = (x) => Math.round((x - minX) / px)
  const cx = (n) => n.x + n.width / 2
  const width = Math.max(...nodes.map((n) => col(n.x + n.width))) + 4
  const label = (n) => {
    if (n._type === 'union') return n._compact ? '' : '•'
    if (n._type === 'unknown') return '?'
    const text = String(n._data?.firstName || n.id).slice(0, 6)
    return n._compact ? text.toLowerCase() : text
  }
  const line = () => Array(width).fill(' ')
  const put = (arr, c, s) => {
    const start = Math.max(0, c - Math.floor(s.length / 2))
    for (let i = 0; i < s.length && start + i < arr.length; i++) arr[start + i] = s[i]
  }
  const gens = [...new Set(nodes.map((n) => n._generation))].sort((a, b) => a - b)
  const kidsOf = new Map()
  const renvois = []
  for (const e of result.edges) {
    if (e._renvoi) { renvois.push(e); continue }
    if (!kidsOf.has(e.sources[0])) kidsOf.set(e.sources[0], [])
    kidsOf.get(e.sources[0]).push(e.targets[0])
  }
  const out = []
  for (const g of gens) {
    const row = line()
    // traits de couple, puis étiquettes par-dessus
    for (const c of coupleBarMeta) {
      const p1 = byId.get(c.p1Key), p2 = byId.get(c.p2Key), u = byId.get(c.elkId)
      if (!p1 || !p2 || !u || p1._generation !== g) continue
      const from = Math.min(col(cx(p1)), col(cx(p2))), to = Math.max(col(cx(p1)), col(cx(p2)))
      for (let i = from; i <= to; i++) row[i] = c.virtual ? '┄' : '─'
    }
    for (const n of nodes) if (n._generation === g) put(row, col(cx(n)), label(n))
    out.push(row)
    const drop1 = line(), bus = line(), drop2 = line()
    const coverage = new Array(width).fill(0)
    let any = false
    for (const n of nodes) {
      if (n._generation !== g || (n._type !== 'union')) continue
      const kids = (kidsOf.get(n.id) || []).map((id) => byId.get(id)).filter(Boolean)
      if (!kids.length) continue
      any = true
      const uc = col(cx(n))
      const cols = [uc, ...kids.map((k) => col(cx(k)))]
      const l = Math.min(...cols), r = Math.max(...cols)
      for (let i = l; i <= r; i++) { if (bus[i] === ' ') bus[i] = '─'; coverage[i]++ }
      drop1[uc] = '│'
      bus[uc] = '┴'
      for (const k of kids) { const kc = col(cx(k)); bus[kc] = kc === uc ? '┼' : '┬'; drop2[kc] = '│' }
    }
    for (let i = 0; i < width; i++) if (coverage[i] > 1 && bus[i] === '─') bus[i] = '═'
    if (any) out.push(drop1, bus, drop2)
  }
  const lines = out.map((l) => l.join('').trimEnd())
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length))
  const text = lines.map((l) => l.slice(indent)).join('\n')
  const extra = renvois.map((e) => {
    const u = byId.get(e.sources[0]), k = byId.get(e.targets[0])
    const c = coupleBarMeta.find((m) => m.elkId === u?.id)
    const parents = c ? `${label(byId.get(c.p1Key) || {})}+${label(byId.get(c.p2Key) || {})}` : u?.id
    return `renvoi : ${parents} → ${label(k || {})}`
  })
  return [text, ...extra].join('\n')
}
