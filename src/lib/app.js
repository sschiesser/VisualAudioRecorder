
/**
 * @file src/lib/app.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */


import { state, setMode } from './state.js'
import { listDevices } from './deviceManager.js'
import { ensureStream, createContext, buildGraph, createAnalyzers } from './audioGraph.js'
import * as Spectro from './spectrogramGrid.js'
import * as Rec from './recorder.js'

// Play/Pause:
// - Buffers last 120s per channel (no audio monitoring).
// - Renders per-channel waveform + spectrograms live.
// - Number of channel panes == channel selector (1–4).

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

  // Initialize the grid to match the current channel selector (before Play)
  const initialCh = Math.min(4, parseInt(document.getElementById('channels').value, 10) || 2)
  Spectro.setupGrid('#spectrograms', initialCh)


  let stream = null
  let audioCtx = null
  let source = null
  let splitter = null
  let analyzers = []

  const setInfo   = (t) => (els.info.textContent = t)
  const setButton = (t) => (els.toggle.textContent = t)

  els.rec.disabled = true
  els.rec.title = 'Disabled: Play buffers last 120s automatically'

  // Initial device list (labels improve after mic permission)
  listDevices(els.deviceSelect, state.currentDeviceId)
    .then((id) => (state.currentDeviceId = id))
    .catch(() => {})

  async function play() {
    // Refresh devices; read channels (we will SHOW exactly this many panes)
    state.currentDeviceId = await listDevices(els.deviceSelect, state.currentDeviceId)
      .catch(() => els.deviceSelect.value || state.currentDeviceId)
    state.desiredChannels = parseInt(els.channels.value, 10) || 2

    // Stream + AudioContext
    stream = stream || (await ensureStream(state.currentDeviceId, state.desiredChannels))
    if (audioCtx) { try { audioCtx.close() } catch {} }
    audioCtx = createContext()
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume() } catch {} }

    // Build graph
    const graph = buildGraph(audioCtx, stream)
    source = graph.source
    splitter = graph.splitter

    // *** Pane count = selection (capped to 4) ***
    const chCount = Math.min(4, state.desiredChannels)

    // Spectrogram grid + analyzers
    Spectro.setupGrid('#spectrograms', chCount)
    setMode('playing')
    setButton('Pause')
    analyzers = createAnalyzers(
      audioCtx,
      splitter,
      parseInt(els.fft.value, 10) || 1024,
      chCount
    )

    requestAnimationFrame(() => {
      Spectro.start(analyzers)
    }); // ensure UI updates before heavy start
    

    // Start 120s circular buffering (no audio output/monitoring)
    const ok = await Rec.setupBuffering(audioCtx, source, chCount, 120)
    els.save.disabled = !ok

    setInfo(
      `${stream.getAudioTracks?.()[0]?.label || 'Mic'} • buffering 120s • ${chCount} ch @ ${audioCtx.sampleRate | 0} Hz`
    )

    // Repopulate device labels after permission
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
  }

  // UI
  els.toggle.addEventListener('click', async () => {
    if (state.mode === 'stopped')       await play()
    else if (state.mode === 'playing')  pause()
    else if (state.mode === 'paused')   await resume()
  })

  els.save.addEventListener('click', () => {
    Rec.saveAllBuffered(audioCtx?.sampleRate || 48000)
    setInfo('Saved last 120s from each visible channel.')
  })

  els.deviceSelect.addEventListener('change', async (e) => {
    state.currentDeviceId = e.target.value
    if (state.mode === 'stopped') return
    pause(); stopAll(); await play()
  })

els.channels.addEventListener('change', async (e) => {
  state.desiredChannels = parseInt(e.target.value, 10) || 2
  if (state.mode === 'playing') {
    pause(); stopAll(); await play()
  } else {
    // Reflect selection immediately when not playing
    Spectro.setupGrid('#spectrograms', Math.min(4, state.desiredChannels))
  }
})


  // FFT affects visuals only (buffering unaffected)
  els.fft.addEventListener('change', () => {
    if (state.mode === 'playing') {
      analyzers = createAnalyzers(audioCtx, splitter, parseInt(els.fft.value, 10) || 1024, analyzers.length)
      Spectro.start(analyzers)
    }
  })

  window.addEventListener('beforeunload', () => stopAll())
}
