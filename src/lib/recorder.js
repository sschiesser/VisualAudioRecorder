/**
 * @file src/lib/recorder.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */

import { encodeWavPCM16 } from './utils/wav.js'

let node = null

// Ring buffer per channel
let rb = {
  seconds: 120,
  sampleRate: 48000,
  chCount: 0,
  cap: 0,                // frames per channel
  data: [],              // Float32Array[ch] length = cap
  writePos: [],          // per-channel write index (0..cap-1)
  filled: [],            // per-channel filled frames (<= cap)
}

// ---- ring helpers ----
function initRing(sampleRate, chCount, seconds = 120) {
  rb.seconds = seconds
  rb.sampleRate = sampleRate | 0
  rb.chCount = chCount | 0
  rb.cap = (rb.sampleRate * rb.seconds) | 0
  rb.data = Array.from({ length: chCount }, () => new Float32Array(rb.cap))
  rb.writePos = Array.from({ length: chCount }, () => 0)
  rb.filled = Array.from({ length: chCount }, () => 0)
}

function writeToRing(ch, chunk) {
  const buf = rb.data[ch]
  const N = buf.length
  let wp = rb.writePos[ch]
  let i = 0
  const L = chunk.length
  while (i < L) {
    const spaceToEnd = N - wp
    const toCopy = Math.min(spaceToEnd, L - i)
    buf.set(chunk.subarray(i, i + toCopy), wp)
    wp = (wp + toCopy) % N
    i += toCopy
  }
  rb.writePos[ch] = wp
  rb.filled[ch] = Math.min(N, rb.filled[ch] + L)
}

function readRing(ch) {
  const buf = rb.data[ch]
  const filled = rb.filled[ch]
  const N = buf.length
  if (!filled) return new Float32Array(0)
  const out = new Float32Array(filled)
  const start = (rb.writePos[ch] - filled + N) % N
  const firstLen = Math.min(N - start, filled)
  out.set(buf.subarray(start, start + firstLen), 0)
  if (firstLen < filled) {
    out.set(buf.subarray(0, filled - firstLen), firstLen)
  }
  return out
}

// ---- public API ----
export async function setupBuffering(audioCtx, source, chCount, seconds = 120) {
  // Prepare ring buffers
  initRing(audioCtx.sampleRate, chCount, seconds)

  // AudioWorklet node that feeds us Float32 frames
  try {
    await audioCtx.audioWorklet.addModule('/src/lib/recorder-worklet.js')
    node = new AudioWorkletNode(audioCtx, 'multichannel-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: chCount,
      processorOptions: { maxChannels: chCount },
    })
    source.connect(node)
    node.port.onmessage = (e) => {
      const { type, buffers } = e.data || {}
      if (type !== 'chunk' || !buffers) return
      for (let i = 0; i < chCount; i++) writeToRing(i, buffers[i] || new Float32Array(0))
    }
    return true
  } catch (e) {
    console.warn('AudioWorklet unavailable:', e)
    node = null
    return false
  }
}

export function getBuffered(channelIndex = 0) {
  return readRing(channelIndex)
}

export function saveAllBuffered(sampleRateOverride) {
  const sr = (sampleRateOverride | 0) || rb.sampleRate
  for (let i = 0; i < rb.chCount; i++) {
    const data = readRing(i)
    if (!data.length) continue
    const wav = encodeWavPCM16(data, sr)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(wav)
    a.download = `last_${rb.seconds}s_ch${i + 1}_${sr}Hz.wav`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
}
