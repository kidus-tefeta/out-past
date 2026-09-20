import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import TopBar from './components/TopBar.jsx'
import DailyView from './components/DailyView.jsx'
import HomeView from './components/HomeView.jsx'
import WeeklyView from './components/WeeklyView.jsx'
import MonthlyView from './components/MonthlyView.jsx'
import Login from './components/Login.jsx'
import Settings from './components/Settings.jsx'
import Goals from './components/Goals.jsx'
import { analyzeDay, analyzeRange, lastNDays, currentRun } from './lib/analysis.js'
import Splash from './components/Splash.jsx'
import Welcome from './components/Welcome.jsx'
import CalendarView from './components/CalendarView.jsx'
import FloatingGAI from './components/FloatingGAI.jsx'
import Coach from './components/Coach.jsx'
import Memories from './components/Memories.jsx'
import ContentView from './components/ContentView.jsx'
import Onboarding from './components/Onboarding.jsx'
import PlanningView from './components/PlanningView.jsx'
import Sidebar from './components/Sidebar.jsx'
import TopStrip from './components/TopStrip.jsx'
import Greeting from './components/Greeting.jsx'
import { dailyGreeting } from './lib/greetings.js'
import { sleepOpinion } from './lib/kb.js'
import { buildDayPlan, aiEstimateMinutes } from './lib/planday.js'
import GrowView from './components/GrowView.jsx'
import LockInView from './components/LockInView.jsx'
import Upgrade from './components/Upgrade.jsx'
import { checkMembership } from './lib/membership.js'
import { SyncEngine } from './sync.jsx'

