/**
 * @file src/lib/recorder.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */

import { encodeWavPCM16 } from './utils/wav.js'

let node = null

let rb = {
  seconds: 120,
  sampleRate: 48000,
  chCount: 0,
  cap: 0,
  data: [],
  writePos: [],
  filled: [],
}

function initRing(sampleRate, chCount, seconds = 120) {
  rb.seconds = seconds|0
  rb.sampleRate = sampleRate|0
  rb.chCount = chCount|0
  rb.cap = (rb.sampleRate * rb.seconds)|0
  rb.data = Array.from({ length: chCount }, () => new Float32Array(rb.cap))
  rb.writePos = Array.from({ length: chCount }, () => 0)
  rb.filled = Array.from({ length: chCount }, () => 0)
}

function writeToRing(ch, chunk) {
  const buf = rb.data[ch]; const N = buf.length
  let wp = rb.writePos[ch]; let i = 0; const L = chunk.length
  while (i < L) {
    const toEnd = N - wp
    const n = Math.min(toEnd, L - i)
    buf.set(chunk.subarray(i, i+n), wp)
    wp = (wp + n) % N
    i += n
  }
  rb.writePos[ch] = wp
  rb.filled[ch] = Math.min(N, rb.filled[ch] + L)
}

function readRing(ch) {
  const buf = rb.data[ch]; const filled = rb.filled[ch]; const N = buf.length
  if (!filled) return new Float32Array(0)
  const out = new Float32Array(filled)
  const start = (rb.writePos[ch] - filled + N) % N
  const first = Math.min(N - start, filled)
  out.set(buf.subarray(start, start + first), 0)
  if (first < filled) out.set(buf.subarray(0, filled - first), first)
  return out
}

export async function setupBuffering(audioCtx, inputNode, chCount, seconds = 120) {
  initRing(audioCtx.sampleRate, chCount, seconds)
  try {
    await audioCtx.audioWorklet.addModule('/src/lib/recorder-worklet.js')
    node = new AudioWorkletNode(audioCtx, 'multichannel-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: chCount,
      processorOptions: { maxChannels: chCount },
    })
    inputNode.connect(node)
    node.port.onmessage = (e) => {
      const { type, buffers } = e.data || {}
      if (type !== 'chunk' || !buffers) return
      for (let i=0; i<chCount; i++) writeToRing(i, buffers[i] || new Float32Array(0))
    }
    return true
  } catch (e) {
    console.warn('AudioWorklet unavailable:', e)
    node = null
    return false
  }
}

export function setBufferSeconds(seconds) {
  initRing(rb.sampleRate, rb.chCount, seconds|0)
}

export function saveAllBuffered(sampleRateOverride) {
  const sr = (sampleRateOverride|0) || rb.sampleRate
  for (let i=0;i<rb.chCount;i++){
    const data = readRing(i)
    if (!data.length) continue
    const wav = encodeWavPCM16(data, sr)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(wav)
    a.download = `last_${rb.seconds}s_ch${i+1}_${sr}Hz.wav`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
}
