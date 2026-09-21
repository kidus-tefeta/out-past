// KAI'S VOICE.
//
// Nothing here goes near the internet, because the app promises it never does.
// The greeting is the one line we always know in advance, so it is rendered in
// KAI's neural voice while the app is being built and shipped inside it. It
// sounds the same on a Mac and on Windows, and it starts the moment the window
// opens.
//
// Anything KAI makes up on the spot is spoken by the voice already in the
// machine, macOS say or the Windows speech engine, through the main process,
// because Electron ships no voice of its own. A machine with no voice at all
// simply stays quiet and every word still reads on screen.
//
// While it speaks it reports the level of the sound, 0 to 1, so the Clay Orb
// swells on KAI's actual voice rather than on a timer.

let ctx = null
let playing = null

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

// speak(text, { onLevel, onEnd })
//   onLevel(0..1) fires while it talks, for the orb
//   onEnd()       fires when the last word is out
export function speak(text, { onLevel, onEnd } = {}) {
  hush()
  const done = () => { onLevel && onLevel(0); onEnd && onEnd() }
  const spoke = machine(text)
  if (!spoke) { setTimeout(done, 600); return }
  // the machine's voice gives nothing back to read, so the orb moves at a
  // steady breath for about as long as those words take to say
  const ms = Math.max(2200, text.split(/\s+/).length * 400)
  let t = 0
  const tick = setInterval(() => { t += 0.12; onLevel && onLevel(0.35 + 0.22 * Math.sin(t * 5)) }, 90)
  setTimeout(() => { clearInterval(tick); done() }, ms)
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
