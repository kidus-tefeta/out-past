#!/usr/bin/env node
// Puts Out Past's own Google client inside the build, so the app signs in with
// one Google button and never asks anybody for a client ID or secret.
//
// It reads, in order:
//   OUTPAST_GOOGLE_CLIENT_ID and OUTPAST_GOOGLE_CLIENT_SECRET   (CI secrets)
//   OUTPAST_GOOGLE_JSON, or the first argument: the client_secret_*.json file
//   Google Cloud downloads for a Desktop app client
// and writes electron/google-client.json, which git never sees.
//
// With none of them it writes nothing and says so: the build still works, and
// the app falls back to asking for a key, as before.
const fs = require('fs')
const path = require('path')

const out = path.join(__dirname, '..', 'electron', 'google-client.json')
let clientId = (process.env.OUTPAST_GOOGLE_CLIENT_ID || '').trim()
let clientSecret = (process.env.OUTPAST_GOOGLE_CLIENT_SECRET || '').trim()

const file = process.env.OUTPAST_GOOGLE_JSON || process.argv[2]
if ((!clientId || !clientSecret) && file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  const c = j.installed || j.web || j
  clientId = String(c.client_id || '').trim()
  clientSecret = String(c.client_secret || '').trim()
}

if (!clientId || !clientSecret) {
  console.warn('bake-google: no Google client given, this build will ask users for their own')
  process.exit(0)
}
if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
  console.error('bake-google: that does not look like a Google client ID')
  process.exit(1)
}
fs.writeFileSync(out, JSON.stringify({ clientId, clientSecret }) + '\n')
console.log('bake-google: Out Past\'s own Google client is in this build')
