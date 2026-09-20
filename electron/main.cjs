const { app, BrowserWindow, ipcMain, powerMonitor, Menu, MenuItem, shell, session } = require('electron')
const os = require('os')
const path = require('path')
const fs = require('fs')
// The app was renamed to "Out Past", but all existing data (tasks, mission, calendar
// tokens, sleep log, media, memories) lives under the old "Grow" data folder. Pin the
// user-data path to "Grow" so nothing is orphaned. MUST run before store.cjs, which
// reads app.getPath('userData') at import time.
try { app.setPath('userData', path.join(app.getPath('appData'), 'Grow')) } catch (e) {}

const store = require('./store.cjs')
const google = require('./google.cjs')
const https = require('https')
const http = require('http')
const { exec, execFileSync, spawn } = require('child_process')

// ---------------------------------------------------------------------------
// KAI local brain. No cloud, no key, no cost. Two on-device engines, tried in
// order, both fed the Kidus Brain context the renderer builds:
//   A) Apple Intelligence, through the bundled `afm` helper (macOS 26+, Apple
//      silicon). Best answers, instant, nothing leaves the Mac.
//   B) A ~1GB local model through Ollama. The offline safety net.
// If neither is ready the handler returns { answer: null } and the renderer
// answers from the Kidus Brain itself, so KAI never errors and never hangs.
// ---------------------------------------------------------------------------
const OLLAMA = { host: '127.0.0.1', port: 11434 }
const OLLAMA_MODEL = process.env.KAI_MODEL || 'qwen2.5:1.5b' // ~1GB general model
let ollamaPulling = false

function afmPath() {
  // dev: build/afm next to the repo; packaged: Resources/afm (extraResources)
  const dev = path.join(__dirname, '..', 'build', 'afm')
  const packed = path.join(process.resourcesPath || '', 'afm')
  if (fs.existsSync(packed)) return packed
  if (fs.existsSync(dev)) return dev
  return null
}

function appleAnswer(system, prompt) {
  return new Promise((resolve) => {
    const bin = afmPath()
    if (!bin || process.platform !== 'darwin' || process.arch !== 'arm64') return resolve(null)
    let out = ''
    let done = false
    let child
    try { child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] }) } catch (e) { return resolve(null) }
    const finish = (v) => { if (done) return; done = true; try { child.kill() } catch (e) {} resolve(v) }
    const timer = setTimeout(() => finish(null), 45000)
    child.stdout.on('data', (d) => { out += d.toString() })
    child.on('error', () => { clearTimeout(timer); finish(null) })
    child.on('close', () => {
      clearTimeout(timer)
      try { const j = JSON.parse(out); finish(j && j.answer ? j.answer : null) } catch (e) { finish(null) }
    })
    try { child.stdin.write(JSON.stringify({ system: system || '', prompt: String(prompt || '') })); child.stdin.end() } catch (e) { clearTimeout(timer); finish(null) }
  })
}

