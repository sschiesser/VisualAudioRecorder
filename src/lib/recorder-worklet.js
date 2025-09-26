/*
 * Copyright (C) 2025 sschiesser
 * SPDX-License-Identifier: GPL-3.0-only
 */
class MultichannelRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.maxChannels = (options?.processorOptions?.maxChannels) || 2
    this.port.start()
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0] || []
    const chCount = Math.min(this.maxChannels, input.length)
    if (chCount === 0) return true
    const buffers = []
    for (let ch=0; ch<chCount; ch++) {
      buffers.push(new Float32Array(input[ch]))
    }
    this.port.postMessage({ type: 'chunk', buffers })
    return true
  }
}
registerProcessor('multichannel-recorder', MultichannelRecorder)
