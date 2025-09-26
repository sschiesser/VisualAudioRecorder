
/**
 * @file src/lib/app.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */

import { state, setMode, isPlaying } from './state.js'
import { listDevices } from './deviceManager.js'
import { ensureStream, createContext, buildGraph, createAnalyzers } from './audioGraph.js'
import { setupWaveform, attachStream, detach, destroy as destroyWaveform } from './waveform.js'
import * as Spectro from './spectrogramGrid.js'
import * as Rec from './recorder.js'

// ================================================================================
export function initApp() {
  const els = {
    toggle: document.getElementById('toggle'),
    rec: document.getElementById('rec'),
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

  const setInfo = (t) => els.info.textContent = t
  const setButton = (t) => els.toggle.textContent = t
  const enableRec = (on) => { els.rec.disabled = !on; els.save.disabled = !on && !Rec.__maybe_has_chunks }

  // Initial devices (labels improve after permission)
  listDevices(els.deviceSelect, state.currentDeviceId).then(id => state.currentDeviceId = id).catch(()=>{})

/*================================================================================
  Initializes (or resumes) the microphone stream and AudioContext, 
  builds the audio graph, starts waveform/spectrogram analyzers,
  and enables recording/UI.
  ================================================================================
*/
  async function play() {
    // Device list (may gain labels now)
    state.currentDeviceId = await listDevices(els.deviceSelect, state.currentDeviceId).catch(()=>els.deviceSelect.value || state.currentDeviceId)
    state.desiredChannels = parseInt(els.channels.value,10) || 2

    stream = stream || await ensureStream(state.currentDeviceId, state.desiredChannels)
    if (audioCtx) try { audioCtx.close() } catch {}
    audioCtx = createContext()
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume() } catch {} }

    const graph = buildGraph(audioCtx, stream)
    source = graph.source; splitter = graph.splitter

    // Waveform view
    setupWaveform('#waveform')
    attachStream(stream)

    // Channel count and spectro
    const actual = source.channelCount || state.desiredChannels
    const chCount = Math.min(4, Math.max(1, Math.min(actual, state.desiredChannels)))
    Spectro.setupGrid('#spectrograms', chCount)

    // Mark playing before loops
    setMode('playing')
    setButton('Pause')

    analyzers = createAnalyzers(audioCtx, splitter, parseInt(els.fft.value,10)||1024, chCount)
    Spectro.start(analyzers)

    setInfo(`${stream.getAudioTracks()[0]?.label || 'Mic'} • ${chCount} ch @ ${audioCtx.sampleRate|0} Hz`)

    // Recorder worklet
    const ok = await Rec.setupRecorder(audioCtx, source, chCount)
    els.rec.disabled = !ok
  }

// ================================================================================
  function pause() {
    setMode('paused')
    detach()
    if (audioCtx) { try { audioCtx.suspend() } catch {} }
    setButton('Play')
    setInfo('Paused')
  }

// ================================================================================
  async function resume() {
    if (audioCtx?.state === 'suspended') { await audioCtx.resume().catch(()=>{}) }
    attachStream(stream)
    setMode('playing')
    setButton('Pause')
    setInfo('Mic resumed')
  }

// ================================================================================
  function stopAll() {
    Spectro.stop()
    detach()
    destroyWaveform()
    if (audioCtx) { try { audioCtx.close() } catch {} ; audioCtx = null }
    if (stream) { try { stream.getTracks().forEach(t=>t.stop()) } catch {} ; stream = null }
  }

// ================================================================================
  // UI
// ================================================================================
  els.toggle.addEventListener('click', async () => {
    if (state.mode === 'stopped') await play()
    else if (state.mode === 'playing') pause()
    else if (state.mode === 'paused') resume()
  })

// ================================================================================
  els.rec.addEventListener('click', () => {
    const on = Rec.toggleRecording()
    els.rec.textContent = on ? '■ Stop Rec' : '● Rec'
    els.save.disabled = !on
    setInfo(on ? 'Recording…' : 'Recording stopped. Ready to save.')
  })

// ================================================================================
  els.save.addEventListener('click', () => {
    Rec.saveAll(audioCtx?.sampleRate || 48000)
    els.save.disabled = true
    setInfo('Saved.')
  })

// ================================================================================
  els.deviceSelect.addEventListener('change', async (e) => {
    state.currentDeviceId = e.target.value
    if (state.mode === 'stopped') return
    pause(); stopAll(); await play()
  })

// ================================================================================
  els.channels.addEventListener('change', async (e) => {
    state.desiredChannels = parseInt(e.target.value,10) || 2
    if (state.mode === 'playing') { pause(); stopAll(); await play() }
  })

// ================================================================================
  els.fft.addEventListener('change', () => {
    if (state.mode === 'playing') {
      analyzers = createAnalyzers(audioCtx, splitter, parseInt(els.fft.value,10)||1024, analyzers.length)
      Spectro.start(analyzers)
    }
  })

// ================================================================================
  window.addEventListener('beforeunload', () => stopAll())
}
