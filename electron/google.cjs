// Google OAuth2 (loopback flow for desktop apps) + Calendar fetch across ALL
// calendars the user can read, including secondary ones like "Habbits".
const http = require('http')
const { shell } = require('electron')
const { OAuth2Client } = require('google-auth-library')
const { google } = require('googleapis')
const store = require('./store.cjs')

const SCOPES = [
  // Full calendar access: read the calendar list AND write events back, so the
  // in-app calendar can create, move, and delete. (Was read-only before.)
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
]

// ---- credentials -----------------------------------------------------------
// Out Past carries its own Google client, written into electron/google-client.json
// by scripts/bake-google.cjs when the app is built. Google treats a Desktop app's
// client as public (it ships inside every copy), so nobody who downloads Out Past
// has to make a key of their own. A key somebody entered by hand still wins, so
// anyone already signed in with their own stays signed in.
function builtIn() {
  try { return require('./google-client.json') } catch { return null }
}
/* only a key somebody typed in: Settings shows this, never the built in one */
function ownCredentials() {
  return store.get('credentials', { clientId: '', clientSecret: '' })
}
function getCredentials() {
  const own = ownCredentials()
  if (own.clientId && own.clientSecret) return own
  const b = builtIn()
  return b && b.clientId && b.clientSecret ? b : own
}
function setCredentials(creds) {
  store.set('credentials', {
    clientId: (creds.clientId || '').trim(),
    clientSecret: (creds.clientSecret || '').trim()
  })
}
function hasCredentials() {
  const c = getCredentials()
  return Boolean(c.clientId && c.clientSecret)
}

// ---- oauth client ----------------------------------------------------------
function makeClient(redirectUri) {
  const { clientId, clientSecret } = getCredentials()
  return new OAuth2Client(clientId, clientSecret, redirectUri)
}

// Persist refreshed tokens automatically so the session survives restarts.
function bindTokenPersistence(client) {
  client.on('tokens', (tokens) => {
    const existing = store.get('tokens', {}) || {}
    store.set('tokens', { ...existing, ...tokens })
  })
}

function authedClient() {
  const tokens = store.get('tokens', null)
  if (!tokens) return null
  const client = makeClient('http://127.0.0.1')
  client.setCredentials(tokens)
  bindTokenPersistence(client)
  return client
}

// ---- interactive login (loopback) -----------------------------------------
function login() {
  return new Promise((resolve, reject) => {
    if (!hasCredentials()) {
      reject(new Error('Missing Google client ID / secret. Add them in Settings.'))
      return
    }

    const server = http.createServer()
    server.on('error', reject)

    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port
      const redirectUri = `http://127.0.0.1:${port}`
      const client = makeClient(redirectUri)
      bindTokenPersistence(client)

      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES
      })

      server.on('request', async (req, res) => {
        try {
          const params = new URL(req.url, redirectUri).searchParams
          const error = params.get('error')
          const code = params.get('code')

          const close = (msg) => {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
              `<html><body style="background:#0b0f10;color:#00ffcc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:20px;">${msg}</body></html>`
            )
            server.close()
          }

          if (error) {
            close('Authorization denied. You can close this window.')
            reject(new Error(error))
            return
          }
          if (!code) return // favicon or stray request

          const { tokens } = await client.getToken(code)
          client.setCredentials(tokens)
          store.set('tokens', tokens)
          close('Connected! You can close this window and return to Out Past.')

          const profile = await fetchProfile(client)
          store.set('account', profile)
          resolve({ connected: true, account: profile })
        } catch (err) {
          server.close()
          reject(err)
        }
      })

      await shell.openExternal(authUrl)
    })
  })
}

function logout() {
  store.delete('tokens')
  store.delete('account')
  return { connected: false }
}

async function fetchProfile(client) {
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const { data } = await oauth2.userinfo.get()
    return { email: data.email, name: data.name, picture: data.picture }
  } catch {
    return { email: null, name: null, picture: null }
  }
}

function status() {
  return {
    connected: Boolean(store.get('tokens', null)),
    account: store.get('account', null),
    hasCredentials: hasCredentials()
  }
}

// ---- calendar fetch --------------------------------------------------------
// Pulls events from EVERY calendar in the user's calendar list over a window
// of the past 30 days through the next 60 (the future side lets us spot events
// that were pushed forward — their instance carries an originalStartTime).
// Only a genuinely dead/revoked login should force a reconnect. A network blip,
// rate limit, or one bad calendar must NOT prompt reconnect.
function isAuthError(e) {
  const parts = [e && e.message, e && e.code, e && e.response && JSON.stringify(e.response.data)].filter(Boolean).join(' ')
  return /invalid_grant|invalid_token|unauthorized|\b401\b|expired or revoked|invalid credentials/i.test(parts)
}
function authErr() { const err = new Error('AUTH_EXPIRED'); err.authExpired = true; return err }

