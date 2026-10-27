// Ouverture d'un arbre dans un navigateur headless (CDP, sans dépendance) : temps jusqu'à l'arbre utilisable,
// jusqu'à la barre des onglets, et fonctions les plus coûteuses pendant le chargement.
// Usage : [TREE_PASSWORD='...'] node load-probe.mjs <url> [nom] [répétitions]
//   url : un arbre sur un front local, de préférence un build (`vite build --minify false` puis `vite preview` :
//         le mode dev fausse les temps, la minification les noms du profil)
//   CPU=4 ralentit le processeur comme un téléphone moyen ; W et H fixent la fenêtre (1600 × 900).
// L'arbre est utilisable quand deux images passent après son chargement : le placement bloque le fil principal.
// Avec ?fixture= (chargeur local, jamais commité), on attend window.__pzFixtureLoaded posé par ce chargeur.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const URL_ = process.argv[2]
const NAME = process.argv[3] || 'arbre'
const RUNS = Number(process.argv[4] || 1)
const PASSWORD = process.env.TREE_PASSWORD
const BRAVE = process.env.BRAVE_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
const CPU = Number(process.env.CPU || 1)
const W = Number(process.env.W || 1600), H = Number(process.env.H || 900)
if (!URL_) { console.error('usage : node load-probe.mjs <url> [nom] [répétitions]'); process.exit(1) }
const FIXTURE = new URL(URL_).searchParams.has('fixture')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id) { const p = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result) } } }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })) }
  async eval(expression, awaitPromise = true) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value }
}

function topFunctions(profile, n) {
  const byNode = new Map(profile.nodes.map(x => [x.id, x])); const self = new Map()
  profile.samples.forEach((id, i) => { const cf = byNode.get(id).callFrame
    const key = `${cf.functionName || '(anonyme)'} ${cf.url.split('/').slice(-1)[0].split('?')[0]}:${cf.lineNumber + 1}`
    self.set(key, (self.get(key) || 0) + (profile.timeDeltas[i] || 0)) })
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([fn, us]) => ({ fn, ms: Math.round(us / 1000) }))
}

async function once() {
  const port = 9333 + Math.floor(Math.random() * 400)
  const profileDir = mkdtempSync(path.join(tmpdir(), 'parenthese-load-'))
  const browser = spawn(BRAVE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `--window-size=${W},${H}`,
    '--no-first-run', '--disable-extensions', '--disable-features=Translate,BraveRewards,BraveAds', 'about:blank'], { stdio: 'ignore' })
  try {
    let version
    for (let i = 0; i < 100 && !version; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) version = await r.json() } catch {} if (!version) await sleep(200) }
    const bws = new WebSocket(version.webSocketDebuggerUrl); await new Promise(r => bws.onopen = r)
    const { targetId } = await new CDP(bws).send('Target.createTarget', { url: 'about:blank' })
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const pws = new WebSocket(list.find(t => t.id === targetId).webSocketDebuggerUrl); await new Promise(r => pws.onopen = r)
    const p = new CDP(pws)
    await p.send('Page.enable'); await p.send('Runtime.enable')
    await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
    if (CPU > 1) await p.send('Emulation.setCPUThrottlingRate', { rate: CPU })
    await p.send('Profiler.enable'); await p.send('Profiler.setSamplingInterval', { interval: 250 })
    await p.send('Profiler.start')
    const t0 = Date.now()
    await p.send('Page.navigate', { url: URL_ })
    if (PASSWORD) {
      for (let i = 0; i < 100; i++) { if (await p.eval(`!!document.querySelector('input[type=password]')`, false).catch(() => false)) break; await sleep(100) }
      await p.eval(`(() => {
        const input = document.querySelector('input[type=password]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(PASSWORD)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        ;[...document.querySelectorAll('button')].find(b => /ouvrir/i.test(b.textContent))?.click()
      })()`, false)
    }
    const loaded = FIXTURE ? `window.__pzFixtureLoaded === true` : `!!document.querySelector('canvas.galaxy-canvas')`
    for (let i = 0; i < 600; i++) { if (await p.eval(loaded, false).catch(() => false)) break; await sleep(50) }
    await p.eval(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    const tree = Date.now() - t0
    let tabs = null
    for (let i = 0; i < 600; i++) { if (await p.eval(`document.querySelectorAll('.family-tab').length > 1`, false).catch(() => false)) { tabs = Date.now() - t0; break } await sleep(50) }
    const { profile } = await p.send('Profiler.stop')
    return { tree, tabs, top: topFunctions(profile, 10) }
  } finally {
    try { browser.kill() } catch {}
    try { rmSync(profileDir, { recursive: true, force: true }) } catch {}
  }
}

const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await once())
const median = (xs) => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
console.log(JSON.stringify({
  name: NAME, url: URL_, cpu: CPU, runs: RUNS,
  tree_ms: median(runs.map(r => r.tree)), tabs_ms: median(runs.map(r => r.tabs)),
  each: runs.map(r => [r.tree, r.tabs]), cpu_top_first_run: runs[0].top,
}, null, 1))
process.exit(0)
