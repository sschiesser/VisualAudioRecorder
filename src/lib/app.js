
/**
 * @file src/lib/app.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */
// src/lib/app.js
import { state, setMode } from './state.js'
import { listDevices } from './deviceManager.js'
import { ensureStream, createContext, buildGraph } from './audioGraph.js'
import * as Spectro from './spectrogramGrid.js'
import * as Rec from './recorder.js'

// Play/Pause:
// - Buffers last 120s per channel (no audio monitor).
// - Renders per-channel waveform + spectrograms (120s wide).
// - Shows exactly the selected number of channels (1–4).
// - NEW: Per-channel gain sliders (−24 dB … +24 dB) affecting visuals & buffer.

export function initApp() {
  const els = {
    toggle: document.getElementById('toggle'),
    rec: document.getElementById('rec'),   // disabled in buffer mode
    save: document.getElementById('save'),
    deviceSelect: document.getElementById('deviceSelect'),
    channels: document.getElementById('channels'),
    fft: document.getElementById('fft'),
    info: document.getElementById('info'),
  }

  let stream = null
  let audioCtx = null
  let source = null
  let splitter = null
  let analyzers = []
  let gains = []
  let merger = null

  const setInfo   = (t) => (els.info.textContent = t)
  const setButton = (t) => (els.toggle.textContent = t)

  els.rec.disabled = true
  els.rec.title = 'Disabled: Play buffers last 120s automatically'

  // Initialize grid to current channel selector on first load (before Play)
  const initialCh = Math.min(4, parseInt(els.channels.value, 10) || 2)
  Spectro.setupGrid('#spectrograms', initialCh)

  // Initial device list (labels improve after mic permission)
  listDevices(els.deviceSelect, state.currentDeviceId)
    .then((id) => (state.currentDeviceId = id))
    .catch(() => {})

  function dbToLinear(db) {
    return Math.pow(10, db / 20)
  }

  async function play() {
    // Refresh devices; read channels (we SHOW exactly this many panes)
    state.currentDeviceId = await listDevices(els.deviceSelect, state.currentDeviceId)
      .catch(() => els.deviceSelect.value || state.currentDeviceId)
    state.desiredChannels = Math.min(4, parseInt(els.channels.value, 10) || 2)

    // Stream + AudioContext
    stream = stream || (await ensureStream(state.currentDeviceId, state.desiredChannels))
    if (audioCtx) { try { audioCtx.close() } catch {} }
    audioCtx = createContext()
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume() } catch {} }

    // Build base graph (source + splitter)
    const graph = buildGraph(audioCtx, stream)
    source = graph.source
    splitter = graph.splitter

    const chCount = state.desiredChannels
    Spectro.setupGrid('#spectrograms', chCount)

    // Create per-channel GainNodes and AnalyserNodes, wire: splitter -> gain[i] -> analyser[i]
    gains = Array.from({ length: chCount }, () => {
      const g = audioCtx.createGain()
      g.gain.value = 1 // 0 dB
      return g
    })

    analyzers = Array.from({ length: chCount }, () => {
      const an = audioCtx.createAnalyser()
      an.fftSize = parseInt(els.fft.value, 10) || 1024
      an.smoothingTimeConstant = 0.8
      return an
    })

    for (let i = 0; i < chCount; i++) {
      splitter.connect(gains[i], i, 0)
      gains[i].connect(analyzers[i])
    }

    // Merge post-gain channels for the recorder worklet so saved audio reflects gain
    merger = audioCtx.createChannelMerger(chCount)
    for (let i = 0; i < chCount; i++) {
      // connect gain[i] to merger's input channel i
      gains[i].connect(merger, 0, i)
    }

    // Bind gain sliders in the grid to these GainNodes
    const setters = gains.map((g) => (db) => { g.gain.value = dbToLinear(db) })
    Spectro.bindGains(setters)

    setMode('playing')
    setButton('Pause')

    // Defer start one frame to avoid 0×0 canvas at first layout
    requestAnimationFrame(() => {
      Spectro.start(analyzers)
    })

    // Start 120s circular buffering from the POST-GAIN merger (affects saved audio)
    const ok = await Rec.setupBuffering(audioCtx, merger, chCount, 120)
    els.save.disabled = !ok

    setInfo(
      `${stream.getAudioTracks?.()[0]?.label || 'Mic'} • buffering 120s • ${chCount} ch @ ${audioCtx.sampleRate | 0} Hz`
    )

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
    gains = []
    merger = null
  }

  // UI
  els.toggle.addEventListener('click', async () => {
    if (state.mode === 'stopped')       await play()
    else if (state.mode === 'playing')  pause()
    else if (state.mode === 'paused')   await resume()
  })

  els.save.addEventListener('click', () => {
    Rec.saveAllBuffered(audioCtx?.sampleRate || 48000)
    setInfo('Saved last 120s from each visible channel (post-gain).')
  })

  els.deviceSelect.addEventListener('change', async (e) => {
    state.currentDeviceId = e.target.value
    if (state.mode === 'stopped') return
    pause(); stopAll(); await play()
  })

  els.channels.addEventListener('change', async (e) => {
    state.desiredChannels = Math.min(4, parseInt(e.target.value, 10) || 2)
    if (state.mode === 'playing') {
      pause(); stopAll(); await play()
    } else {
      // Update layout immediately when stopped
      Spectro.setupGrid('#spectrograms', state.desiredChannels)
    }
  })

  // FFT affects visuals only (buffering unaffected)
  els.fft.addEventListener('change', () => {
    if (state.mode === 'playing') {
      analyzers.forEach(an => { an.fftSize = parseInt(els.fft.value, 10) || 1024 })
      Spectro.start(analyzers) // restart loops to use new bin count
    }
  })

  window.addEventListener('beforeunload', () => stopAll())
}
