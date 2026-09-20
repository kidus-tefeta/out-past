import React, { useCallback, useEffect, useRef, useState } from 'react'
import VoiceOrb from './VoiceOrb.jsx'
import { speak, playClip, hush as hushVoice, warm } from '../lib/kaivoice.js'
import greeting from '../assets/greeting.m4a'

// THE FIRST THING A NEW MACHINE SEES.
//
// Full screen, nothing else on it. KAI speaks out loud, the line writes itself
// across the screen, and then it walks the person in: Google, a few questions,
// three short cards on where things are. It runs once per machine and is kept
// self contained on purpose, its own styles and its own voice, so it never
// fights the rest of the app.
//
// It speaks in KAI's own voice, the same one on a Mac and on Windows, and the
// Clay Orb swells on the sound of it. The first time, before the voice has
// been fetched, the machine's own voice says it instead, so nobody waits.

const SAID = "Welcome sir. Ready to outperform, outsmart, and out past. Let's get to work."

/* what it says, with the name if we know it */
function line(name) {
  const who = name ? name.split(' ')[0] : 'sir'
  return `Welcome ${who}. Ready to outperform, outsmart, and out past. Let's get to work.`
}

export default function Welcome({ status, onSaveCreds, onLogin, onDone }) {
  const [step, setStep] = useState('hello')     // hello | google | you | day | tour
  const [typed, setTyped] = useState('')
  const [talking, setTalking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [name, setName] = useState('')
  const [bday, setBday] = useState('')
  const [north, setNorth] = useState('')
  const [wake, setWake] = useState('06:00')
  const [bed, setBed] = useState('23:00')
  const [sleep, setSleep] = useState('7')
  const [card, setCard] = useState(0)
  const [amp, setAmp] = useState(0)

  const words = line(name)
  const needsCreds = !status?.hasCredentials
  const connected = !!status?.connected

  /* the line is spoken and written at the same time */
  useEffect(() => {
    if (step !== 'hello') return
    let i = 0
    const t = setInterval(() => {
      i += 1
      setTyped(words.slice(0, i))
      if (i >= words.length) clearInterval(t)
    }, 42)
    const done = () => { setAmp(0); setTalking(false) }
    // the shipped greeting first, in KAI's own voice; if it cannot play, KAI
    // says it instead, and if there is no voice at all it reads in silence
    playClip(greeting, { onLevel: setAmp, onEnd: done }).then((ok) => {
      if (!ok) speak(words, { onLevel: setAmp, onEnd: done })
    })
    return () => { clearInterval(t); hushVoice() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  /* the voice is fetched while they are reading, so the next line is KAI's own */
  useEffect(() => { warm().catch(() => {}) }, [])

  /* if Google came back connected, move on by itself */
  useEffect(() => { if (step === 'google' && connected) setStep('you') }, [step, connected])

  const hush = useCallback(() => { hushVoice(); setAmp(0) }, [])

  async function connect() {
    setError(''); setBusy(true)
    try {
      if (needsCreds) {
        if (!clientId.trim() || !clientSecret.trim()) { setError('Both lines are needed.'); setBusy(false); return }
        await onSaveCreds({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      }
      await onLogin()
    } catch (e) {
      setError((e && e.message) || 'That did not go through. Try again.')
    } finally { setBusy(false) }
  }

  function finish() {
    try {
      const prof = (() => { try { return JSON.parse(localStorage.getItem('grow_coach_profile')) || {} } catch (e) { return {} } })()
      if (name.trim()) localStorage.setItem('grow_coach_profile', JSON.stringify(Object.assign(prof, { name: name.trim() })))
      if (bday) localStorage.setItem('grow_user_birthday', bday)
      if (north.trim()) localStorage.setItem('grow_north_star', north.trim())
      const hours = (() => {
        const [a, b] = [wake, bed].map(s => { const p = String(s).split(':'); return (+p[0]) + (+p[1] || 0) / 60 })
        let h = b - a; if (h <= 0) h += 24
        return Math.max(1, Math.min(24, Math.round(h)))
      })()
      localStorage.setItem('grow_target_hours', String(hours))
      localStorage.setItem('grow_wake_time', wake)
      localStorage.setItem('grow_bed_time', bed)
      const s = parseFloat(sleep)
      if (!isNaN(s)) localStorage.setItem('grow_ideal_sleep', String(s))
      // the old sleep question is answered, so it never opens on top of this
      localStorage.setItem('grow_onboard_done', '1')
      localStorage.setItem('op_welcome_v1', '1')
    } catch (e) {}
    hush()
    onDone && onDone()
  }

  const TOUR = [
    { t: 'Home', d: 'Where your day actually went. The bar fills as you use the hours you said were yours, and it empties when they go somewhere else.' },
    { t: 'Calendar', d: 'Every Google calendar you have, in one calm day. Drag a block to move it, press an empty hour to make one.' },
    { t: 'KAI', d: 'Your mentor, running on this machine. Ask it what to do next, tell it what happened, and it plans the week and puts the work on the calendar.' }
  ]

  return (
    <div className="w-wrap">
      <style>{`
        .w-wrap{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;
          background:#ffffff;color:#12110f;padding:32px;overflow:auto}
        .w-mid{width:100%;max-width:620px;text-align:center}
        .w-orbwrap{display:flex;justify-content:center}
        .w-say{font-size:clamp(28px,4.6vw,52px);font-weight:600;line-height:1.22;letter-spacing:-.02em;
          margin:34px 0 0;min-height:1.3em}
        .w-say b{font-weight:600;border-right:2px solid #12110f;animation:wcar 1s steps(1) infinite}
        @keyframes wcar{50%{border-color:transparent}}
        .w-sub{margin:16px 0 0;font-size:16px;color:#6c6862;line-height:1.5}
        .w-btn{margin-top:34px;display:inline-flex;align-items:center;justify-content:center;gap:10px;
          min-height:52px;padding:0 30px;border:0;border-radius:999px;background:#12110f;color:#fff;
          font-size:16px;font-weight:600;cursor:pointer;font-family:inherit}
        .w-btn[disabled]{opacity:.45;cursor:default}
        .w-btn.ghost{background:none;color:#6c6862;min-height:44px;padding:0 14px;font-weight:500;margin-left:6px}
        .w-h{font-size:30px;font-weight:650;letter-spacing:-.02em;margin:26px 0 6px}
        .w-form{margin-top:26px;text-align:left}
        .w-f{margin-bottom:16px}
        .w-f label{display:block;font-size:13px;font-weight:600;color:#6c6862;margin-bottom:7px}
        .w-f input{width:100%;min-height:48px;padding:0 15px;border:1.5px solid #e6e2dc;border-radius:12px;
          background:#fff;color:#12110f;font-size:16px;font-family:inherit}
        .w-f input:focus{outline:none;border-color:#12110f}
        .w-two{display:flex;gap:12px}
        .w-two .w-f{flex:1}
        .w-err{margin-top:12px;font-size:14px;color:#b4402f}
        .w-steps{margin-top:30px;font-size:12px;letter-spacing:.14em;color:#a19c94;text-transform:uppercase}
        .w-card{text-align:left;border:1.5px solid #e6e2dc;border-radius:18px;padding:26px;margin-top:26px}
        .w-card h3{margin:0;font-size:22px;font-weight:650;letter-spacing:-.01em}
        .w-card p{margin:10px 0 0;font-size:16px;line-height:1.55;color:#57534d}
        .w-dots{display:flex;gap:7px;justify-content:center;margin-top:20px}
        .w-dots i{width:7px;height:7px;border-radius:50%;background:#ddd8d1}
        .w-dots i.on{background:#12110f}
        @media (prefers-color-scheme: dark){
          .w-wrap[data-dark="1"]{background:#0c0b0a;color:#f4f1ec}
        }
      `}</style>

      <div className="w-mid">
        {step === 'hello' && (
          <>
            <div className="w-orbwrap"><VoiceOrb size={132} amp={amp} active={talking} /></div>
            <p className="w-say">{typed}<b /></p>
            <p className="w-sub">Out Past runs on this machine. Your calendar, your work and KAI stay here.</p>
            <button className="w-btn" onClick={() => { hush(); setStep('google') }}>Let us get to work</button>
          </>
        )}

        {step === 'google' && (
          <>
            <div className="w-orbwrap"><VoiceOrb size={104} amp={0} active={false} /></div>
            <h2 className="w-h">Bring your calendar in</h2>
            <p className="w-sub">
              Out Past reads every Google calendar you have so it can show where your day really went.
              Nothing is uploaded anywhere. The sign in happens in your own browser.
            </p>
            {needsCreds && (
              <div className="w-form">
                <p className="w-sub" style={{ marginTop: 0 }}>
                  This app has no key of its own, so it uses yours. In the Google Cloud console make a
                  project, open Credentials, create an OAuth client of type Desktop app, then paste the two
                  lines it gives you.
                </p>
                <div className="w-f">
                  <label>Client ID</label>
                  <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" />
                </div>
                <div className="w-f">
                  <label>Client secret</label>
                  <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type="password" placeholder="GOCSPX-..." />
                </div>
              </div>
            )}
            {error && <p className="w-err">{error}</p>}
            <div>
              <button className="w-btn" onClick={connect} disabled={busy}>{busy ? 'Waiting for Google…' : 'Sign in with Google'}</button>
              <button className="w-btn ghost" onClick={() => setStep('you')}>Later</button>
            </div>
            <p className="w-steps">Step 1 of 4</p>
          </>
        )}

        {step === 'you' && (
          <>
            <h2 className="w-h">Who am I working with?</h2>
            <p className="w-sub">KAI uses your name when it talks to you, and your north star when it decides what matters.</p>
            <div className="w-form">
              <div className="w-f">
                <label>Your name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Kidus" />
              </div>
              <div className="w-f">
                <label>Your birthday</label>
                <input value={bday} onChange={e => setBday(e.target.value)} type="date" />
              </div>
              <div className="w-f">
                <label>Your north star</label>
                <input value={north} onChange={e => setNorth(e.target.value)} placeholder="The one thing this year is for" />
              </div>
            </div>
            <button className="w-btn" onClick={() => setStep('day')}>Next</button>
            <p className="w-steps">Step 2 of 4</p>
          </>
        )}

        {step === 'day' && (
          <>
            <h2 className="w-h">Your day</h2>
            <p className="w-sub">The hours you count as yours. Anything outside them is not held against you.</p>
            <div className="w-form">
              <div className="w-two">
                <div className="w-f">
                  <label>Up at</label>
                  <input value={wake} onChange={e => setWake(e.target.value)} type="time" />
                </div>
                <div className="w-f">
                  <label>Down at</label>
                  <input value={bed} onChange={e => setBed(e.target.value)} type="time" />
                </div>
              </div>
              <div className="w-f">
                <label>Sleep you actually need, in hours</label>
                <input value={sleep} onChange={e => setSleep(e.target.value)} type="number" min="3" max="12" step="0.5" />
              </div>
            </div>
            <button className="w-btn" onClick={() => setStep('tour')}>Next</button>
            <p className="w-steps">Step 3 of 4</p>
          </>
        )}

        {step === 'tour' && (
          <>
            <h2 className="w-h">Three things and you are in</h2>
            <div className="w-card">
              <h3>{TOUR[card].t}</h3>
              <p>{TOUR[card].d}</p>
            </div>
            <div className="w-dots">{TOUR.map((_, i) => <i key={i} className={i === card ? 'on' : ''} />)}</div>
            <button className="w-btn" onClick={() => (card < TOUR.length - 1 ? setCard(card + 1) : finish())}>
              {card < TOUR.length - 1 ? 'Next' : 'Start'}
            </button>
            {card < TOUR.length - 1 && <button className="w-btn ghost" onClick={finish}>Skip</button>}
            <p className="w-steps">Step 4 of 4</p>
          </>
        )}
      </div>
    </div>
  )
}

export { SAID }
