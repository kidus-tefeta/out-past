import React, { useEffect, useRef } from 'react'

// The Clay Orb. KAI's voice made visible. It draws the app's orange orb on a
// canvas and pulses with `amp` (0..1), the live volume of your voice while you
// hold to talk. When idle it just breathes. Project 5.1.
//
// This is only paint. The mic, the amplitude and the speech all live in
// ../lib/voice.js and Coach.jsx. Give it `active` (are we listening/speaking)
// and `amp` and it does the rest.

const CLAY = '#d97757'

export default function VoiceOrb({ size = 120, amp = 0, active = false, body = 0.56 }) {
  const ref = useRef(null)
  const ampRef = useRef(0)
  const activeRef = useRef(false)
  const raf = useRef(0)

  useEffect(() => { ampRef.current = amp }, [amp])
  useEffect(() => { activeRef.current = active }, [active])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    const x = canvas.getContext('2d')
    x.scale(dpr, dpr)
    let t = 0
    let level = 0

    function frame() {
      t += 0.03
      // when idle, a soft breath; when active, follow the real mic level
      const target = activeRef.current ? Math.min(1, 0.15 + ampRef.current * 1.4) : 0.05 + 0.03 * Math.sin(t)
      level += (target - level) * 0.18

      const w = size, h = size, cx = w / 2, cy = h / 2
      x.clearRect(0, 0, w, h)
      // Everything stays inside the canvas circle, so the orb floats free with
      // no square edge. A soft glow fades to nothing before the edge.
      const R = size / 2
      const base = R * (body + level * 0.08)
      const amp = R * (0.02 + level * 0.06)

      const glow = x.createRadialGradient(cx, cy, base * 0.8, cx, cy, R * 0.99)
      glow.addColorStop(0, `rgba(217,119,87,${0.16 + level * 0.14})`)
      glow.addColorStop(1, 'rgba(217,119,87,0)')
      x.fillStyle = glow
      x.beginPath(); x.arc(cx, cy, R * 0.99, 0, Math.PI * 2); x.fill()

      // the body: a smooth, fluid blob, several slow waves layered
      x.beginPath()
      const pts = 96
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2
        const wob = base
          + Math.sin(a * 3 + t * 1.6) * amp
          + Math.sin(a * 5 - t * 2.1) * amp * 0.6
          + Math.sin(a * 2 + t * 0.9) * amp * 0.8
        const px = cx + Math.cos(a) * wob, py = cy + Math.sin(a) * wob
        i === 0 ? x.moveTo(px, py) : x.lineTo(px, py)
      }
      x.closePath()
      const bodyFill = x.createRadialGradient(cx - base * 0.35, cy - base * 0.4, base * 0.1, cx, cy, base * 1.15)
      bodyFill.addColorStop(0, '#f0a47f')
      bodyFill.addColorStop(0.55, CLAY)
      bodyFill.addColorStop(1, '#b4553a')
      x.fillStyle = bodyFill
      x.fill()

      raf.current = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(raf.current)
  }, [size, body])

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} />
}
