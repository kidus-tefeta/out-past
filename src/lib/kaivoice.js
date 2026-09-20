// KAI'S VOICE, THE SAME ON EVERY MACHINE.
//
// A Mac voice cannot leave a Mac and a Windows voice sounds nothing like one,
// so a machine voice can never sound the same on both. This is one small
// neural voice (Kokoro, 82M, about 80 MB) that runs on the person's own
// machine, so Out Past sounds identical on a Mac and on Windows and nothing is
// sent anywhere.
//
// It is never in the way:
//   first run  the machine's own voice speaks at once, and the model is
//              fetched quietly in the background
//   after that the neural voice, which the browser keeps cached
//   no wifi    the machine voice, and if there is none, silence
//
// While it speaks it reports the level of the sound, 0 to 1, so the Clay Orb
// swells on KAI's actual voice rather than a timer.

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const SRC = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm'
const VOICE = 'am_michael'   // a level, low male read, the closest to the Mac voice

let ttsPromise = null
let tts = null
let ctx = null
let playing = null

/* the model, loaded once and kept */
export function warm() {
  if (ttsPromise) return ttsPromise
  ttsPromise = (async () => {
    const { KokoroTTS } = await import(/* @vite-ignore */ SRC)
    tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm' })
    return tts
  })().catch((e) => { ttsPromise = null; throw e })
  return ttsPromise
}

export function ready() { return !!tts }

/* the machine's own voice, through the main process */
function machine(text) {
  try {
    if (window.kd && window.kd.voice && window.kd.voice.say) { window.kd.voice.say(text); return true }
  } catch (e) {}
  return false
}

export function hush() {
  try { if (playing) { playing.audio.pause(); playing.audio.currentTime = 0; playing = null } } catch (e) {}
  try { if (window.kd && window.kd.voice) window.kd.voice.hush() } catch (e) {}
  try { window.speechSynthesis && window.speechSynthesis.cancel() } catch (e) {}
}

/* one sentence at a time, so it starts talking as soon as the first is made */
function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
}

// speak(text, { onLevel, onEnd })
//   onLevel(0..1) fires while it talks, for the orb
//   onEnd()       fires when the last word is out
export async function speak(text, { onLevel, onEnd } = {}) {
  hush()
  const done = () => { onLevel && onLevel(0); onEnd && onEnd() }

  // nothing loaded yet: the machine speaks now, the model loads behind it
  if (!tts) {
    const spoke = machine(text)
    warm().catch(() => {})
    const ms = Math.max(2200, text.split(/\s+/).length * 400)
    if (spoke) {
      let t = 0
      const tick = setInterval(() => { t += 0.12; onLevel && onLevel(0.35 + 0.22 * Math.sin(t * 5)) }, 90)
      setTimeout(() => { clearInterval(tick); done() }, ms)
    } else setTimeout(done, 600)
    return
  }

  try {
    const parts = sentences(text)
    let first = null
    for (const p of parts) {
      const audio = await tts.generate(p, { voice: VOICE })
      const blob = audio.toBlob()
      if (!first) first = blob
      await play(blob, onLevel)
    }
    done()
  } catch (e) {
    machine(text) ? setTimeout(done, Math.max(2200, text.split(/\s+/).length * 400)) : done()
  }
}

// The greeting is the one line we always know in advance, so it is rendered in
// this same voice at build time and shipped with the app: it starts the moment
// the window opens, with nothing to fetch and nothing to wait for.
export async function playClip(url, { onLevel, onEnd } = {}) {
  hush()
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error('no clip')
    const played = await play(await r.blob(), onLevel)
    onLevel && onLevel(0); onEnd && onEnd()
    return played
  } catch (e) {
    onLevel && onLevel(0); onEnd && onEnd()
    return false
  }
}

/* play one piece and read its level for the orb */
function play(blob, onLevel) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.crossOrigin = 'anonymous'
      let analyser = null, data = null, raf = 0
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
        const src = ctx.createMediaElementSource(audio)
        analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        src.connect(analyser); analyser.connect(ctx.destination)
        data = new Uint8Array(analyser.frequencyBinCount)
      } catch (e) {}
      const frame = () => {
        if (analyser && onLevel) {
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128)
          onLevel(Math.min(1, peak * 1.6))
        }
        raf = requestAnimationFrame(frame)
      }
      let heard = false
      const stop = () => { cancelAnimationFrame(raf); URL.revokeObjectURL(url); playing = null; resolve(heard) }
      audio.onended = stop
      audio.onerror = stop
      playing = { audio }
      audio.play().then(() => { heard = true; frame() }).catch(stop)
    } catch (e) { resolve(false) }
  })
}
