/**
 * @file src/lib/spectrogramGrid.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */

import { hueHeat } from './utils/color.js'
import { isPlaying } from './state.js'

// Fixed visible window in seconds
const WINDOW_SECONDS = 120

let canvases = [], ctxs = [], meters = [], ro = null, loops = []
let analyzersRef = []
let freqData = [], timeData = []
let lastTs = [], pxPerSec = [], accumPx = []

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

  // Prepare timing & buffers per channel
  const ch = chCount
  analyzersRef = new Array(ch)
  freqData = new Array(ch)
  timeData = new Array(ch)
  lastTs = new Array(ch).fill(0)
  pxPerSec = new Array(ch).fill(0)
  accumPx = new Array(ch).fill(0)

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
      ctx.putImageData(old, Math.max(0, w - old.width), Math.max(0, h - old.height))
      // Recompute pixels per second for the fixed 120s window
      pxPerSec[i] = w / WINDOW_SECONDS
    })
  })
  canvases.forEach((c) => c && ro.observe(c.parentElement))
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

      // Keep the loop alive even if paused
      if (!isPlaying()) {
        lastTs[i] = ts || performance.now()
        return
      }

      // How many pixels should we advance since last frame?
      const now = ts || performance.now()
      const dt = Math.max(0, (now - lastTs[i]) / 1000)  // seconds
      lastTs[i] = now
      accumPx[i] += dt * pxPerSec[i]
      let steps = accumPx[i] | 0 // integer pixels to advance
      if (steps <= 0) steps = 0
      if (steps > w) steps = w
      accumPx[i] -= steps

      // Only redraw if at least 1px of time has elapsed
      if (steps > 0) {
        // Pull the latest spectrum once per frame
        an.getByteFrequencyData(freqData[i])

        // Shift image left by 'steps' pixels
        if (steps < w) {
          const img = ctx.getImageData(steps, 0, w - steps, h)
          ctx.putImageData(img, 0, 0)
        } else {
          // full clear if we advanced >= width
          ctx.fillStyle = '#0a0f16'
          ctx.fillRect(0, 0, w, h)
        }

        // Draw 'steps' time columns on the right edge
        for (let s = steps; s > 0; s--) {
          const x = w - s
          for (let y = 0; y < h; y++) {
            const bin = Math.floor((y / h) * freqData[i].length)
            const v = freqData[i][bin]
            ctx.fillStyle = hueHeat(v)
            ctx.fillRect(x, h - 1 - y, 1, 1)
          }
        }
      }

      // Simple level meter (RMS-ish)
      an.getByteTimeDomainData(timeData[i])
      let acc = 0
      for (let k = 0; k < timeData[i].length; k++) {
        const s = (timeData[i][k] - 128) / 128
        acc += s * s
      }
      const rms = Math.sqrt(acc / timeData[i].length)
      const pct = Math.max(0, Math.min(1, rms * 3)) * 100
      if (lvl) {
        lvl.style.background = `linear-gradient(to right, #36d67e ${pct}%, transparent ${pct}%)`
      }
    }
    loops[i] = requestAnimationFrame(draw)
  }
}

export function stop() {
  loops.forEach(id => id && cancelAnimationFrame(id))
  loops = []
}