async function fetchEvents() {
  const client = authedClient()
  if (!client) throw new Error('Not connected to Google.')

  const calendar = google.calendar({ version: 'v3', auth: client })

  const now = new Date()
  const timeMin = new Date(now.getTime() - 30 * 864e5).toISOString()
  const timeMax = new Date(now.getTime() + 60 * 864e5).toISOString()

  let calendars
  try {
    // First authed call — if the refresh token is dead, it fails here.
    const calList = await calendar.calendarList.list({ maxResults: 250 })
    calendars = calList.data.items || []
  } catch (e) {
    if (isAuthError(e)) throw authErr()
    throw e   // transient — caller keeps the last good data, no reconnect prompt
  }

  const all = []
  for (const cal of calendars) {
    // One flaky calendar must never break the whole sync. Skip it, keep going.
    try {
    let pageToken
    do {
      const resp = await calendar.events.list({
        calendarId: cal.id,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
        pageToken,
        showDeleted: false
      })
      const items = resp.data.items || []
      for (const ev of items) {
        if (ev.status === 'cancelled') continue
        const startRaw = ev.start || {}
        const endRaw = ev.end || {}
        const allDay = Boolean(startRaw.date && !startRaw.dateTime)
        const start = startRaw.dateTime || startRaw.date
        const end = endRaw.dateTime || endRaw.date
        if (!start || !end) continue

        const originalStart =
          (ev.originalStartTime &&
            (ev.originalStartTime.dateTime || ev.originalStartTime.date)) || null

        all.push({
          id: ev.id,
          calendarId: cal.id,
          calendarName: cal.summaryOverride || cal.summary || cal.id,
          calendarColor: cal.backgroundColor || null,
          colorId: ev.colorId || null,
          summary: ev.summary || '(no title)',
          description: ev.description || '',
          location: ev.location || '',
          start,
          end,
          allDay,
          originalStart,
          recurringEventId: ev.recurringEventId || null,
          // "pushed" = a recurring instance whose moved start lands on a later
          // day than where it was originally scheduled.
          pushed: Boolean(
            originalStart && new Date(start) > new Date(originalStart) &&
              new Date(start).toDateString() !== new Date(originalStart).toDateString()
          )
        })
      }
      pageToken = resp.data.nextPageToken
    } while (pageToken)
    } catch (e) {
      console.error('sync: skipped calendar', cal.id, e && e.message)
    }
  }

  store.set('events', all)
  store.set('lastSync', Date.now())
  return { events: all, lastSync: Date.now(), calendars: calendars.length }
}

function cachedEvents() {
  return {
    events: store.get('events', []),
    lastSync: store.get('lastSync', null)
  }
}

// ---- calendar write (in-app calendar) --------------------------------------
function calClient() {
  const client = authedClient()
  if (!client) throw new Error('Not connected to Google.')
  return google.calendar({ version: 'v3', auth: client })
}

async function createEvent({ calendarId, summary, start, end, recurrence, colorId, allDay, description, location }) {
  const calendar = calClient()
  const requestBody = { summary: summary || '(no title)' }
  if (description != null) requestBody.description = description
  if (location != null) requestBody.location = location
  if (allDay) {
    // All-day event: Google wants { date: 'YYYY-MM-DD' }, end exclusive (+1 day).
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const sd = new Date(start)
    const ed = new Date(end || start)
    if (fmt(ed) === fmt(sd)) ed.setDate(ed.getDate() + 1)
    requestBody.start = { date: fmt(sd) }
    requestBody.end = { date: fmt(ed) }
  } else {
    requestBody.start = { dateTime: new Date(start).toISOString() }
    requestBody.end = { dateTime: new Date(end).toISOString() }
  }
  // recurrence = array of RRULE strings, e.g. ['RRULE:FREQ=DAILY'] for a habit.
  if (recurrence && recurrence.length) requestBody.recurrence = recurrence
  if (colorId) requestBody.colorId = String(colorId)
  const resp = await calendar.events.insert({
    calendarId: calendarId || 'primary',
    requestBody
  })
  return resp.data
}

async function updateEvent({ calendarId, id, summary, start, end, recurrence, description, location }) {
  const calendar = calClient()
  const body = {}
  if (summary != null) body.summary = summary
  if (start) body.start = { dateTime: new Date(start).toISOString() }
  if (end) body.end = { dateTime: new Date(end).toISOString() }
  if (recurrence !== undefined) body.recurrence = recurrence   // array of RRULE, or null to stop repeating
  if (description != null) body.description = description
  if (location != null) body.location = location
  const resp = await calendar.events.patch({
    calendarId: calendarId || 'primary',
    eventId: id,
    requestBody: body
  })
  return resp.data
}

async function deleteEvent({ calendarId, id }) {
  const calendar = calClient()
  await calendar.events.delete({ calendarId: calendarId || 'primary', eventId: id })
  return { ok: true }
}

module.exports = {
  getCredentials,
  ownCredentials,
  setCredentials,
  hasCredentials,
  login,
  logout,
  status,
  fetchEvents,
  cachedEvents,
  createEvent,
  updateEvent,
  deleteEvent
}
