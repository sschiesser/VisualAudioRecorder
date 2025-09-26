
/**
 * @file src/lib/app.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */

import { state, setMode } from './state.js'
import { listDevices } from './deviceManager.js'
import { ensureStream, createContext, buildGraph } from './audioGraph.js'
import * as Spectro from './spectrogramGrid.js'
import * as Rec from './recorder.js'

export function initApp() {
  const els = {
    toggle: document.getElementById('toggle'),
    rec: document.getElementById('rec'),
    save: document.getElementById('save'),
    deviceSelect: document.getElementById('deviceSelect'),
    channels: document.getElementById('channels'),
    fft: document.getElementById('fft'),
    bufferSec: document.getElementById('bufferSec'),
    info: document.getElementById('info'),
  }

  let stream = null
  let audioCtx = null
  let source = null
  let splitter = null
  let analyzers = []
  let gains = []
  let merger = null

  const setInfo = (t) => (els.info.textContent = t)
  const setButton = (t) => (els.toggle.textContent = t)
  const dbToLinear = (db) => Math.pow(10, db / 20)

  els.rec.disabled = true
  els.rec.title = 'Disabled: Play buffers last N seconds automatically'

  const initialCh = Math.min(4, parseInt(els.channels.value, 10) || 2)
  Spectro.setupGrid('#spectrograms', initialCh)
  Spectro.setWindowSeconds(parseInt(els.bufferSec.value, 10) || 120)

  listDevices(els.deviceSelect, state.currentDeviceId)
    .then((id) => (state.currentDeviceId = id))
    .catch(() => {})

  async function play() {
    state.currentDeviceId = await listDevices(els.deviceSelect, state.currentDeviceId)
      .catch(() => els.deviceSelect.value || state.currentDeviceId)
    state.desiredChannels = Math.min(4, parseInt(els.channels.value, 10) || 2)
    const bufferSec = parseInt(els.bufferSec.value, 10) || 120
    Spectro.setWindowSeconds(bufferSec)

    stream = stream || (await ensureStream(state.currentDeviceId, state.desiredChannels))
    if (audioCtx) { try { audioCtx.close() } catch {} }
    audioCtx = createContext()
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume() } catch {} }

    const graph = buildGraph(audioCtx, stream)
    source = graph.source
    splitter = graph.splitter

    const chCount = state.desiredChannels
    Spectro.setupGrid('#spectrograms', chCount)

    gains = Array.from({ length: chCount }, () => { const g = audioCtx.createGain(); g.gain.value = 1; return g })
    analyzers = Array.from({ length: chCount }, () => { const a = audioCtx.createAnalyser(); a.fftSize = parseInt(els.fft.value,10)||1024; a.smoothingTimeConstant = 0.8; return a })

    for (let i=0;i<chCount;i++){ splitter.connect(gains[i], i, 0); gains[i].connect(analyzers[i]) }

    merger = audioCtx.createChannelMerger(chCount)
    for (let i=0;i<chCount;i++){ gains[i].connect(merger, 0, i) }

    const setters = gains.map((g) => (db) => { g.gain.value = dbToLinear(db) })
    Spectro.bindGains(setters)

    setMode('playing'); setButton('Pause')
    requestAnimationFrame(() => { Spectro.start(analyzers) })

    const ok = await Rec.setupBuffering(audioCtx, merger, chCount, bufferSec)
    els.save.disabled = !ok

    setInfo(`${stream.getAudioTracks?.()[0]?.label || 'Mic'} • buffering ${bufferSec}s • ${chCount} ch @ ${audioCtx.sampleRate|0} Hz`)
    listDevices(els.deviceSelect, state.currentDeviceId).catch(() => {})
  }

  function pause() {
    setMode('paused')
    if (audioCtx) { try { audioCtx.suspend() } catch {} }
    setButton('Play')
    setInfo('Paused (buffer + visuals paused)')
  }

  async function resume() {
    if (audioCtx?.state === 'suspended') { await audioCtx.resume().catch(() => {}) }
    setMode('playing')
    setButton('Pause')
    setInfo('Buffering + visuals resumed')
  }

  function stopAll() {
    Spectro.stop()
    if (audioCtx) { try { audioCtx.close() } catch {} ; audioCtx = null }
    if (stream)  { try { stream.getTracks().forEach(t => t.stop()) } catch {} ; stream = null }
    gains = []; merger = null
  }

  els.toggle.addEventListener('click', async () => {
    if (state.mode === 'stopped')       await play()
    else if (state.mode === 'playing')  pause()
    else if (state.mode === 'paused')   await resume()
  })

  els.save.addEventListener('click', () => {
    Rec.saveAllBuffered(audioCtx?.sampleRate || 48000)
    setInfo('Saved last N seconds from each visible channel (post-gain).')
  })

  els.deviceSelect.addEventListener('change', async (e) => {
    state.currentDeviceId = e.target.value
    if (state.mode === 'stopped') return
    pause(); stopAll(); await play()
  })

  els.channels.addEventListener('change', async (e) => {
    state.desiredChannels = Math.min(4, parseInt(e.target.value, 10) || 2)
    if (state.mode === 'playing') { pause(); stopAll(); await play() }
    else { Spectro.setupGrid('#spectrograms', state.desiredChannels) }
  })

  els.fft.addEventListener('change', () => {
    if (state.mode === 'playing') {
      analyzers.forEach(an => { an.fftSize = parseInt(els.fft.value, 10) || 1024 })
      Spectro.start(analyzers)
    }
  })

  els.bufferSec.addEventListener('change', () => {
    const buf = parseInt(els.bufferSec.value, 10) || 120
    Spectro.setWindowSeconds(buf)
    if (state.mode === 'playing') {
      Rec.setBufferSeconds(buf)
      setInfo(`Buffer length set to ${buf}s`)
    }
  })

  window.addEventListener('beforeunload', () => stopAll())
}
