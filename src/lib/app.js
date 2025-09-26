import { state, setMode } from './state.js'
import { listDevices } from './deviceManager.js'
import { ensureStream, createContext, buildGraph } from './audioGraph.js'
import * as Spectro from './spectrogramGrid.js'
import * as Rec from './recorder.js'

export function initApp(){
  const els={
    toggle:document.getElementById('toggle'),
    save:document.getElementById('save'),
    deviceSelect:document.getElementById('deviceSelect'),
    channels:document.getElementById('channels'),
    fft:document.getElementById('fft'),
    bufferSec:document.getElementById('bufferSec'),
    info:document.getElementById('info'),
  }

  let stream=null,audioCtx=null,splitter=null,analyzers=[],gains=[],merger=null
  let previewCtx=null,previewSrc=null,snapshot=null

  const setInfo=(t)=>els.info.textContent=t
  const setButton=(t)=>els.toggle.textContent=t
  const dbToLinear=(db)=>Math.pow(10,db/20)

  const initialCh=Math.min(4,parseInt(els.channels.value,10)||2)
  Spectro.setupGrid('#spectrograms',initialCh)
  Spectro.setWindowSeconds(parseInt(els.bufferSec.value,10)||120)
  listDevices(els.deviceSelect,'').catch(()=>{})

  Spectro.bindSelectionHandlers({
    play:(ch,f0,f1,winSec)=>previewSelection(ch,f0,f1,winSec),
    save:(ch,f0,f1,winSec)=>saveSelection(ch,f0,f1,winSec),
  })
  Spectro.bindRecordToggles((ch,on)=>{ if(on){ Rec.resetChannelBuffer(ch) } Rec.setChannelRecording(ch,on) })

  function stopPreview(){try{previewSrc?.stop()}catch{};try{previewCtx?.close()}catch{};previewSrc=null;previewCtx=null}

  async function previewSelection(ch,f0,f1,winSec){
    if(!snapshot){setInfo('Pause first to monitor a selection.');return}
    stopPreview()
    const {data,sampleRate}=Rec.extractWithSnapshot(ch,f0,f1,snapshot)
    if(!data.length){setInfo('No audio in selection.');return}
    previewCtx=new (window.AudioContext||window.webkitAudioContext)()
    const buf=previewCtx.createBuffer(1,data.length,sampleRate);buf.copyToChannel(data,0,0)
    previewSrc=previewCtx.createBufferSource();previewSrc.buffer=buf;previewSrc.loop=Spectro.isLoopEnabled(ch);previewSrc.connect(previewCtx.destination)
    if(previewCtx.state==='suspended'){try{await previewCtx.resume()}catch{}}
    previewSrc.onended=()=>stopPreview();previewSrc.start()
    setInfo(`Monitoring selection ${previewSrc.loop?'(loop)': ''}: ch${ch+1}, ${(data.length/sampleRate).toFixed(2)}s`)
  }

  function saveSelection(ch,f0,f1,winSec){
    if(!snapshot){setInfo('Pause first to save a selection.');return}
    const {data,sampleRate}=Rec.extractWithSnapshot(ch,f0,f1,snapshot)
    if(!data.length){setInfo('No audio in selection.');return}
    import('./utils/wav.js').then(({encodeWavPCM16})=>{
      const blob=encodeWavPCM16(data,sampleRate);const a=document.createElement('a')
      a.href=URL.createObjectURL(blob);a.download=`selection_ch${ch+1}_${(data.length/sampleRate).toFixed(2)}s_${sampleRate}Hz.wav`
      a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);setInfo('Selection saved.')
    })
  }

  async function play(){
    const deviceId=els.deviceSelect.value
    const chCount=Math.min(4,parseInt(els.channels.value,10)||2)
    const bufferSec=parseInt(els.bufferSec.value,10)||120
    Spectro.setWindowSeconds(bufferSec)

    stream=stream||(await ensureStream(deviceId,chCount))
    if(audioCtx){try{audioCtx.close()}catch{}}
    audioCtx=createContext();if(audioCtx.state==='suspended'){try{await audioCtx.resume()}catch{}}

    const { splitter:sp }=buildGraph(audioCtx,stream);splitter=sp
    Spectro.setupGrid('#spectrograms',chCount)
    Spectro.bindAudioClock(Rec.onAudioFrames,audioCtx.sampleRate)

    const recStates = Spectro.getRecStates()

    gains=Array.from({length:chCount},()=>{const g=audioCtx.createGain();g.gain.value=1;return g})
    analyzers=Array.from({length:chCount},()=>{const a=audioCtx.createAnalyser();a.fftSize=parseInt(els.fft.value,10)||1024;a.smoothingTimeConstant=0.8;return a})
    for(let i=0;i<chCount;i++){splitter.connect(gains[i],i,0);gains[i].connect(analyzers[i])}
    merger=audioCtx.createChannelMerger(chCount);for(let i=0;i<chCount;i++){gains[i].connect(merger,0,i)}

    const setters=gains.map(g=>db=>{g.gain.value=dbToLinear(db)});Spectro.bindGains(setters)
    setMode('playing');setButton('Pause');requestAnimationFrame(()=>{Spectro.start(analyzers)})
    const ok=await Rec.setupBuffering(audioCtx,merger,chCount,bufferSec);
    // re-apply per-channel REC states
    recStates.forEach((on,i)=>{ Rec.setChannelRecording(i, !!on) })
    els.save.disabled=!ok
    setInfo(`${stream.getAudioTracks?.[0]?.label||'Mic'} • buffering ${bufferSec}s • ${chCount} ch @ ${audioCtx.sampleRate|0} Hz`)
  }

  function pause(){
    setMode('paused');if(audioCtx){try{audioCtx.suspend()}catch{}}
    setButton('Play');setInfo('Paused: zoom/pan/select available.');Spectro.enterInspectMode();stopPreview()
    const bufSec=parseInt(els.bufferSec.value,10)||120;snapshot=Rec.getWindowSnapshot(bufSec);Spectro.setPauseSnapshotMeta(snapshot)
  }

  async function resume(){
    stopPreview();if(audioCtx?.state==='suspended'){await audioCtx.resume().catch(()=>{})}
    setMode('playing');setButton('Pause');setInfo('Buffering + visuals resumed');Spectro.exitInspectMode();snapshot=null
  }

  function stopAll(){
    Spectro.stop();stopPreview();if(audioCtx){try{audioCtx.close()}catch{};audioCtx=null}
    if(stream){try{stream.getTracks().forEach(t=>t.stop())}catch{};stream=null}
  }

  els.toggle.addEventListener('click',async()=>{
    if(state.mode==='stopped')await play()
    else if(state.mode==='playing')pause()
    else await resume()
  })
  els.save.addEventListener('click',()=>{Rec.saveAllBuffered(audioCtx?.sampleRate||48000);setInfo('Saved last buffer for all channels.')})
  els.deviceSelect.addEventListener('change',async()=>{if(state.mode==='stopped')return;pause();stopAll();await play()})
  els.channels.addEventListener('change',async()=>{if(state.mode==='playing'){pause();stopAll();await play()}else{Spectro.setupGrid('#spectrograms',Math.min(4,parseInt(els.channels.value,10)||2))}})
  els.fft.addEventListener('change',()=>{if(state.mode==='playing'){analyzers.forEach(an=>{an.fftSize=parseInt(els.fft.value,10)||1024});Spectro.start(analyzers)}})
  els.bufferSec.addEventListener('change',()=>{const buf=parseInt(els.bufferSec.value,10)||120;Spectro.setWindowSeconds(buf);if(state.mode==='playing'){Rec.setBufferSeconds(buf);setInfo(`Buffer length set to ${buf}s`)}})
  window.addEventListener('beforeunload',()=>stopAll())
}
