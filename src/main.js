import WaveSurfer from 'wavesurfer.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'

const els = {
  toggle: document.getElementById('toggle'),
  rec: document.getElementById('rec'),
  save: document.getElementById('save'),
  deviceSelect: document.getElementById('deviceSelect'),
  channels: document.getElementById('channels'),
  fft: document.getElementById('fft'),
  info: document.getElementById('info'),
  specHolders: Array.from(document.querySelectorAll('#spectrograms .spec')),
}

let ws, record
let stream, audioCtx, rafIds = []
let analyzers = [], canvases = [], ctxs = [], levelEls = []
let splitter, workletNode
let micRendererCleanup
let currentDeviceId = ''
let desiredChannels = 2
let state = 'stopped' // 'stopped' | 'playing' | 'paused'
let recording = false
let recordedChunks = [[],[],[],[]]

function setInfo(t){ els.info.textContent = t }
function setButton(label){ els.toggle.textContent = label }
function enableRec(enabled){ els.rec.disabled = !enabled; els.save.disabled = !enabled && !recording }

async function listDevices(preserveSelected = true) {
  const devices = await RecordPlugin.getAvailableAudioDevices()
  const prev = preserveSelected ? (els.deviceSelect.value || currentDeviceId) : ''
  // Put 'default' and 'communications' last
  const score = (d) => (d.deviceId === 'default' || d.deviceId === 'communications') ? 1 : 0
  devices.sort((a,b) => score(a) - score(b))

  // IMPORTANT: No escaping in template literals so values interpolate
  els.deviceSelect.innerHTML = devices
    .map((d) => `<option value="${d.deviceId}">${d.label || (d.deviceId === 'default' ? 'Default' : d.deviceId)}</option>`)
    .join('')

  if (prev && [...els.deviceSelect.options].some(o => o.value === prev)) {
    els.deviceSelect.value = prev; currentDeviceId = prev
  } else {
    currentDeviceId = els.deviceSelect.value
  }
}