function fmtElapsed(ms) {
  const s = Math.floor((ms || 0) / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  const p = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`
}
function fmtClock(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } catch { return '' } }

// Only a truly dead/revoked Google login should trigger the reconnect prompt.
// Network blips and rate limits are transient — keep the last data, stay quiet.
function isAuthErr(e) { const m = (e && (e.message || String(e))) || ''; return /AUTH_EXPIRED|invalid_grant|unauthorized|\b401\b/i.test(m) }

export default function App() {
  const [status, setStatus] = useState(null)
  const [events, setEvents] = useState([])
  const eventsRef = useRef(events)
  useEffect(() => { eventsRef.current = events }, [events])
  const sleepSyncRef = useRef(new Set())       // nights already reconciled onto the calendar
  const undoStack = useRef([])                 // calendar undo history (Cmd/Ctrl+Z)
  const growUndoRef = useRef(null)             // mission-page undo, registered by GrowView
  const [undoNote, setUndoNote] = useState('')
  const pushUndo = useCallback((entry) => { undoStack.current.push(entry); if (undoStack.current.length > 40) undoStack.current.shift() }, [])
  const [lastSync, setLastSync] = useState(null)
  const [tab, setTab] = useState('home')
  const [refreshing, setRefreshing] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
const [showCoach, setShowCoach] = useState(false)         // bottom floating (KAI style)
const [showCoachPage, setShowCoachPage] = useState(false) // top KAI, its own full page
const [showMemories, setShowMemories] = useState(false)   // growth journal (profile pic)
const [idealSleep, setIdealSleep] = useState(() => { try { const v = parseFloat(localStorage.getItem('grow_ideal_sleep')); return isNaN(v) ? null : v } catch { return null } })
const [showOnboarding, setShowOnboarding] = useState(() => { try { return localStorage.getItem('grow_onboard_done') !== '1' } catch { return true } })
const [contentNonce, setContentNonce] = useState(0)   // bump remounts Content -> back to Generate
const [contentMounted, setContentMounted] = useState(false)  // keep Content alive in the background so video keeps playing across tabs
const [showGoalsEdit, setShowGoalsEdit] = useState(false)
const [dailyGoals, setDailyGoals] = useState(() => { try { const s=localStorage.getItem('grow_daily_goals'); if(s){const p=JSON.parse(s); if(p.date===new Date().toDateString()) return p.goals;} } catch(e){} return null; })
const [storedCreds, setStoredCreds] = useState(null)
  const [now, setNow] = useState(new Date())
const [splash, setSplash] = useState(true)
/* the first run on this machine: KAI says hello out loud, then walks them in */
const [welcomed, setWelcomed] = useState(() => { try { return localStorage.getItem('op_welcome_v1') === '1' } catch { return false } })
const [theme, setTheme] = useState(() => { try { return localStorage.getItem('op5_theme') || 'light' } catch { return 'light' } })
const [greeting, setGreeting] = useState(null)
const [sleepData, setSleepData] = useState({ intervals: [], trackingStart: null })
const [sleepingSince, setSleepingSince] = useState(null)
const [sleepResult, setSleepResult] = useState(null)
const [, setSleepTick] = useState(0)
const [writeAuthed, setWriteAuthed] = useState(() => { try { return localStorage.getItem('grow_cal_write_ok') === '1' } catch { return false } })
const markWriteOk = useCallback(() => { try { localStorage.setItem('grow_cal_write_ok', '1') } catch {}; setWriteAuthed(true) }, [])

  // Pull the real sleep log (24h-minus-sleep model). Refetch when sleep changes.
  useEffect(() => {
    const load = async () => { try { const s = await window.kd?.sleep?.log?.(); if (s) setSleepData(s) } catch (e) {} }
    load()
    const off = window.kd?.onSleepDetected?.(() => load())
    return () => { if (off) off() }
  }, [])

  // Manual-sleep overlay: resume a running timer on open / when the Mac wakes.
  useEffect(() => {
    const check = async () => { try { const s = await window.kd?.sleep?.manualStatus?.(); if (s) setSleepingSince(s) } catch (e) {} }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])
  useEffect(() => {
    if (!sleepingSince) return
    const id = setInterval(() => setSleepTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [sleepingSince])

  const startSleep = useCallback(() => {
    setSleepResult(null)
    setSleepingSince(Date.now())
    setTimeout(() => { try { window.kd.mac.sleepNow() } catch (e) {} }, 900)
  }, [])
  const stopSleep = useCallback(async () => {
    let res = { counted: false, ms: 0 }
    try { res = await window.kd.sleep.manualStop() } catch (e) {}
    setSleepingSince(null)
    const mins = Math.round((res.ms || 0) / 60000)
    const h = Math.floor(mins / 60), m = mins % 60
    const hm = h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
    setSleepResult(res.counted ? `You were out ${hm}. Logged as sleep. Now get up and attack.` : `${mins}m, under 20. That's not sleep. Now let's get back to work.`)
    try { const s = await window.kd?.sleep?.log?.(); if (s) setSleepData(s) } catch (e) {}
  }, [])

  // Membership: check on sign-in, and re-check when the window regains focus
  // (so returning from Stripe checkout in the browser flips the app to member).
  useEffect(() => {
    const email = status && status.account && status.account.email
    if (!email) { setMember(false); return }
    let alive = true
    const run = async () => { const r = await checkMembership(email); if (alive) setMember(!!r.member) }
    run()
    const onFocus = () => run()
    window.addEventListener('focus', onFocus)
    return () => { alive = false; window.removeEventListener('focus', onFocus) }
  }, [status && status.account && status.account.email])

  // KAI war-cry: fires when Grow opens (once/day) AND whenever a real sleep
  // (>=1h) is detected, showing the actual hours slept. Coded, no tokens.
  useEffect(() => {
    if (splash || !status || !status.connected) return
    const fmtSleep = (ms) => {
      const mins = Math.round(ms / 60000), h = Math.floor(mins / 60), m = mins % 60
      return h <= 0 ? `${m}m` : (m ? `${h}h ${m}m` : `${h}h`)
    }
    const fire = (ms) => {
      const name = (() => { try { return JSON.parse(localStorage.getItem('grow_coach_profile'))?.name || '' } catch { return '' } })()
      const sleepText = ms ? fmtSleep(ms) : ''
      const opinion = ms ? sleepOpinion(ms / 3600000) : ''
      const birthday = (() => {
        try {
          const b = localStorage.getItem('grow_user_birthday'); if (!b) return false
          const d = new Date(b + 'T00:00:00'); if (isNaN(d)) return false
          const now = new Date()
          return d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
        } catch { return false }
      })()
      setGreeting({ ...dailyGreeting(name), sleepText, sleepOpinion: opinion, birthday })
    }
    // Drop a "Sleep" block on the calendar from when you fell asleep to when you woke,
    // at your REAL times. Dedupe ONLY against our own blue (colorId 9) auto blocks — so
    // your own 11pm "Sleep" routine never blocks it.
    const bookSleep = (startMs, endMs) => {
      if (!startMs || !endMs || (endMs - startMs) < 60 * 60 * 1000) return
      try {
        const exists = (eventsRef.current || []).some((e) => e.colorId === '9' && (e.summary || '') === 'Sleep' && Math.abs(new Date(e.start).getTime() - startMs) < 90000)
        if (!exists) createEvent({ summary: 'Sleep', start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), colorId: '9' })
      } catch (e) {}
    }
    let cancelled = false
    ;(async () => {
      let ms = 0
      try {
        const s = await window.kd?.sleep?.last?.()
        if (s && (Date.now() - s.at) < 15 * 60 * 1000 && s.ms >= 60 * 60 * 1000) { ms = s.ms; bookSleep(s.at - s.ms, s.at) }
      } catch (e) {}
      if (cancelled) return
      const today = new Date().toDateString()
      const shownToday = localStorage.getItem('grow_greeting_date') === today
      if (!shownToday || ms) {
        fire(ms)
        try { localStorage.setItem('grow_greeting_date', today) } catch (e) {}
      }
    })()
    const off = window.kd?.onSleepDetected?.((p) => { if (p && p.ms >= 60 * 60 * 1000) { bookSleep(p.start, p.end); if (p.greet) fire(p.ms) } })
    return () => { cancelled = true; if (off) off() }
  }, [splash, status])

  // Keep the calendar in step with the sleep log: EVERY night in the log (last 30
  // days, >=1h) gets a blue Sleep block at its real times. This reconciles on every
  // launch and whenever the log updates, not once, so a night the app was closed for
  // at wake time still shows a block instead of only counting in the stats.
  // Waits for the calendar to finish loading so the dedupe has something to compare.
  useEffect(() => {
    if (splash || !status || !status.connected) return
    if (refreshing || !lastSync) return
    let cancelled = false
    ;(async () => {
      try {
        const log = await window.kd?.sleep?.log?.()
        const intervals = (log && log.intervals) || []
        const cutoff = Date.now() - 30 * 864e5
        for (const iv of intervals) {
          if (cancelled) return
          if (!iv || !iv.start || !iv.end || (iv.end - iv.start) < 60 * 60 * 1000 || iv.end < cutoff) continue
          const key = Math.round(iv.start / 60000)
          if (sleepSyncRef.current.has(key)) continue
          // Dedupe ONLY against our own blue (colorId 9) blocks, so your own "Sleep"
          // routine never stops the real one from being written.
          const exists = (eventsRef.current || []).some((e) => e.colorId === '9' && (e.summary || '') === 'Sleep' && Math.abs(new Date(e.start).getTime() - iv.start) < 90000)
          if (!exists) await createEvent({ summary: 'Sleep', start: new Date(iv.start).toISOString(), end: new Date(iv.end).toISOString(), colorId: '9' })
          sleepSyncRef.current.add(key)
        }
      } catch (e) {}
    })()
    return () => { cancelled = true }
  }, [splash, status, refreshing, lastSync, sleepData])

  // apply + persist the customer's chosen theme (dark / light)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('op5_theme', theme) } catch {}
  }, [theme])

  // refresh the "now" clock that drives analysis once a minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const refreshStatus = useCallback(async () => {
    const s = await window.kd.auth.status()
    setStatus(s)
    return s
  }, [])

  // boot: load status, cached data, photo, then auto-pull if connected
  useEffect(() => {
    let unsub
    ;(async () => {
      const s = await refreshStatus()
      setPhoto(await window.kd.profile.get())
      const cached = await window.kd.calendar.get()
      try { localStorage.setItem("grow_cached_events", JSON.stringify(cached.events || [])); } catch(e){}
      setEvents(cached.events || [])
      setLastSync(cached.lastSync || null)

      // auto-pull on every open
      if (s.connected) {
        setRefreshing(true)
        try {
          const pulled = await window.kd.calendar.autopull()
          const merged = keepLocal(pulled.events || [])
          setEvents(merged); persistLocal(merged)
          setLastSync(pulled.lastSync || null)
          setSyncError(false)
        } catch (e) {
          console.error(e)
          setSyncError(isAuthErr(e))   // only prompt reconnect if the login is actually dead
        } finally {
          setRefreshing(false)
        }
      }

      // hourly background push from the main process
      unsub = window.kd.onCalendarUpdated((payload) => {
        if (payload?.events) {
          setEvents(payload.events)
          setLastSync(payload.lastSync)
        }
      })
    })()
    return () => unsub && unsub()
  }, [refreshStatus])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setSyncError(false)
    try {
      const r = await window.kd.calendar.refresh()
      setEvents(r.events || [])
      setLastSync(r.lastSync || null)
    } catch (e) {
      console.error(e)
      setSyncError(isAuthErr(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  const handleLogin = useCallback(async () => {
    const s = await window.kd.auth.login()
    setStatus(s)
    const cached = await window.kd.calendar.get()
    setEvents(cached.events || [])
    setLastSync(cached.lastSync || null)
  }, [])

  // Quiet re-pull after a calendar write, to reconcile with Google's truth.
  // Save the current blocks to disk right away, so a restart never loses what you
  // just made — even if Google sync hasn't caught up.
  const persistLocal = useCallback((next) => { try { window.kd.calendar.cache && window.kd.calendar.cache(next) } catch (e) {} }, [])
  // A fresh Google pull must NOT drop blocks you created that haven't landed on
  // Google yet (temp ids) — keep any that aren't already in the pulled set.
  const keepLocal = (pulled) => {
    const temps = (eventsRef.current || []).filter((e) => String(e.id).startsWith('tmp_'))
    if (!temps.length) return pulled
    // Compare real timestamps, not raw ISO strings — Google returns a different
    // offset/precision than the temp event's string, so a strict string match
    // never fires and the temp duplicate sticks around forever.
    const has = (t) => {
      const tStart = new Date(t.start).getTime()
      return pulled.some((p) => p.summary === t.summary && Math.abs(new Date(p.start).getTime() - tStart) < 60000)
    }
    return [...pulled, ...temps.filter((t) => !has(t))]
  }
  const silentRefresh = useCallback(async () => {
    try { const r = await window.kd.calendar.refresh(); const merged = keepLocal(r.events || []); setEvents(merged); persistLocal(merged); setLastSync(r.lastSync || null); setSyncError(false) }
    catch (e) { console.error(e); if (isAuthErr(e)) setSyncError(true) }
  }, [persistLocal])

  // In-app calendar writes. Optimistic local update first (instant), then write
  // to Google, then a quiet re-pull so ids/edits match the server.
  const createEvent = useCallback(async ({ summary, start, end, calendarId, recurrence, colorId, allDay, description, location }) => {
    const temp = { id: 'tmp_' + Date.now(), calendarId: calendarId || 'primary', calendarName: '', colorId: colorId || null, summary: summary || 'New block', description: description || '', location: location || '', start: new Date(start).toISOString(), end: new Date(end).toISOString(), allDay: !!allDay }
    setEvents(evs => { const next = [...evs, temp]; persistLocal(next); return next })
    pushUndo({ type: 'create', match: { summary: temp.summary, start: temp.start, end: temp.end } })
    try { await window.kd.calendar.create({ summary, start, end, calendarId, recurrence, colorId, allDay, description, location }); markWriteOk() } catch (e) { console.error(e) }
    silentRefresh()
  }, [silentRefresh, markWriteOk, pushUndo, persistLocal])

  const updateEvent = useCallback(async ({ id, calendarId, summary, start, end, recurrence, description, location }) => {
    const prev = eventsRef.current.find(e => e.id === id)
    if (prev) pushUndo({ type: 'update', id, calendarId: calendarId || prev.calendarId, prev: { summary: prev.summary, start: prev.start, end: prev.end } })
    setEvents(evs => { const next = evs.map(e => e.id === id ? { ...e, ...(summary != null ? { summary } : {}), ...(description != null ? { description } : {}), ...(location != null ? { location } : {}), ...(start ? { start: new Date(start).toISOString() } : {}), ...(end ? { end: new Date(end).toISOString() } : {}) } : e); persistLocal(next); return next })
    try { await window.kd.calendar.update({ id, calendarId, summary, start, end, recurrence, description, location }); markWriteOk() } catch (e) { console.error(e) }
    silentRefresh()
  }, [silentRefresh, markWriteOk, pushUndo, persistLocal])

  const deleteEvent = useCallback(async ({ id, calendarId }) => {
    const prev = eventsRef.current.find(e => e.id === id)
    if (prev) pushUndo({ type: 'delete', prev: { summary: prev.summary, start: prev.start, end: prev.end, calendarId: prev.calendarId, colorId: prev.colorId, allDay: prev.allDay } })
    setEvents(evs => { const next = evs.filter(e => e.id !== id); persistLocal(next); return next })
    try { await window.kd.calendar.remove({ id, calendarId }); markWriteOk() } catch (e) { console.error(e) }
    silentRefresh()
  }, [silentRefresh, markWriteOk, pushUndo, persistLocal])

  // Content watch -> book it on the calendar, and PUSH every later event down by
  // the time watched (cascading into the next day if it has to). Automatic.
  const logWatch = useCallback(async ({ title, start, end }) => {
    const startMs = new Date(start).getTime(), endMs = new Date(end).getTime()
    const dur = endMs - startMs
    if (dur < 60 * 1000) return
    const shift = (iso) => new Date(new Date(iso).getTime() + dur).toISOString()
    const affected = events.filter(e => !e.allDay && new Date(e.start).getTime() >= startMs)
    const temp = { id: 'tmp_' + Date.now(), calendarId: 'primary', calendarName: '', colorId: null, summary: 'Watching ' + title, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), allDay: false }
    setEvents(evs => [...evs.map(e => affected.includes(e) ? { ...e, start: shift(e.start), end: shift(e.end) } : e), temp])
    pushUndo({ type: 'logwatch', match: { summary: temp.summary, start: temp.start, end: temp.end }, affected: affected.map(e => ({ id: e.id, calendarId: e.calendarId, start: e.start, end: e.end })) })
    try {
      await window.kd.calendar.create({ summary: 'Watching ' + title, start: temp.start, end: temp.end })
      for (const e of affected) { try { await window.kd.calendar.update({ id: e.id, calendarId: e.calendarId, start: shift(e.start), end: shift(e.end) }) } catch (err) { console.error(err) } }
      markWriteOk()
    } catch (e) { console.error(e) }
    silentRefresh()
  }, [events, silentRefresh, markWriteOk, pushUndo])

  // Undo the last calendar change (Cmd/Ctrl+Z). Reverses moves, resizes,
  // renames, creates, deletes, and the content push-down cascade.
  const flashUndo = useCallback((msg) => { setUndoNote(msg); setTimeout(() => setUndoNote(''), 1600) }, [])
  const undoCalendar = useCallback(async () => {
    const entry = undoStack.current.pop()
    if (!entry) { flashUndo('Nothing to undo'); return }
    try {
      if (entry.type === 'update') {
        setEvents(evs => evs.map(e => e.id === entry.id ? { ...e, summary: entry.prev.summary, start: entry.prev.start, end: entry.prev.end } : e))
        try { await window.kd.calendar.update({ id: entry.id, calendarId: entry.calendarId, summary: entry.prev.summary, start: entry.prev.start, end: entry.prev.end }) } catch (e) { console.error(e) }
        flashUndo('Change undone')
      } else if (entry.type === 'delete') {
        const p = entry.prev
        setEvents(evs => [...evs, { id: 'tmp_' + Date.now(), calendarName: '', ...p }])
        try { await window.kd.calendar.create({ summary: p.summary, start: p.start, end: p.end, calendarId: p.calendarId, colorId: p.colorId, allDay: p.allDay }) } catch (e) { console.error(e) }
        flashUndo('Event restored')
      } else if (entry.type === 'create') {
        const m = eventsRef.current.find(e => e.summary === entry.match.summary && e.start === entry.match.start && e.end === entry.match.end)
        if (m) { setEvents(evs => evs.filter(e => e !== m)); try { await window.kd.calendar.remove({ id: m.id, calendarId: m.calendarId }) } catch (e) { console.error(e) } }
        flashUndo('Event removed')
      } else if (entry.type === 'logwatch') {
        const watch = eventsRef.current.find(e => e.summary === entry.match.summary && e.start === entry.match.start && e.end === entry.match.end)
        setEvents(evs => evs.filter(e => !(e.summary === entry.match.summary && e.start === entry.match.start && e.end === entry.match.end)).map(e => { const a = entry.affected.find(x => x.id === e.id); return a ? { ...e, start: a.start, end: a.end } : e }))
        if (watch && !String(watch.id).startsWith('tmp_')) { try { await window.kd.calendar.remove({ id: watch.id, calendarId: watch.calendarId }) } catch (e) { console.error(e) } }
        for (const a of entry.affected) { try { await window.kd.calendar.update({ id: a.id, calendarId: a.calendarId, start: a.start, end: a.end }) } catch (e) { console.error(e) } }
        flashUndo('Watch booking undone')
      } else if (entry.type === 'planday') {
        const toRemove = eventsRef.current.filter(e => entry.match.some(m => m.summary === e.summary && m.start === e.start && m.end === e.end))
        setEvents(evs => evs.filter(e => !toRemove.includes(e)))
        for (const e of toRemove) { if (!String(e.id).startsWith('tmp_') && !String(e.id).startsWith('plan_')) { try { await window.kd.calendar.remove({ id: e.id, calendarId: e.calendarId }) } catch (err) { console.error(err) } } }
        flashUndo('Day plan undone')
      }
    } finally { silentRefresh() }
  }, [silentRefresh, flashUndo])

  // Plan my day: KAI reads your 3 non-negotiables, skips any you already put on
  // the calendar, decides how long each remaining one needs, and books them into
  // today's open time. If your day is already scheduled, it does nothing.
  const [planning, setPlanning] = useState(false)
  const [planResult, setPlanResult] = useState(null)   // { booked, already, unplaced } for the summary card
  const [member, setMember] = useState(false)          // paid membership (unlocks AI)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const planMyDay = useCallback(async () => {
    if (planning) return
    let goals = dailyGoals
    if (!goals || !goals.filter(g => g && g.trim()).length) {
      try { const s = localStorage.getItem('grow_daily_goals'); if (s) { const p = JSON.parse(s); if (p.date === new Date().toDateString()) goals = p.goals } } catch (e) {}
    }
    goals = (goals || []).filter(g => g && g.trim())
    if (!goals.length) { setPlanResult({ empty: true }); setShowGoalsEdit(true); return }
    setPlanning(true)
    try {
      // Ask Haiku how long each task needs (key stays on the Cloudflare Worker).
      // Falls back to the instant on-device estimate if offline or it fails.
      const ctx = (() => { try { const p = JSON.parse(localStorage.getItem('grow_coach_profile')); return p ? `Role: ${p.role || ''}. Focus: ${p.problem || ''}.` : '' } catch { return '' } })()
      const email = status && status.account && status.account.email
      const ai = member ? await aiEstimateMinutes(goals, ctx, email) : null
      const plan = buildDayPlan(goals, eventsRef.current, new Date(), ai)
      const booked = plan.filter(p => p.booked)
      const already = plan.filter(p => p.already)
      const unplaced = plan.filter(p => p.unplaced)
      if (booked.length) {
        const blocks = booked.map((b, i) => ({ id: 'plan_' + Date.now() + '_' + i, calendarId: 'primary', calendarName: '', colorId: null, summary: b.title, start: b.start, end: b.end, allDay: false }))
        setEvents(evs => [...evs, ...blocks])
        pushUndo({ type: 'planday', match: blocks.map(b => ({ summary: b.summary, start: b.start, end: b.end })) })
        try { for (const b of blocks) { await window.kd.calendar.create({ summary: b.summary, start: b.start, end: b.end }) } markWriteOk() } catch (e) { console.error(e) }
        silentRefresh()
      }
      setPlanResult({ booked, already, unplaced })
    } finally { setPlanning(false) }
  }, [planning, dailyGoals, pushUndo, markWriteOk, silentRefresh, member, status])

  // Global keyboard shortcuts. Cmd/Ctrl+Z undoes the last calendar change
  // (ignored while typing in a field, so text undo still works there).
  useEffect(() => {
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase()
      const tag = (e.target && e.target.tagName) || ''
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && k === 'z' && !e.shiftKey && !typing) {
        e.preventDefault()
        // On the mission page, undo its edits first; fall back to calendar undo.
        if (tab === 'grow' && growUndoRef.current && growUndoRef.current()) return
        undoCalendar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoCalendar, tab])

  // One-time: grant Grow permission to EDIT the calendar (write scope). Re-auth.
  const authorizeWrite = useCallback(async () => {
    setRefreshing(true)
    try { const s = await window.kd.auth.login(); setStatus(s); await silentRefresh(); markWriteOk() }
    catch (e) { console.error(e) } finally { setRefreshing(false) }
  }, [silentRefresh, markWriteOk])

  // One-click reconnect when the Google token has died. Re-auth, then pull.
  const handleReconnect = useCallback(async () => {
    setRefreshing(true)
    setSyncError(false)
    try {
      const s = await window.kd.auth.login()
      setStatus(s)
      const r = await window.kd.calendar.refresh()
      setEvents(r.events || [])
      setLastSync(r.lastSync || null)
    } catch (e) {
      console.error(e)
      setSyncError(isAuthErr(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await window.kd.auth.logout()
    setEvents([])
    setLastSync(null)
    setShowSettings(false)
    await refreshStatus()
  }, [refreshStatus])

  useEffect(() => { window.kd.creds.get().then(c => { if(c) setStoredCreds(c); }); }, []);
  const handleSaveCreds = useCallback(async (creds) => { setStoredCreds(creds);
    const s = await window.kd.creds.set(creds)
    setStatus(s)
  }, [])

  const handlePhoto = useCallback(async (dataUrl) => {
    const saved = await window.kd.profile.set(dataUrl)
    setPhoto(saved)
  }, [])

  // analysis derived from events + clock. Cap sleep at the user's ideal so
  // oversleep counts as wasted, not rest.
  const sleepForAnalysis = useMemo(() => ({ ...sleepData, idealMin: idealSleep ? Math.round(idealSleep * 60) : null }), [sleepData, idealSleep])
  const today = useMemo(() => analyzeDay(events, now, now, sleepForAnalysis), [events, now, sleepForAnalysis])
  const yesterday = useMemo(() => { const y = new Date(now); y.setDate(y.getDate() - 1); return analyzeDay(events, y, now, sleepForAnalysis) }, [events, now, sleepForAnalysis])
  // How long you have been up since you last slept, and how much of it you
  // worked. Midnight does not reset this, only sleep does.
  const run = useMemo(() => currentRun(events, now, sleepForAnalysis), [events, now, sleepForAnalysis])
  const week = useMemo(() => analyzeRange(events, lastNDays(7, now), now, sleepForAnalysis), [events, now, sleepForAnalysis])
  const month = useMemo(() => analyzeRange(events, lastNDays(30, now), now, sleepForAnalysis), [events, now, sleepForAnalysis])

  // Streak: consecutive days you showed up (>=50% productive), ending today.
  // Today counts once you've cleared 30% of the day. This is the flame.
  const streak = useMemo(() => {
    const days = analyzeRange(events, lastNDays(30, now), now, sleepForAnalysis).perDay
    let s = 0
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i]
      if (d.isToday) { if (d.completion >= 30) s++; continue }
      if (d.completion >= 50) s++; else break
    }
    return s
  }, [events, now, sleepForAnalysis])

  if (!status) return <div className="center-screen">Loading…</div>
  /* a new machine is greeted before it is asked anything */
  if (!welcomed) {
    return <Welcome status={status} onSaveCreds={handleSaveCreds} onLogin={handleLogin} onDone={() => setWelcomed(true)} />
  }
if (splash) return <Splash onDone={() => setSplash(false)} />

  if (!status.connected) {
    return <Login status={status} onSaveCreds={handleSaveCreds} onLogin={handleLogin} />
  }

  return (
    <div className="app-shell">
      <Sidebar
        tab={(showSettings || showCoachPage || showMemories || showGoalsEdit) ? '__none__' : tab}
        settingsOpen={showSettings}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onTab={(t) => { setTab(t); setShowSettings(false); setShowCoachPage(false); setShowGoalsEdit(false); setShowMemories(false); if (t === 'content') setContentMounted(true); }}
        onSettings={() => { setShowSettings(true); setShowCoachPage(false); setShowGoalsEdit(false); setShowMemories(false); }}
        onCoach={() => { setShowCoachPage(o => !o); setShowSettings(false); setShowGoalsEdit(false); setShowMemories(false); }}
        photo={photo}
        account={status.account}
        onOpenMemories={() => { setShowMemories(true); setShowSettings(false); setShowGoalsEdit(false); setShowCoachPage(false); }}
      />
      <main className="main">
      <TopStrip
        streak={streak}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        syncError={syncError}
        onReconnect={handleReconnect}
        lastSync={lastSync}
      />
      <div className={`content${!showSettings && !showGoalsEdit && tab === 'calendar' ? ' content-flush' : ''}`}>
       {showSettings ? (
          <Settings
            status={status}
            lastSync={lastSync}
            onClose={() => setShowSettings(false)}
            onResetAI={() => { ['grow_coach_profile','grow_chat_history','grow_onboard_done','grow_ideal_sleep','grow_user_age','grow_user_birthday'].forEach(k => localStorage.removeItem(k)); setIdealSleep(null); setShowSettings(false); setShowOnboarding(true); }}
            onLogout={handleLogout}
            onEditGoals={() => { setShowSettings(false); setShowGoalsEdit(true); }}
            member={member}
            onUpgrade={() => { setShowSettings(false); setShowUpgrade(true); }}
            onCreateEvent={createEvent}
            idealSleep={idealSleep}
            onIdealSleep={(v) => { if (v == null) { localStorage.removeItem('grow_ideal_sleep'); setIdealSleep(null) } else { localStorage.setItem('grow_ideal_sleep', String(v)); setIdealSleep(v) } }}
          />
        ) : showGoalsEdit ? (
          <Goals onDone={() => { try { const s=localStorage.getItem('grow_daily_goals'); if(s){const p=JSON.parse(s); setDailyGoals(p.goals||null);} } catch(e){} setShowGoalsEdit(false); }} />
        ) : showMemories ? (
          <Memories onSetPhoto={handlePhoto} onExit={() => { setShowMemories(false); setTab('daily') }} />
        ) : showCoachPage ? (
          <Coach mode="mentor" onClose={() => setShowCoachPage(false)} events={events} apiKey={storedCreds?.anthropicKey} onStartSleep={startSleep} sleep={sleepData} onCreateEvent={createEvent} photo={photo} account={status.account} member={member} onUpgrade={() => setShowUpgrade(true)} />
        ) : (
          <>
            {tab === 'grow' && <GrowView events={events} now={now} onCreateEvent={createEvent} onUpdateEvent={updateEvent} onDeleteEvent={deleteEvent} onRegisterUndo={(fn) => { growUndoRef.current = fn }} email={status.account && status.account.email} member={member} />}
            {tab === 'home' && <HomeView now={now} day={today} yesterday={yesterday} week={week} month={month} onGoTab={(t) => setTab(t)} />}
            {tab === 'planning' && <PlanningView events={events} onPlanDay={planMyDay} planning={planning} onGoTab={(t) => setTab(t)} />}
            {tab === 'daily' && <DailyView day={today} run={run} goals={dailyGoals || (() => { try { const s=localStorage.getItem("grow_daily_goals"); if(s){const p=JSON.parse(s); if(p.date===new Date().toDateString()) return p.goals;} } catch(e){} return null; })()} />}
            {tab === 'calendar' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {!writeAuthed && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '16px 28px 0', padding: '12px 16px', borderRadius: 12, background: 'rgba(245,208,96,0.10)', border: '1px solid var(--teal-dim)' }}>
                    <div style={{ fontSize: 13, color: 'var(--text)' }}>To create and move events, Out Past needs one-time permission to edit your Google Calendar.</div>
                    <button onClick={authorizeWrite} disabled={refreshing} style={{ background: 'var(--gold)', color: 'var(--on-gold)', border: 'none', borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>{refreshing ? 'Connecting…' : 'Enable editing →'}</button>
                  </div>
                )}
                <CalendarView events={events} now={now} onCreate={createEvent} onUpdate={updateEvent} onDelete={deleteEvent} onPlanDay={planMyDay} planning={planning} />
              </div>
            )}
            {/* Content stays MOUNTED once opened, so a playing video keeps going when you
                switch tabs. When it is not the active tab it is parked off-screen (still
                rendered, so the webview keeps playing) instead of unmounted. */}
            {contentMounted && (
              <div style={tab === 'content'
                ? undefined
                : { position: 'fixed', left: '-100000px', top: 0, width: '1200px', height: '800px', overflow: 'hidden', pointerEvents: 'none' }}>
                <ContentView key={contentNonce} onLogWatch={logWatch} />
              </div>
            )}
            {tab === 'lockin' && <LockInView />}
            {tab === 'weekly' && <WeeklyView range={week} />}
            {tab === 'monthly' && <MonthlyView range={month} />}
          </>
        )}
      </div>

      {status.connected && !showSettings && !showGoalsEdit && !showCoachPage && !showMemories && (
        <FloatingGAI
          open={showCoach}
          onToggle={() => setShowCoach(o => !o)}
          mode="assistant"
          events={events}
          apiKey={storedCreds?.anthropicKey}
          onStartSleep={startSleep}
          sleep={sleepData}
          onCreateEvent={createEvent}
          account={status.account}
          member={member}
          onUpgrade={() => setShowUpgrade(true)}
        />
      )}
      {showUpgrade && <Upgrade email={status.account && status.account.email} onClose={() => setShowUpgrade(false)} />}
      <SyncEngine />
      {showOnboarding && (
        <Onboarding onDone={(h) => { setShowOnboarding(false); setIdealSleep(h) }} />
      )}
      {planResult && (
        <div onClick={() => setPlanResult(null)} style={{ position: 'fixed', inset: 0, zIndex: 14500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 94vw)', background: 'var(--panel)', border: '1px solid var(--teal-dim)', borderRadius: 20, padding: 26, boxShadow: '0 40px 100px -25px rgba(0,0,0,0.85)' }}>
            {planResult.empty ? (
              <>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 20, color: 'var(--text)', marginBottom: 8 }}>Set your 3 non-negotiables first</div>
                <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>Write the 3 things you must do today, then hit Plan my day and KAI will book them for you.</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 20, color: 'var(--text)', marginBottom: 4 }}>
                  {planResult.booked?.length ? `KAI planned your day` : `Your day is already set`}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
                  {planResult.booked?.length ? `Booked ${planResult.booked.length} block${planResult.booked.length > 1 ? 's' : ''} into your open time. Press Cmd+Z to undo.` : `Nothing to add. Everything you listed is already scheduled, or there is no open time left.`}
                </div>
                {planResult.booked?.map((b, i) => (
                  <div key={'b' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', flexShrink: 0 }} />
                    <div style={{ flex: 1, color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{b.title}</div>
                    <div style={{ color: 'var(--gold)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtClock(b.start)} to {fmtClock(b.end)}</div>
                  </div>
                ))}
                {planResult.already?.map((b, i) => (
                  <div key={'a' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--done)', fontSize: 13, flexShrink: 0 }}>✓</span>
                    <div style={{ flex: 1, color: 'var(--muted)', fontSize: 14 }}>{b.title}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>already on it</div>
                  </div>
                ))}
                {planResult.unplaced?.map((b, i) => (
                  <div key={'u' + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--red)', fontSize: 13, flexShrink: 0 }}>!</span>
                    <div style={{ flex: 1, color: 'var(--muted)', fontSize: 14 }}>{b.title}</div>
                    <div style={{ color: 'var(--red)', fontSize: 12, whiteSpace: 'nowrap' }}>no open time</div>
                  </div>
                ))}
              </>
            )}
            <button onClick={() => setPlanResult(null)} style={{ marginTop: 18, width: '100%', background: 'linear-gradient(180deg, var(--gold), var(--gold-2))', color: 'var(--on-gold)', border: 'none', borderRadius: 12, padding: '12px', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Got it</button>
          </div>
        </div>
      )}
      {undoNote && (
        <div style={{ position: 'fixed', bottom: 26, left: '50%', transform: 'translateX(-50%)', zIndex: 15000, background: 'var(--panel)', border: '1px solid var(--teal-dim)', color: 'var(--text)', borderRadius: 12, padding: '10px 18px', fontWeight: 700, fontSize: 14, boxShadow: '0 14px 40px -12px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
          ↩ {undoNote}
        </div>
      )}
      {greeting && (
        <Greeting
          who={greeting.who}
          line={greeting.line}
          sleepText={greeting.sleepText}
          sleepOpinion={greeting.sleepOpinion}
          birthday={greeting.birthday}
          onClose={() => setGreeting(null)}
        />
      )}

      {(sleepingSince || sleepResult) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
          <div style={{ width: 'min(820px, 92vw)', padding: 'clamp(32px,5vw,68px)', borderRadius: 30, background: 'var(--panel)', border: '1px solid var(--teal-dim)', boxShadow: '0 50px 130px -30px rgba(0,0,0,0.85), 0 0 70px rgba(245,208,96,0.14)', textAlign: 'center' }}>
            {sleepingSince ? (
              <>
                <div style={{ fontSize: 46, marginBottom: 6 }}>😴</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 12, letterSpacing: 5, textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 700, marginBottom: 16 }}>Sleeping</div>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 800, letterSpacing: '-3px', lineHeight: 1, fontSize: 'clamp(76px,17vw,200px)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtElapsed(Date.now() - sleepingSince)}</div>
                <div style={{ color: 'var(--muted)', fontSize: 'clamp(13px,1.2vw,17px)', marginTop: 16 }}>Hit stop when you wake up. Under 20 minutes won't count.</div>
                <button onClick={stopSleep} style={{ marginTop: 34, background: 'linear-gradient(180deg,#f0b48f,var(--gold) 45%,var(--gold-2))', color: 'var(--on-gold)', border: 'none', borderRadius: 18, padding: '18px 72px', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 22, letterSpacing: 3, cursor: 'pointer' }}>STOP</button>
              </>
            ) : (
              <>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'clamp(22px,2.6vw,36px)', color: 'var(--text)', lineHeight: 1.3 }}>{sleepResult}</div>
                <button onClick={() => setSleepResult(null)} style={{ marginTop: 30, background: 'linear-gradient(180deg,var(--gold),var(--gold-2))', color: 'var(--on-gold)', border: 'none', borderRadius: 14, padding: '15px 52px', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 17, letterSpacing: 1, cursor: 'pointer' }}>LET'S GO →</button>
              </>
            )}
          </div>
        </div>
      )}
      </main>
    </div>
  )
}
