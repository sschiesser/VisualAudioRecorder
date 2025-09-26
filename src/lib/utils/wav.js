/*
 * Copyright (C) 2025 sschiesser
 * SPDX-License-Identifier: GPL-3.0-only
 */
function floatTo16BitPCM(float32) {
  const buffer = new ArrayBuffer(float32.length * 2)
  const view = new DataView(buffer)
  let offset = 0
  for (let i=0;i<float32.length;i++){
    let s = Math.max(-1, Math.min(1, float32[i]))
    s = s < 0 ? s * 0x8000 : s * 0x7FFF
    view.setInt16(offset, s, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

export function encodeWavPCM16(float32, sampleRate) {
  const pcm16 = floatTo16BitPCM(float32)
  const numChannels = 1
  const blockAlign = numChannels * 2
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm16.byteLength
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (off, str) => { for (let i=0;i<str.length;i++) view.setUint8(off+i, str.charCodeAt(i)) }
  let offset = 0
  writeString(offset, 'RIFF'); offset += 4
  view.setUint32(offset, 36 + dataSize, true); offset += 4
  writeString(offset, 'WAVE'); offset += 4
  writeString(offset, 'fmt '); offset += 4
  view.setUint32(offset, 16, true); offset += 4
  view.setUint16(offset, 1, true); offset += 2
  view.setUint16(offset, numChannels, true); offset += 2
  view.setUint32(offset, sampleRate, true); offset += 4
  view.setUint32(offset, byteRate, true); offset += 4
  view.setUint16(offset, blockAlign, true); offset += 2
  view.setUint16(offset, 16, true); offset += 2
  writeString(offset, 'data'); offset += 4
  view.setUint32(offset, dataSize, true); offset += 4
  new Uint8Array(buffer, 44).set(pcm16)
  return new Blob([buffer], { type: 'audio/wav' })
}