function setupWaveSurfer(){
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

function setupSpectrogramGrid(chCount){
  canvases = []; ctxs = []; levelEls = []
  els.specHolders.forEach((holder, i) => {
    const canvas = holder.querySelector('canvas')
    const label = holder.querySelector('span')
    const lvl = holder.querySelector('.lvl')
    holder.style.display = (i < chCount) ? 'block' : 'none'
    if (i < chCount) {
      // Ensure non-zero size
      const w = holder.clientWidth || 300
      const h = holder.clientHeight || 150
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#0a0f16'
      ctx.fillRect(0, 0, w, h)
      canvases[i] = canvas
      ctxs[i] = ctx
      levelEls[i] = lvl
      label.textContent = `CH ${i+1}`
    }
  })
  // Resize observer to keep drawings
  const ro = new ResizeObserver(() => {
    els.specHolders.forEach((holder, i) => {
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
  els.specHolders.forEach((h,i)=> i<chCount && ro.observe(h))
}

function hueHeat(val) {
  const hue = 260 * (1 - val / 255)
  return `hsl(${hue}, 100%, ${15 + 45 * (val / 255)}%)`
}

function startAnalyzers(fft, chCount){
  analyzers = new Array(chCount)
  const datas = []
  rafIds.forEach(id => cancelAnimationFrame(id))
  rafIds = []

  for (let i=0; i<chCount; i++){
    const an = audioCtx.createAnalyser()
    an.fftSize = fft
    an.smoothingTimeConstant = 0.8
    splitter.connect(an, i, 0)
    analyzers[i] = an
    datas[i] = new Uint8Array(an.frequencyBinCount)
  }

  for (let i=0;i<chCount;i++){
    const ctx = ctxs[i], canvas = canvases[i]
    const data = datas[i], an = analyzers[i]
    const w = canvas.width, h = canvas.height
    const lvl = levelEls[i]
    const timeBuf = new Uint8Array(1024) // for simple level meter

    const draw = () => {
      // Always schedule the next frame so loops survive transient states
      rafIds[i] = requestAnimationFrame(draw)

      if (state !== 'playing') return

      // Frequency domain for spectrogram
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

      // Simple per-channel level (RMS-ish)
      an.getByteTimeDomainData(timeBuf)
      let acc = 0
      for (let k=0;k<timeBuf.length;k++){
        const s = (timeBuf[k] - 128) / 128
        acc += s*s
      }
      const rms = Math.sqrt(acc / timeBuf.length)
      const pct = Math.max(0, Math.min(1, rms * 3)) * 100
      if (lvl) lvl.style.setProperty('--w', pct + '%')
      if (lvl) lvl.style.setProperty('background', '#071019')
      if (lvl) lvl.style.setProperty('border', '1px solid #132030')
      if (lvl) lvl.style.setProperty('borderRadius', '999px')
      if (lvl) lvl.style.setProperty('overflow', 'hidden')
      if (lvl) lvl.style.setProperty('position', 'absolute')
      if (lvl) lvl.style.setProperty('right', '8px')
      if (lvl) lvl.style.setProperty('top', '8px')
      lvl.style.setProperty('--w', pct + '%')
      lvl.style.setProperty('display', 'block')
      // fill width via ::after not accessible here; emulate:
      lvl.style.background = `linear-gradient(to right, #36d67e ${pct}%, transparent ${pct}%)`
    }
    draw()
  }
}

async function ensureStream() {
  if (stream) return
  const constraints = {
    audio: {
      channelCount: { ideal: desiredChannels },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: currentDeviceId && currentDeviceId !== 'default' && currentDeviceId !== 'communications' ? { exact: currentDeviceId } : undefined,
    }
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch (eExact) {
    delete constraints.audio.deviceId
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  }
}

async function play(){
  await listDevices(true).catch(()=>{})
  desiredChannels = parseInt(els.channels.value,10) || 2
  await ensureStream()

  if (audioCtx) { try { audioCtx.close() } catch {} }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  // ensure running (some browsers start suspended until a gesture)
  if (audioCtx.state === 'suspended') { try { await audioCtx.resume() } catch {} }

  const source = audioCtx.createMediaStreamSource(stream)
  splitter = audioCtx.createChannelSplitter(4)
  source.connect(splitter)

  setupWaveSurfer()
  const { onDestroy } = record.renderMicStream(stream)
  micRendererCleanup = onDestroy

  const actual = source.channelCount || desiredChannels
  const chCount = Math.min(4, Math.max(1, Math.min(actual, desiredChannels)))
  setupSpectrogramGrid(chCount)

  // Set playing BEFORE starting analyzer loops
  state = 'playing'
  setButton('Pause')
  startAnalyzers(parseInt(els.fft.value,10)||1024, chCount)

  setInfo(`${stream.getAudioTracks()[0]?.label || 'Mic'} • ${chCount} ch @ ${audioCtx.sampleRate|0} Hz`)

  // Try again to populate device labels now that permission was granted
  listDevices(true).catch(()=>{})
}

function pause(){
  state = 'paused'
  if (micRendererCleanup) { try { micRendererCleanup() } catch {} micRendererCleanup = null }
  if (audioCtx) { try { audioCtx.suspend() } catch {} }
  setButton('Play')
  setInfo('Paused')
}

function resume(){
  if (audioCtx?.state === 'suspended') { audioCtx.resume().catch(()=>{}) }
  const { onDestroy } = record.renderMicStream(stream)
  micRendererCleanup = onDestroy
  state = 'playing'
  setButton('Pause')
}

function stopAll(){
  rafIds.forEach(id => cancelAnimationFrame(id)); rafIds = []
  if (micRendererCleanup) { try { micRendererCleanup() } catch {} micRendererCleanup = null }
  if (audioCtx) { try { audioCtx.close() } catch {} }
  if (stream) { try { stream.getTracks().forEach(t=>t.stop()) } catch {} stream = null
  analyzers = []; canvases = []; ctxs = []; splitter = null; workletNode = null
}}

function flattenChunks(chunks) {
  const total = chunks.reduce((n, a) => n + a.length, 0)
  const out = new Float32Array(total)
  let o = 0
  for (const a of chunks) { out.set(a, o); o += a.length }
  return out
}

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

function encodeWavPCM16(float32, sampleRate) {
  const pcm16 = floatTo16BitPCM(float32)
  const numChannels = 1
  const blockAlign = numChannels * 2
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm16.byteLength
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(off, str) { for (let i=0;i<str.length;i++) view.setUint8(off+i, str.charCodeAt(i)) }
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

function downloadBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// UI
els.toggle.addEventListener('click', async () => {
  if (state === 'stopped') { await play() }
  else if (state === 'playing') { pause() }
  else if (state === 'paused') { resume() }
})

els.rec.addEventListener('click', () => {
  if (!workletNode) return
  recording = !recording
  els.rec.textContent = recording ? '■ Stop Rec' : '● Rec'
  els.rec.classList.toggle('armed', recording)
  els.save.disabled = !recording && recordedChunks.every(ch => ch.length === 0)
  if (!recording) { setInfo('Recording stopped. Ready to save.') }
  else { recordedChunks = [[],[],[],[]]; setInfo('Recording…') }
})

els.save.addEventListener('click', () => {
  if (!recordedChunks.some(ch => ch.length)) return
  const sr = audioCtx?.sampleRate || 48000
  analyzers.forEach((_, i) => {
    const flat = recordedChunks[i].reduce((acc, cur) => {
      const merged = new Float32Array(acc.length + cur.length)
      merged.set(acc, 0); merged.set(cur, acc.length)
      return merged
    }, new Float32Array(0))
    if (flat.length) {
      const wav = encodeWavPCM16(flat, sr)
      downloadBlob(wav, `mic_ch${i+1}_${sr}Hz.wav`)
    }
  })
  recordedChunks = [[],[],[],[]]
  els.save.disabled = true
  setInfo('Saved.')
})

els.deviceSelect.addEventListener('change', async (e) => {
  currentDeviceId = e.target.value
  if (state === 'stopped') return
  pause()
  stopAll()
  await play()
})

els.channels.addEventListener('change', async (e) => {
  desiredChannels = parseInt(e.target.value,10)||2
  if (state === 'playing') {
    pause()
    stopAll()
    await play()
  }
})

els.fft.addEventListener('change', () => {
  if (state === 'playing') {
    startAnalyzers(parseInt(els.fft.value,10)||1024, analyzers.length)
  }
})

// Initial device list (labels may be empty until permission; we repopulate after Play)
listDevices(false).catch(()=>{})

window.addEventListener('beforeunload', () => {
  rafIds.forEach(id => cancelAnimationFrame(id))
  if (micRendererCleanup) { try { micRendererCleanup() } catch {} }
  if (audioCtx) { try { audioCtx.close() } catch {} }
  if (stream) { try { stream.getTracks().forEach(t=>t.stop()) } catch {} }
})
