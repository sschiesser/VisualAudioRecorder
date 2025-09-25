import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'

const els = {
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  deviceSelect: document.getElementById('deviceSelect'),
  fft: document.getElementById('fft'),
  info: document.getElementById('info'),
}

let ws, record
let stream, audioCtx, analyser, rafId
let specCanvas, specCtx
let micRendererCleanup
let currentDeviceId = ''

function setInfo(text) {
  els.info.textContent = text
}

function enableStop(enabled) {
  els.stop.disabled = !enabled
}

async function listDevices(preserveSelected = true) {
  const prev = preserveSelected ? (els.deviceSelect.value || currentDeviceId) : ''
  const devices = await RecordPlugin.getAvailableAudioDevices()

  const score = (d) => (d.deviceId === 'default' || d.deviceId === 'communications') ? 1 : 0
  devices.sort((a,b) => score(a) - score(b))

  els.deviceSelect.innerHTML = devices
    .map((d) => `<option value="${d.deviceId}">${d.label || (d.deviceId === 'default' ? 'Default' : d.deviceId)}</option>`)
    .join('')

  if (prev && [...els.deviceSelect.options].some(o => o.value === prev)) {
    els.deviceSelect.value = prev
    currentDeviceId = prev
  } else {
    currentDeviceId = els.deviceSelect.value
  }
}

function createWaveSurfer() {
  if (ws) try { ws.destroy() } catch {}
  ws = WaveSurfer.create({
    container: '#waveform',
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

function initSpectrogramCanvas() {
  const container = document.getElementById('spectrogram')
  container.innerHTML = ''
  specCanvas = document.createElement('canvas')
  specCanvas.id = 'specCanvas'
  specCanvas.width = container.clientWidth
  specCanvas.height = container.clientHeight
  container.appendChild(specCanvas)
  specCtx = specCanvas.getContext('2d')
  specCtx.fillStyle = '#0a0f16'
  specCtx.fillRect(0, 0, specCanvas.width, specCanvas.height)
}

function hueHeat(val) {
  const hue = 260 * (1 - val / 255)
  return `hsl(${hue}, 100%, ${15 + 45 * (val / 255)}%)`
}

function startSpectrogram(fft) {
  const w = specCanvas.width
  const h = specCanvas.height
  if (audioCtx) try { audioCtx.close() } catch {}
  audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  const source = audioCtx.createMediaStreamSource(stream)
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = fft
  analyser.smoothingTimeConstant = 0.8
  source.connect(analyser)
  const bins = analyser.frequencyBinCount
  const data = new Uint8Array(bins)

  function draw() {
    rafId = requestAnimationFrame(draw)
    analyser.getByteFrequencyData(data)
    const imageData = specCtx.getImageData(1, 0, w - 1, h)
    specCtx.putImageData(imageData, 0, 0)
    const x = w - 1
    for (let y = 0; y < h; y++) {
      const bin = Math.floor((y / h) * bins)
      const v = data[bin]
      specCtx.fillStyle = hueHeat(v)
      specCtx.fillRect(x, h - 1 - y, 1, 1)
    }
  }
  draw()
}

async function getMicStream(selectedId) {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  if (selectedId && selectedId !== 'default' && selectedId !== 'communications') {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: selectedId } } })
    } catch {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: selectedId } })
      } catch {}
    }
  }
  return await navigator.mediaDevices.getUserMedia({ audio: base })
}

async function start() {
  els.start.disabled = true
  setInfo('Requesting microphone…')

  await listDevices(true).catch(() => {})

  const selectedId = els.deviceSelect.value || currentDeviceId
  currentDeviceId = selectedId

  createWaveSurfer()
  initSpectrogramCanvas()

  stream = await getMicStream(selectedId)

  const { onDestroy } = record.renderMicStream(stream)
  micRendererCleanup = onDestroy

  enableStop(true)
  setInfo(stream.getAudioTracks()[0]?.label || 'Microphone ready')

  startSpectrogram(parseInt(els.fft.value, 10) || 1024)
}

function stop() {
  enableStop(false)
  els.start.disabled = false
  setInfo('—')

  if (rafId) cancelAnimationFrame(rafId), rafId = null
  if (micRendererCleanup) { try { micRendererCleanup() } catch {} micRendererCleanup = null }
  if (stream) { try { stream.getTracks().forEach(t => t.stop()) } catch {} stream = null }
  if (ws) try { ws.destroy() } catch {}
  if (audioCtx) try { audioCtx.close() } catch {}
}

els.start.addEventListener('click', start)
els.stop.addEventListener('click', stop)

els.deviceSelect.addEventListener('change', async (e) => {
  currentDeviceId = e.target.value
  if (stream) { stop(); start(); }
})

els.fft.addEventListener('change', () => {
  if (stream && specCanvas) startSpectrogram(parseInt(els.fft.value, 10) || 1024)
})

listDevices(false).catch(() => {})