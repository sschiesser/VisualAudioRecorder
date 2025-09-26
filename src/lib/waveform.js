/*
 * Copyright (C) 2025 sschiesser
 * SPDX-License-Identifier: GPL-3.0-only
 */
import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'

let ws, record
let cleanup = null

export function setupWaveform(container = '#waveform') {
  if (ws) try { ws.destroy() } catch {}
  ws = WaveSurfer.create({
    container,
    height: 120,
    interact: false,
    waveColor: '#7cc5ff',
    progressColor: '#7cc5ff',
    cursorWidth: 0,
  })
  record = ws.registerPlugin(RecordPlugin.create({
    scrollingWaveform: true,
    scrollingWaveformWindow: 6,
  }))
}

export function attachStream(stream) {
  if (!record) throw new Error('record plugin not initialized')
  const { onDestroy } = record.renderMicStream(stream)
  cleanup = onDestroy
}

export function detach() {
  if (cleanup) { try { cleanup() } catch {} ; cleanup = null }
}

export function destroy() {
  detach()
  if (ws) try { ws.destroy() } catch {}
  ws = null; record = null
}
