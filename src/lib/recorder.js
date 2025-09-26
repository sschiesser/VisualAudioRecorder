/*
 * Copyright (C) 2025 sschiesser
 * SPDX-License-Identifier: GPL-3.0-only
 */
import { encodeWavPCM16 } from './utils/wav.js'

let node = null
let buffers = [[],[],[],[]]
let enabled = false

export async function setupRecorder(audioCtx, source, chCount) {
  try {
    await audioCtx.audioWorklet.addModule('/src/lib/recorder-worklet.js')
    node = new AudioWorkletNode(audioCtx, 'multichannel-recorder', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: chCount, processorOptions: { maxChannels: chCount } })
    source.connect(node)
    node.port.onmessage = (e) => {
      if (!enabled) return
      const { type, buffers: chunk } = e.data || {}
      if (type === 'chunk') {
        chunk.forEach((buf, i) => { if (i < 4) buffers[i].push(buf) })
      }
    }
    return true
  } catch (e) {
    console.warn('AudioWorklet unavailable:', e)
    node = null
    return false
  }
}

export function toggleRecording() {
  enabled = !enabled
  if (enabled) buffers = [[],[],[],[]]
  return enabled
}

export function saveAll(sampleRate) {
  const downloadBlob = (blob, filename) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  buffers.forEach((list, i) => {
    if (!list.length) return
    const total = list.reduce((acc, cur) => {
      const merged = new Float32Array(acc.length + cur.length)
      merged.set(acc, 0); merged.set(cur, acc.length)
      return merged
    }, new Float32Array(0))
    const wav = encodeWavPCM16(total, sampleRate)
    downloadBlob(wav, `mic_ch${i+1}_${sampleRate}Hz.wav`)
  })
  buffers = [[],[],[],[]]
}
