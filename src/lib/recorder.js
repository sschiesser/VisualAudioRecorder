import { encodeWavPCM16 } from './utils/wav.js'

// optional constant for tiny device-specific calibration (+samples added to selection length)
const FUDGE_SAMPLES = 0

let node=null
let rb={seconds:120,sampleRate:48000,chCount:0,cap:0,data:[],writePos:[],filled:[],written:[]}
let recEnabled=[] // per-channel record gate

const frameListeners=new Set()
export function onAudioFrames(cb){frameListeners.add(cb);return()=>frameListeners.delete(cb)}
function notifyFrames(frames){const payload={frames,sampleRate:rb.sampleRate,chCount:rb.chCount};frameListeners.forEach(fn=>{try{fn(payload)}catch{}})}

function initRing(sampleRate,chCount,seconds=120){
  rb.seconds=seconds|0;rb.sampleRate=sampleRate|0;rb.chCount=chCount|0;rb.cap=(rb.sampleRate*rb.seconds)|0
  rb.data=Array.from({length:chCount},()=>new Float32Array(rb.cap))
  rb.writePos=Array.from({length:chCount},()=>0)
  rb.filled=Array.from({length:chCount},()=>0)
  rb.written=Array.from({length:chCount},()=>0)
  recEnabled=Array.from({length:chCount},()=>true)
}

function writeToRing(ch,chunk){
  if(!recEnabled[ch]) return
  const buf=rb.data[ch];const N=buf.length;let wp=rb.writePos[ch];let i=0;const L=chunk.length
  while(i<L){const toEnd=N-wp;const n=Math.min(toEnd,L-i);buf.set(chunk.subarray(i,i+n),wp);wp=(wp+n)%N;i+=n}
  rb.writePos[ch]=wp;rb.filled[ch]=Math.min(N,rb.filled[ch]+L);rb.written[ch]+=L
}

function readRangeFrames(ch,startFromOldest,frames){
  const N=rb.data[ch].length;const filled=rb.filled[ch]
  if(!filled||frames<=0)return new Float32Array(0)
  const start=Math.max(0,Math.min(filled,startFromOldest|0))
  const n=Math.max(0,Math.min(frames|0,filled-start))
  const out=new Float32Array(n);const oldest=(rb.writePos[ch]-filled+N)%N
  let idx=(oldest+start)%N;const first=Math.min(N-idx,n)
  out.set(rb.data[ch].subarray(idx,idx+first),0);if(first<n)out.set(rb.data[ch].subarray(0,n-first),first)
  return out
}

export async function setupBuffering(audioCtx,inputNode,chCount,seconds=120){
  initRing(audioCtx.sampleRate,chCount,seconds)
  try{
    await audioCtx.audioWorklet.addModule('/src/lib/recorder-worklet.js')
    node=new AudioWorkletNode(audioCtx,'multichannel-recorder',{numberOfInputs:1,numberOfOutputs:0,channelCount:chCount,processorOptions:{maxChannels:chCount}})
    inputNode.connect(node)
    node.port.onmessage=(e)=>{
      const {type,buffers}=e.data||{};if(type!=='chunk'||!buffers)return
      const frames=buffers[0]?.length|0
      for(let i=0;i<chCount;i++)writeToRing(i,buffers[i]||new Float32Array(0))
      if(frames)notifyFrames(frames)
    }
    return true
  }catch(e){console.warn('AudioWorklet unavailable:',e);node=null;return false}
}

export function setBufferSeconds(seconds){initRing(rb.sampleRate,rb.chCount,seconds|0)}

export function getWindowSnapshot(windowSeconds){
  const sr=rb.sampleRate|0;const W=Math.min(rb.seconds,windowSeconds|0)*sr|0
  const snap={sampleRate:sr,windowSeconds:windowSeconds|0,chCount:rb.chCount,perCh:[]}
  for(let ch=0;ch<rb.chCount;ch++){const filled=rb.filled[ch]|0;const usable=Math.min(W,filled);const startFromOldest=(filled-usable);snap.perCh[ch]={filled,written:rb.written[ch]|0,usable,startFromOldest}}
  return snap
}

export function extractWithSnapshot(ch,startFrac,endFrac,snap){
  const sr=snap.sampleRate|0;const p=snap.perCh[ch];if(!p)return{data:new Float32Array(0),sampleRate:sr}
  // clamp/order
  let a=Math.max(0,Math.min(1,Number(startFrac)||0)),b=Math.max(0,Math.min(1,Number(endFrac)||0));if(b<a)[a,b]=[b,a]
  const usable=p.usable|0;if(usable<=0)return{data:new Float32Array(0),sampleRate:sr}
  // remap selection from full window -> usable right-aligned region
  const windowFrames=(snap.windowSeconds|0)*sr;const r=Math.min(1,usable/Math.max(1,windowFrames));const leftPadFrac=1-r;const scale=r>0?(1/r):1
  const a2=Math.max(0,Math.min(1,(a-leftPadFrac)*scale)),b2=Math.max(0,Math.min(1,(b-leftPadFrac)*scale))
  const startFrames=Math.max(0,Math.min(usable,Math.round(a2*usable))),endFrames=Math.max(0,Math.min(usable,Math.round(b2*usable)))
  let frames=Math.max(0,endFrames-startFrames+FUDGE_SAMPLES);if(frames<=0)return{data:new Float32Array(0),sampleRate:sr}
  const data=readRangeFrames(ch,p.startFromOldest+startFrames,frames);return{data,sampleRate:sr}
}

export function saveAllBuffered(sampleRateOverride){
  const sr=(sampleRateOverride|0)||rb.sampleRate
  for(let i=0;i<rb.chCount;i++){const filled=rb.filled[i];const frames=Math.min(filled,rb.cap);const start=Math.max(0,filled-frames);const data=readRangeFrames(i,start,frames);if(!data.length)continue
    const wav=encodeWavPCM16(data,sr);const a=document.createElement('a');a.href=URL.createObjectURL(wav);a.download=`last_${rb.seconds}s_ch${i+1}_${sr}Hz.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
}

export function setChannelRecording(ch,enabled){ if(ch<0||ch>=rb.chCount)return; recEnabled[ch]=!!enabled }
export function getChannelRecording(ch){ return !!recEnabled[ch] }
export function resetChannelBuffer(ch){ if(ch<0||ch>=rb.chCount)return; rb.writePos[ch]=0; rb.filled[ch]=0 }
