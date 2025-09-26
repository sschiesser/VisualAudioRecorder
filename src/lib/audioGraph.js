export async function ensureStream(selectedId, desiredChannels=2){
  const base={echoCancellation:false,noiseSuppression:false,autoGainControl:false}
  const constraints={audio:{...base,channelCount:{ideal:desiredChannels},deviceId:selectedId&& !['default','communications'].includes(selectedId)?{exact:selectedId}:undefined}}
  try{return await navigator.mediaDevices.getUserMedia(constraints)}catch{delete constraints.audio.deviceId;return await navigator.mediaDevices.getUserMedia(constraints)}
}
export function createContext(){return new (window.AudioContext||window.webkitAudioContext)()}
export function buildGraph(audioCtx,stream){const source=audioCtx.createMediaStreamSource(stream);const splitter=audioCtx.createChannelSplitter(4);source.connect(splitter);return{source,splitter}}
