import { state } from './state.js'

export async function ensureStream(selectedId, desiredChannels=2) {
  const base = { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
  const constraints = {
    audio: {
      ...base,
      channelCount: { ideal: desiredChannels },
      deviceId: selectedId && !['default','communications'].includes(selectedId) ? { exact: selectedId } : undefined,
    }
  }
  try {
    return await navigator.mediaDevices.getUserMedia(constraints)
  } catch {
    delete constraints.audio.deviceId
    return await navigator.mediaDevices.getUserMedia(constraints)
  }
}

export function createContext() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  return ctx
}

export function buildGraph(audioCtx, stream) {
  const source = audioCtx.createMediaStreamSource(stream)
  const splitter = audioCtx.createChannelSplitter(4)
  source.connect(splitter)
  return { source, splitter }
}

export function createAnalyzers(audioCtx, splitter, fft, chCount) {
  const analyzers = new Array(chCount)
  for (let i=0;i<chCount;i++){
    const an = audioCtx.createAnalyser()
    an.fftSize = fft
    an.smoothingTimeConstant = 0.8
    splitter.connect(an, i, 0)
    analyzers[i] = an
  }
  return analyzers
}
