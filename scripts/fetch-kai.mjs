#!/usr/bin/env node
// KAI'S BRAIN, FETCHED ONCE AT BUILD TIME.
//
// Out Past ships with the model inside it, so a new machine needs no Ollama, no
// account, no key and no wifi. The two pieces are too big for git, so they are
// pulled here, into build/kai, and packaged from there:
//
//   build/kai/bin        the llama.cpp engine for this platform (about 15 MB)
//   build/kai/model.gguf Qwen 2.5 1.5B Instruct, Q4_K_M (about 1.1 GB)
//
//   node scripts/fetch-kai.mjs            this machine's platform
//   node scripts/fetch-kai.mjs win32 x64  cross fetch, for CI
//
// Already there and the right size? It does nothing, so a rebuild is instant.

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

const ENGINE = 'b11065'
const MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true'
const MODEL_MIN = 1_000_000_000   // a short file means the download was cut off

const plat = process.argv[2] || process.platform
const arch = process.argv[3] || process.arch
const root = path.resolve(path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..'))
const out = path.join(root, 'build', 'kai')
const bin = path.join(out, 'bin')

const asset = plat === 'darwin'
  ? `llama-${ENGINE}-bin-macos-${arch === 'x64' ? 'x64' : 'arm64'}.tar.gz`
  : plat === 'win32'
    ? `llama-${ENGINE}-bin-win-cpu-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
    : null
if (!asset) { console.log('no KAI engine for ' + plat + ', skipping'); process.exit(0) }

fs.mkdirSync(bin, { recursive: true })

function run(cmd, args, opts = {}) { execFileSync(cmd, args, { stdio: 'inherit', ...opts }) }

/* node does the downloading itself: curl on a Windows runner trips over TLS */
async function get(url, to) {
  for (let tries = 1; ; tries++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (!r.ok) throw new Error(url + ' answered ' + r.status)
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(to))
      return
    } catch (e) {
      if (tries >= 3) throw e
      console.log('retrying (' + (e && e.message) + ')')
      await new Promise(r => setTimeout(r, 2000 * tries))
    }
  }
}

/* the engine */
const server = path.join(bin, plat === 'win32' ? 'llama-server.exe' : 'llama-server')
if (!fs.existsSync(server)) {
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE}/${asset}`
  const tmp = path.join(os.tmpdir(), asset)
  console.log('engine: ' + url)
  await get(url, tmp)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kai-'))
  // tar reads both .zip and .tar.gz, and is on macOS and Windows alike
  run('tar', ['-xf', tmp, '-C', dir])
  // the archives keep everything in one folder, flattened here
  const files = []
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name)
    e.isDirectory() ? walk(p) : files.push(p)
  })
  walk(dir)
  for (const f of files) {
    const name = path.basename(f)
    if (/^(llama-server(\.exe)?|.*\.(dylib|dll|so|metal|metallib)|ggml.*)$/i.test(name)) {
      fs.copyFileSync(f, path.join(bin, name))
      if (!name.includes('.')) fs.chmodSync(path.join(bin, name), 0o755)
    }
  }
  fs.chmodSync(server, 0o755)
  console.log('engine ready: ' + fs.readdirSync(bin).length + ' files')
} else console.log('engine already here')

/* the model */
const model = path.join(out, 'model.gguf')
if (fs.existsSync(model) && fs.statSync(model).size > MODEL_MIN) {
  console.log('model already here, ' + Math.round(fs.statSync(model).size / 1e6) + ' MB')
} else {
  console.log('model: Qwen 2.5 1.5B Instruct Q4_K_M, about 1.1 GB')
  await get(MODEL_URL, model)
  const size = fs.statSync(model).size
  if (size < MODEL_MIN) { fs.unlinkSync(model); throw new Error('the model came down short: ' + size + ' bytes') }
  console.log('model ready, ' + Math.round(size / 1e6) + ' MB')
}
