/**
 * @file src/lib/spectrogramGrid.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */

import { hueHeat } from './utils/color.js'
import { isPlaying } from './state.js'

// Fixed time window in seconds (full canvas width)
const WINDOW_SECONDS = 120
// Portion of each channel canvas reserved for waveform (rest is spectrogram)
const WAVE_RATIO = 0.25  // 25% height waveform, 75% spectrogram

let canvases = [], ctxs = [], meters = [], ro = null, loops = []
let analyzersRef = []
let freqData = [], timeData = []
let lastTs = [], pxPerSec = [], accumPx = []
let lastW = [], lastH = []

export function setupGrid(containerSelector = '#spectrograms', chCount = 2) {
  const holders = Array.from(document.querySelectorAll(containerSelector + ' .spec'))
  canvases = []; ctxs = []; meters = []
  holders.forEach((holder, i) => {
    const canvas = holder.querySelector('canvas')
    const label = holder.querySelector('span')
    const lvl = holder.querySelector('.lvl')
    holder.style.display = (i < chCount) ? 'block' : 'none'
    if (i < chCount) {
      const w = holder.clientWidth || 300
      const h = holder.clientHeight || 150
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#0a0f16'
      ctx.fillRect(0, 0, w, h)
      canvases[i] = canvas
      ctxs[i] = ctx
      meters[i] = lvl
      label.textContent = `CH ${i+1}`
    }
  })

  // Prepare arrays per visible channel
  analyzersRef = new Array(chCount)
  freqData = new Array(chCount)
  timeData = new Array(chCount)
  lastTs = new Array(chCount).fill(0)
  pxPerSec = new Array(chCount).fill(0)
  accumPx = new Array(chCount).fill(0)

  // Keep drawings on resize and recompute pixels-per-second
  if (ro) ro.disconnect()
  ro = new ResizeObserver(() => {
    canvases.forEach((canvas, i) => {
      if (!canvas) return
      const holder = canvas.parentElement
      const ctx = ctxs[i]
      const old = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const w = holder.clientWidth || 300
      const h = holder.clientHeight || 150
      canvas.width = w
      canvas.height = h
      // shift old to the left if the new canvas is wider
      ctx.putImageData(old, Math.max(0, w - old.width), Math.max(0, h - old.height))
      pxPerSec[i] = w / WINDOW_SECONDS
    })
  })
  canvases.forEach((c) => c && ro.observe(c.parentElement))

  pxPerSec = canvases.map(c => (c?.width || 300) / WINDOW_SECONDS)
  lastW    = canvases.map(c => c?.width  || 0)
  lastH    = canvases.map(c => c?.height || 0)
}

export function start(analyzers) {
  stop() // clear old loops
  const chCount = analyzers.length
  analyzersRef = analyzers

  // allocate data buffers & timing
  for (let i = 0; i < chCount; i++) {
    freqData[i] = new Uint8Array(analyzers[i].frequencyBinCount)
    timeData[i] = new Uint8Array(1024)
    lastTs[i]   = performance.now()
    pxPerSec[i] = (canvases[i].width || 300) / WINDOW_SECONDS
    accumPx[i]  = 0
  }

  loops = new Array(chCount).fill(null)
  for (let i = 0; i < chCount; i++) {
    const ctx = ctxs[i], canvas = canvases[i], an = analyzers[i], lvl = meters[i]

    const draw = (ts) => {
      loops[i] = requestAnimationFrame(draw)
      const w = canvas.width, h = canvas.height
      if(!w || !h) {
        lastTs[i] = ts || performance.now()
        return
      }
      if (w !== lastW[i]) {
        pxPerSec[i] = w / WINDOW_SECONDS
        lastW[i] = w
      }
      lastH[i] = h
      const hWave = Math.max(30, Math.round(h * WAVE_RATIO))     // waveform area height
      const hSpec = Math.max(1, h - hWave)                        // spectrogram area height

      if (!isPlaying()) {
        lastTs[i] = ts || performance.now()
        return
      }

      // advance time in pixels so width == WINDOW_SECONDS
      const now = ts || performance.now()
      const dt = Math.max(0, (now - lastTs[i]) / 1000)
      lastTs[i] = now
      accumPx[i] += dt * pxPerSec[i]
      let steps = accumPx[i] | 0
      if (steps > w) steps = w
      if (steps > 0) accumPx[i] -= steps

      // Pull data once per frame
      an.getByteFrequencyData(freqData[i])
      an.getByteTimeDomainData(timeData[i])

      if (steps > 0) {
        // Shift entire canvas left by 'steps' pixels
        if (steps < w) {
          const img = ctx.getImageData(steps, 0, w - steps, h)
          ctx.putImageData(img, 0, 0)
        } else {
          ctx.fillStyle = '#0a0f16'
          ctx.fillRect(0, 0, w, h)
        }

        // Draw 'steps' new columns on the right
        for (let s = steps; s > 0; s--) {
          const x = w - s

          // --- Waveform column (top area) ---
          // Map one sample (centered) to a y position
          const t = timeData[i]
          // pick a representative sample (middle)
          const val = (t[(t.length / 2) | 0] - 128) / 128
          const mid = (hWave / 2) | 0
          const amp = Math.max(-1, Math.min(1, val))
          const y = mid - Math.round(amp * (hWave / 2 - 1))

          // Clear column area then draw a 2px-high line for visibility
          ctx.fillStyle = '#0a0f16'
          ctx.fillRect(x, 0, 1, hWave)
          ctx.fillStyle = '#7cc5ff'
          ctx.fillRect(x, Math.max(0, y - 1), 1, 2)

          // --- Spectrogram column (bottom area) ---
          for (let yy = 0; yy < hSpec; yy++) {
            const bin = Math.floor((yy / hSpec) * freqData[i].length)
            const v = freqData[i][bin]
            ctx.fillStyle = hueHeat(v)
            ctx.fillRect(x, h - 1 - yy, 1, 1)
          }
        }
      }

      // Simple level meter (RMS-ish), independent of steps
      let acc = 0
      for (let k = 0; k < timeData[i].length; k++) {
        const s = (timeData[i][k] - 128) / 128
        acc += s * s
      }
      const rms = Math.sqrt(acc / timeData[i].length)
      const pct = Math.max(0, Math.min(1, rms * 3)) * 100
      if (lvl) lvl.style.background = `linear-gradient(to right, #36d67e ${pct}%, transparent ${pct}%)`
    }

    loops[i] = requestAnimationFrame(draw)
  }
}

export function stop() {
  loops.forEach(id => id && cancelAnimationFrame(id))
  loops = []
}
