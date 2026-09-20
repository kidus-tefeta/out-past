const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('kd', {
  creds: {
    get: () => ipcRenderer.invoke('creds:get'),
    set: (creds) => ipcRenderer.invoke('creds:set', creds)
  },
  ai: {
    // KAI's on-device brain. { answer, engine } where engine is 'apple' | 'ollama',
    // or { answer: null } when neither is ready (caller falls back to the KB).
    local: (system, prompt) => ipcRenderer.invoke('ai:local', { system, prompt })
  },
  // KAI's greeting, spoken by the voice already in the machine
  voice: {
    say: (text) => ipcRenderer.invoke('voice:say', text),
    hush: () => ipcRenderer.invoke('voice:hush')
  },
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout')
  },
  calendar: {
    get: () => ipcRenderer.invoke('calendar:get'),
    refresh: () => ipcRenderer.invoke('calendar:refresh'),
    autopull: () => ipcRenderer.invoke('calendar:autopull'),
    create: (payload) => ipcRenderer.invoke('calendar:create', payload),
    update: (payload) => ipcRenderer.invoke('calendar:update', payload),
    remove: (payload) => ipcRenderer.invoke('calendar:delete', payload),
    cache: (events) => ipcRenderer.invoke('calendar:cache', events)
  },
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    set: (dataUrl) => ipcRenderer.invoke('profile:set', dataUrl)
  },
  memories: {
    get: () => ipcRenderer.invoke('memories:get'),
    add: (entry) => ipcRenderer.invoke('memories:add', entry),
    update: (payload) => ipcRenderer.invoke('memories:update', payload),
    remove: (id) => ipcRenderer.invoke('memories:delete', id)
  },
  media: {
    // resolve the real filesystem path of a File chosen in an <input>
    pathForFile: (file) => { try { return webUtils.getPathForFile(file) } catch (e) { return (file && file.path) || null } },
    import: (paths) => ipcRenderer.invoke('media:import', paths),
    open: (p) => ipcRenderer.invoke('media:open', p),
    reveal: (p) => ipcRenderer.invoke('media:reveal', p),
    download: (att) => ipcRenderer.invoke('media:download', att),
    readDataUrl: (p) => ipcRenderer.invoke('media:readDataUrl', p),
    onImportProgress: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('media:progress', h); return () => ipcRenderer.removeListener('media:progress', h) }
  },
  content: {
    search: (query) => ipcRenderer.invoke('content:search', query),
    open: (url) => ipcRenderer.invoke('content:open', url)
  },
  sleep: {
    last: () => ipcRenderer.invoke('sleep:last'),
    log: () => ipcRenderer.invoke('sleep:log'),
    manualStatus: () => ipcRenderer.invoke('sleep:manualStatus'),
    manualStop: () => ipcRenderer.invoke('sleep:manualStop')
  },
  mac: {
    sleepNow: () => ipcRenderer.invoke('mac:sleepNow')
  },
  onSleepDetected: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('sleep:detected', handler)
    return () => ipcRenderer.removeListener('sleep:detected', handler)
  },
  // hourly / login / open pushes from the main process
  onCalendarUpdated: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on('calendar:updated', handler)
    return () => ipcRenderer.removeListener('calendar:updated', handler)
  }
})