function ollamaReq(pathname, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = http.request({
      host: OLLAMA.host, port: OLLAMA.port, path: pathname,
      method: body ? 'POST' : 'GET', headers: payload ? { 'content-type': 'application/json' } : {}
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs || 60000, () => { req.destroy(new Error('timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

async function ollamaModels() {
  try { const t = await ollamaReq('/api/tags', null, 4000); return (t.models || []).map((m) => m.name) } catch (e) { return null }
}

function pickModel(names) {
  if (!names || !names.length) return null
  if (names.includes(OLLAMA_MODEL)) return OLLAMA_MODEL
  const gen = names.find((n) => /qwen|llama|mistral|gemma|phi/i.test(n) && !/coder|code/i.test(n))
  return gen || names[0]
}

function ensureModel(names) {
  // Pull the ~1GB general model once in the background so the fallback becomes
  // available for next time. Never blocks an answer.
  if (ollamaPulling) return
  if (names && names.includes(OLLAMA_MODEL)) return
  ollamaPulling = true
  const req = http.request({ host: OLLAMA.host, port: OLLAMA.port, path: '/api/pull', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    res.on('data', () => {})
    res.on('end', () => { ollamaPulling = false })
  })
  req.on('error', () => { ollamaPulling = false })
  try { req.write(JSON.stringify({ name: OLLAMA_MODEL })); req.end() } catch (e) { ollamaPulling = false }
}

async function ollamaAnswer(system, prompt) {
  const names = await ollamaModels()
  if (names === null) return null // Ollama not running / not installed
  const model = pickModel(names)
  if (!model) { ensureModel(names); return null }
  try {
    const r = await ollamaReq('/api/chat', {
      model, stream: false,
      messages: [system ? { role: 'system', content: system } : null, { role: 'user', content: String(prompt || '') }].filter(Boolean)
    }, 90000)
    const ans = r && r.message && r.message.content
    if (!names.includes(OLLAMA_MODEL)) ensureModel(names) // upgrade to the 1GB model for next time
    return ans || null
  } catch (e) { return null }
}

const isDev = process.env.ELECTRON_DEV === '1'
let win = null

function createWindow() {
  // Open on the BUILT-IN screen, not whichever display is set as Main. Relaunching
  // onto the main monitor interrupts whatever is up there.
  const { screen } = require('electron')
  let winBounds = null
  try {
    const displays = screen.getAllDisplays()
    const builtIn = displays.find((d) => d.internal) || null
    if (builtIn) winBounds = builtIn.workArea
    console.log('[OutPast] displays:', displays.map((d) => ({ id: d.id, internal: !!d.internal, bounds: d.bounds })))
    console.log('[OutPast] opening on:', builtIn ? 'BUILT-IN' : 'default (no internal display found)', winBounds)
  } catch (e) { console.log('[OutPast] display pick failed', e && e.message) }

  win = new BrowserWindow({
    title: 'Out Past',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    // Placed last so it wins over the defaults above.
    ...(winBounds ? { x: winBounds.x, y: winBounds.y, width: winBounds.width, height: winBounds.height } : {}),
    backgroundColor: '#0b0f10',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // KAI greets a new machine out loud the moment the window opens, with
      // nobody having clicked anything yet, so the window must be allowed to
      // make sound on its own.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  win.maximize()

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { win = null })

  // Native right-click menu in text fields: spelling suggestions + edit actions.
  try { win.webContents.session.setSpellCheckerLanguages(['en-US']) } catch (e) {}
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return
    const menu = new Menu()
    for (const s of (params.dictionarySuggestions || [])) {
      menu.append(new MenuItem({ label: s, click: () => win.webContents.replaceMisspelling(s) }))
    }
    if ((params.dictionarySuggestions || []).length) menu.append(new MenuItem({ type: 'separator' }))
    if (params.misspelledWord) {
      menu.append(new MenuItem({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }))
      menu.append(new MenuItem({ type: 'separator' }))
    }
    menu.append(new MenuItem({ role: 'cut' }))
    menu.append(new MenuItem({ role: 'copy' }))
    menu.append(new MenuItem({ role: 'paste' }))
    menu.append(new MenuItem({ role: 'selectAll' }))
    menu.popup()
  })
}

async function autoRefresh(reason) {
  // Let failures propagate so the UI can show "sync failed" instead of silently
  // keeping stale data and pretending it worked.
  const data = await google.fetchEvents()
  store.set('calendarCache', data)
  if (win) win.webContents.send('calendar:updated', data)
  return data
}

// Record a sleep period so the renderer (GAI greeting) can say "you slept Xh".
// Ignores anything under a minute (quick lid flick).
// Record time the machine was off/away. `greet` = true only for REAL sleep
// (shutdown or a confirmed manual sleep) — that's when GAI says "you slept X".
// Lid-close/away is carved out too (so moving never counts as wasted) but does
// NOT greet. Always carves into sleepLog so the day math excludes it.
function recordSleepRange(start, end, source, greet) {
  const ms = end - start
  if (!ms || ms < 60 * 1000) return
  const log = store.get('sleepLog') || []
  log.push({ start, end, source })
  store.set('sleepLog', log.slice(-300))
  if (greet) store.set('lastSleep', { ms, at: end, source })
  // Always tell the app (so it can drop a Sleep block on the calendar). greet marks
  // real, confirmed sleep — the app only shows the "you slept X" war-cry for those.
  if (win && !win.isDestroyed()) win.webContents.send('sleep:detected', { ms, source, start, end, greet })
}
function recordSleep(ms, source, greet) {
  if (!ms || ms < 60 * 1000) return
  const end = Date.now()
  recordSleepRange(end - ms, end, source, greet)
}

// When did this machine last boot? Rock-solid wall-clock instant from the OS.
// os.uptime() is seconds since boot on every platform.
function bootTimeMs() {
  return Date.now() - Math.round(os.uptime() * 1000)
}

app.whenReady().then(() => {
  // Open the app automatically when you log in to your Mac.
  if (!app.isPackaged) { /* skip in dev */ } else {
    try { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false }) } catch (e) {}
  }

  // --- Sleep detection. Differentiate Mac sleep / shutdown from an app close. ---
  // Compute any sleep that happened BEFORE this launch:
  try {
    const prevAlive = store.get('lastAlive')          // last heartbeat before we died
    const bootMs = bootTimeMs()                        // when the Mac actually powered on
    const suspendAt = store.get('suspendAt')
    const lastQuit = store.get('lastQuit')
    // If the machine BOOTED after our last heartbeat, it was powered OFF that
    // whole span = real sleep. This is the reliable signal — powerMonitor's
    // 'shutdown' event is missed on macOS (the OS kills us first), so trust the
    // boot clock, not lastQuit. Guard: only if it really rebooted (boot after
    // last heartbeat by >2 min) so a same-session app relaunch never counts.
    if (prevAlive && bootMs > prevAlive + 2 * 60 * 1000) {
      recordSleepRange(prevAlive, bootMs, 'shutdown', true)
    } else if (lastQuit && lastQuit.reason === 'shutdown') {
      recordSleep(Date.now() - lastQuit.at, 'shutdown', true)
    } else if (suspendAt) {
      recordSleep(Date.now() - suspendAt, 'away', false)
    }
    store.delete('suspendAt')
    store.delete('lastQuit')
  } catch (e) {}

  // YouTube refuses to play embeds from a file:// origin. Spoof a youtube.com
  // referrer on its requests so the in-app player works.
  try {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.ytimg.com/*', '*://*.googlevideo.com/*'] },
      (details, cb) => { details.requestHeaders['Referer'] = 'https://www.youtube.com/'; cb({ requestHeaders: details.requestHeaders }) }
    )
  } catch (e) {}

  // Kill YouTube ad + tracking requests. None of these carry the actual video
  // (that streams from googlevideo.com), so playback is untouched.
  try {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: [
        '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*',
        '*://*.google-analytics.com/*', '*://*.moatads.com/*', '*://*.adservice.google.com/*',
        '*://www.youtube.com/pagead/*', '*://www.youtube.com/ptracking*',
        '*://www.youtube.com/api/stats/ads*', '*://www.youtube.com/get_video_ads*',
        '*://s.youtube.com/api/stats/qoe*'
      ] },
      (details, cb) => cb({ cancel: true })
    )
  } catch (e) {}

  // mark when the 24h-minus-sleep model begins (older days use the fallback)
  if (!store.get('sleepTrackingStart')) store.set('sleepTrackingStart', Date.now())

  // heartbeat + live power events
  store.set('lastAlive', Date.now())
  setInterval(() => store.set('lastAlive', Date.now()), 30 * 1000)
  powerMonitor.on('suspend', () => { store.set('suspendAt', Date.now()) })          // lid closed / Mac asleep
  powerMonitor.on('resume', () => {                                                  // Mac woke
    const s = store.get('suspendAt')
    store.delete('suspendAt')
    // Lid-close = away (carve, no greeting). During a manual sleep, the Stop
    // button handles it, so skip here.
    if (s && !store.get('manualSleepStart')) recordSleep(Date.now() - s, 'away', false)
  })
  powerMonitor.on('shutdown', () => { store.set('lastQuit', { at: Date.now(), reason: 'shutdown' }) })

  createWindow()
  setInterval(() => autoRefresh('hourly').catch((e) => console.error('hourly sync failed', e && e.message)), 60 * 60 * 1000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Mark WHY the app is closing: a real shutdown, or just the user quitting the app.
app.on('before-quit', () => {
  const lq = store.get('lastQuit')
  if (!lq || lq.reason !== 'shutdown') store.set('lastQuit', { at: Date.now(), reason: 'app' })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('auth:status', () => google.status())
ipcMain.handle('auth:login', () => google.login())
ipcMain.handle('auth:logout', () => google.logout())
ipcMain.handle('creds:get', () => google.getCredentials())
ipcMain.handle('creds:set', (_, creds) => google.saveCredentials(creds))
// KAI local brain: Apple Intelligence, then a ~1GB Ollama model, else null so
// the renderer answers from the Kidus Brain. No cloud, no key, no cost.
// KAI SPEAKING THE GREETING.
//
// Electron ships no speech voices of its own, so the window cannot talk. The
// machine can: macOS has `say` and Windows has the speech engine built into
// .NET. Both are already there, so nothing is downloaded and nothing is
// installed. Anything else (Linux, or a machine with speech turned off) simply
// stays quiet and the greeting still reads on screen.
let saying = null
ipcMain.handle('voice:say', async (_, text) => {
  const words = String(text || '').slice(0, 400)
  if (!words.trim()) return { spoke: false }
  try { if (saying) { saying.kill(); saying = null } } catch (e) {}
  try {
    if (process.platform === 'darwin') {
      saying = spawn('say', ['-r', '178', words])
    } else if (process.platform === 'win32') {
      // single quotes are doubled so the sentence cannot break out of the string
      const safe = words.replace(/'/g, "''")
      saying = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = -1; $s.Speak('${safe}')`])
    } else {
      return { spoke: false }
    }
    saying.on('error', () => {})
    return { spoke: true }
  } catch (e) { return { spoke: false, error: String(e && e.message) } }
})

ipcMain.handle('voice:hush', async () => { try { if (saying) { saying.kill(); saying = null } } catch (e) {} return true })

ipcMain.handle('ai:local', async (_, { system, prompt } = {}) => {
  try {
    const apple = await appleAnswer(system, prompt)
    if (apple) return { answer: apple, engine: 'apple' }
    const oll = await ollamaAnswer(system, prompt)
    if (oll) return { answer: oll, engine: 'ollama' }
  } catch (e) {}
  return { answer: null, engine: null }
})
ipcMain.handle('calendar:get', () => store.get('calendarCache') || { events: [], lastSync: null })
// Local-first: the renderer persists the blocks you just made so they survive a
// restart even when Google sync is down. Keeps whatever lastSync we already had.
ipcMain.handle('calendar:cache', (_, events) => { const cur = store.get('calendarCache') || {}; store.set('calendarCache', { events: Array.isArray(events) ? events : [], lastSync: cur.lastSync || null }); return true })
ipcMain.handle('calendar:refresh', () => autoRefresh('manual'))
ipcMain.handle('calendar:autopull', () => autoRefresh('autopull'))
// in-app calendar writes (create / move / resize / delete) -> Google
ipcMain.handle('calendar:create', (_, payload) => google.createEvent(payload))
ipcMain.handle('calendar:update', (_, payload) => google.updateEvent(payload))
ipcMain.handle('calendar:delete', (_, payload) => google.deleteEvent(payload))
ipcMain.handle('sleep:last', () => store.get('lastSleep') || null)

ipcMain.handle('sleep:log', () => ({ intervals: store.get('sleepLog') || [], trackingStart: store.get('sleepTrackingStart') || Date.now() }))

// Manual sleep: start the timer, then put the machine to sleep.
ipcMain.handle('mac:sleepNow', () => {
  store.set('manualSleepStart', Date.now())
  const cmd = process.platform === 'win32'
    ? 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
    : 'pmset sleepnow'
  try { exec(cmd) } catch (e) { console.error('sleep command failed', e && e.message) }
  return true
})
// Is a manual sleep session running? (renderer shows the timer + Stop button)
ipcMain.handle('sleep:manualStatus', () => store.get('manualSleepStart') || null)
// Stop the timer. Under 20 minutes = doesn't count as sleep at all.
ipcMain.handle('sleep:manualStop', () => {
  const startedAt = store.get('manualSleepStart')
  store.delete('manualSleepStart')
  if (!startedAt) return { counted: false, ms: 0 }
  const ms = Date.now() - startedAt
  const counted = ms >= 20 * 60 * 1000
  if (counted) recordSleep(ms, 'manual', true)   // carve it out + greet
  return { counted, ms }
})
ipcMain.handle('profile:get', () => store.get('profilePhoto') || null)
ipcMain.handle('profile:set', (_, dataUrl) => { store.set('profilePhoto', dataUrl); return dataUrl })

// Growth journal: folders + memory albums (photos + notes) the user logs to
// track their journey. Items carry a parentId so folders can nest.
ipcMain.handle('memories:get', () => store.get('memories') || [])
ipcMain.handle('memories:add', (_, entry) => {
  const list = store.get('memories') || []
  const seq = (store.get('memSeq') || 0) + 1
  store.set('memSeq', seq)
  const e = entry || {}
  const base = { id: 'm_' + Date.now() + '_' + seq, at: Date.now(), parentId: e.parentId || null }
  const item = e.type === 'folder'
    ? { ...base, type: 'folder', name: e.name || 'New folder' }
    : { ...base, type: 'memory', note: e.note || '', atts: Array.isArray(e.atts) ? e.atts : [], images: Array.isArray(e.images) ? e.images : (e.image ? [e.image] : []) }
  list.push(item)
  store.set('memories', list)
  return item
})
ipcMain.handle('memories:update', (_, payload) => {
  const list = store.get('memories') || []
  const item = list.find((m) => m.id === (payload && payload.id))
  if (item) {
    if (payload.note !== undefined) item.note = payload.note
    if (payload.name !== undefined) item.name = payload.name
    if (payload.images !== undefined) item.images = payload.images
    if (payload.atts !== undefined) item.atts = payload.atts
    if (payload.blur !== undefined) item.blur = payload.blur
    if (payload.blurText !== undefined) item.blurText = payload.blurText
    store.set('memories', list)
  }
  return item || null
})
ipcMain.handle('memories:delete', (_, id) => {
  const list = store.get('memories') || []
  const remove = new Set([id])
  let changed = true
  while (changed) { changed = false; for (const m of list) { if (m.parentId && remove.has(m.parentId) && !remove.has(m.id)) { remove.add(m.id); changed = true } } }
  store.set('memories', list.filter((m) => !remove.has(m.id)))
  return true
})

// Media: ANY file type, ANY size. Files are copied to disk (never base64'd into
// the store) so a huge video won't bloat or break the app.
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.svg', '.avif']
function mediaDir() { const d = path.join(app.getPath('userData'), 'media'); try { fs.mkdirSync(d, { recursive: true }) } catch (e) {}; return d }
const WEB_IMG = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico']
const CONV_IMG = ['.heic', '.heif', '.tif', '.tiff']
function copyWithProgress(src, dest, onChunk) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(src)
    const ws = fs.createWriteStream(dest)
    rs.on('data', (c) => { try { onChunk(c.length) } catch (e) {} })
    rs.on('error', reject); ws.on('error', reject)
    ws.on('finish', resolve)
    rs.pipe(ws)
  })
}
ipcMain.handle('media:import', async (_, paths) => {
  const list = (paths || []).filter(Boolean)
  let total = 0
  for (const p of list) { try { total += fs.statSync(p).size } catch (e) {} }
  let done = 0
  const send = (extra) => { if (win && !win.isDestroyed()) win.webContents.send('media:progress', { pct: total ? Math.min(99, Math.round(done / total * 100)) : 60, ...extra }) }
  const out = []
  for (const src of list) {
    try {
      const ext = path.extname(src).toLowerCase()
      const seq = (store.get('memSeq') || 0) + 1; store.set('memSeq', seq)
      const dest = path.join(mediaDir(), 'f_' + Date.now() + '_' + seq + ext)
      await copyWithProgress(src, dest, (n) => { done += n; send() })
      // Web images display from the original (EXIF-correct). HEIC/TIFF get a
      // JPEG copy via macOS `sips`. Everything else is just a file.
      let isImage = WEB_IMG.includes(ext)
      let display = null
      if (!isImage && CONV_IMG.includes(ext)) {
        try {
          const jpg = dest + '.jpg'
          execFileSync('sips', ['-s', 'format', 'jpeg', dest, '--out', jpg], { stdio: 'ignore' })
          if (fs.existsSync(jpg) && fs.statSync(jpg).size > 0) { isImage = true; display = jpg }
        } catch (e) {}
      }
      out.push({ kind: 'file', path: dest, name: path.basename(src), ext: ext.replace('.', ''), isImage, display })
    } catch (e) { console.error('media import failed', src, e && e.message) }
  }
  if (win && !win.isDestroyed()) win.webContents.send('media:progress', { pct: 100, done: true })
  return out
})
ipcMain.handle('media:open', (_, p) => { try { shell.openPath(p) } catch (e) {}; return true })
ipcMain.handle('media:reveal', (_, p) => { try { shell.showItemInFolder(p) } catch (e) {}; return true })

ipcMain.handle('content:open', (_, url) => { try { if (/^https?:\/\//.test(url)) shell.openExternal(url) } catch (e) {}; return true })

// Keyless YouTube search — reads the public results page and pulls real videos
// (id, title, channel). No API key, so unlimited fresh content per topic.
ipcMain.handle('content:search', (_, query) => {
  return new Promise((resolve) => {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query || '') + '&sp=EgIQAQ%3D%3D'
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' } }, (res) => {
      let body = ''
      res.on('data', (c) => body += c)
      res.on('end', () => {
        try {
          const m = body.match(/var ytInitialData = (\{.+?\});<\/script>/s) || body.match(/ytInitialData"\]?\s*=\s*(\{.+?\});/s)
          if (!m) return resolve([])
          const data = JSON.parse(m[1])
          const out = []
          const seen = new Set()
          const walk = (o) => {
            if (!o || typeof o !== 'object') return
            const vr = o.videoRenderer
            if (vr && vr.videoId && vr.lengthText && !seen.has(vr.videoId)) {
              seen.add(vr.videoId)
              const title = (vr.title && vr.title.runs && vr.title.runs[0] && vr.title.runs[0].text) || ''
              const channel = (vr.ownerText && vr.ownerText.runs && vr.ownerText.runs[0] && vr.ownerText.runs[0].text) ||
                (vr.longBylineText && vr.longBylineText.runs && vr.longBylineText.runs[0] && vr.longBylineText.runs[0].text) || ''
              const published = (vr.publishedTimeText && vr.publishedTimeText.simpleText) || ''
              if (title) out.push({ id: vr.videoId, title, channel, published })
            }
            for (const k in o) walk(o[k])
          }
          walk(data)
          resolve(out.slice(0, 40))
        } catch (e) { resolve([]) }
      })
    })
    req.on('error', () => resolve([]))
    req.setTimeout(9000, () => { try { req.destroy() } catch (e) {}; resolve([]) })
  })
})
ipcMain.handle('media:download', (_, att) => {
  try {
    const dir = app.getPath('downloads')
    if (att && att.path) { const dest = path.join(dir, att.name || path.basename(att.path)); fs.copyFileSync(att.path, dest); return dest }
    if (att && att.dataUrl) {
      const m = /^data:(.+?);base64,(.*)$/.exec(att.dataUrl)
      if (m) { const ext = (m[1].split('/')[1] || 'jpg').replace('jpeg', 'jpg'); const dest = path.join(dir, (att.name || ('memory_' + Date.now())) + '.' + ext); fs.writeFileSync(dest, Buffer.from(m[2], 'base64')); return dest }
    }
  } catch (e) { console.error('download failed', e && e.message) }
  return null
})
ipcMain.handle('media:readDataUrl', (_, p) => {
  // Raw bytes as a data URL — the <img> tag applies EXIF rotation itself.
  try {
    const ext = path.extname(p).toLowerCase().replace('.', '') || 'jpg'
    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,` + fs.readFileSync(p).toString('base64')
  } catch (e) { return null }
})
