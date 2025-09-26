/**
 * @file src/lib/spectrogramGrid.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */
import { hueHeat } from './utils/color.js'
import { state, isPlaying } from './state.js'

let canvases = [], ctxs = [], meters = [], ro = null, loops = []

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
  if (ro) ro.disconnect()
  ro = new ResizeObserver(() => {
    holders.forEach((holder, i) => {
      if (i >= chCount) return
      const canvas = canvases[i]
      const ctx = ctxs[i]
      const old = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const w = holder.clientWidth || 300
      const h = holder.clientHeight || 150
      canvas.width = w
      canvas.height = h
      ctx.putImageData(old, 0, Math.max(0, h - old.height))
    })
  })
  holders.forEach((h,i)=> i<chCount && ro.observe(h))
}

export function start(analyzers, fft) {
  stop() // clear old loops
  const chCount = analyzers.length
  loops = new Array(chCount).fill(null)
  const timeBufs = analyzers.map(() => new Uint8Array(1024))

  for (let i=0; i<chCount; i++) {
    const an = analyzers[i]
    const ctx = ctxs[i]
    const canvas = canvases[i]
    const lvl = meters[i]
    const w = canvas.width, h = canvas.height

    const draw = () => {
      loops[i] = requestAnimationFrame(draw)
      if (!isPlaying()) return

      const data = new Uint8Array(an.frequencyBinCount)
      an.getByteFrequencyData(data)
      const img = ctx.getImageData(1, 0, w-1, h)
      ctx.putImageData(img, 0, 0)
      const x = w-1
      for (let y=0;y<h;y++){
        const bin = Math.floor((y/h) * data.length)
        const v = data[bin]
        ctx.fillStyle = hueHeat(v)
        ctx.fillRect(x, h-1-y, 1, 1)
      }

      // simple level meter
      const t = timeBufs[i]
      an.getByteTimeDomainData(t)
      let acc = 0
      for (let k=0;k<t.length;k++){ const s=(t[k]-128)/128; acc += s*s }
      const rms = Math.sqrt(acc / t.length)
      const pct = Math.max(0, Math.min(1, rms * 3)) * 100
      if (lvl) lvl.style.background = `linear-gradient(to right, #36d67e ${pct}%, transparent ${pct}%)`
    }
    draw()
  }
}

export function stop() {
  loops.forEach(id => id && cancelAnimationFrame(id))
  loops = []
}
