import { hueHeat } from './utils/color.js'
import { isPlaying } from './state.js'

let windowSeconds = 120
const WAVE_RATIO = 0.25

let canvases=[],ctxs=[],meters=[],ro=null,loops=[]
let freqData=[],timeData=[]
let lastW=[],lastH=[]
let gainEls=[],gainLbls=[]

let sampleRate=48000
let pxPerFrame=[],frameAcc=[],unsubClock=null

let inspect=false,frozen=[],zoom=[],viewStart=[],selection=[],handlers={play:null,save:null}
let snapMeta = null

export function setWindowSeconds(sec){
  const s=Math.max(1,parseInt(sec)||120);windowSeconds=s
  frameAcc=canvases.map(()=>0)
}

export function bindAudioClock(onFrames,sr){
  if(unsubClock){try{unsubClock()}catch{};unsubClock=null}
  sampleRate=sr||48000
  pxPerFrame=canvases.map(c=>((c?.width||300)/(windowSeconds*sampleRate)))
  frameAcc=canvases.map(()=>0)
  unsubClock=onFrames(({frames})=>{for(let i=0;i<frameAcc.length;i++)frameAcc[i]+=frames})
}

export function setupGrid(containerSelector='#spectrograms',chCount=2){
  const holders=Array.from(document.querySelectorAll(containerSelector+' .spec'))
  canvases=[];ctxs=[];meters=[];gainEls=[];gainLbls=[]
  holders.forEach((holder,i)=>{
    const canvas=holder.querySelector('canvas');const label=holder.querySelector('span');const lvl=holder.querySelector('.lvl')
    let slider=holder.querySelector('input.gainSlider')
    if(!slider){slider=document.createElement('input');slider.type='range';slider.className='gainSlider';slider.min='-24';slider.max='24';slider.step='0.5';slider.value='0';Object.assign(slider.style,{position:'absolute',right:'8px',top:'28px',width:'140px',background:'transparent'});holder.appendChild(slider)}
    let gLabel=holder.querySelector('span.gainLabel')
    if(!gLabel){gLabel=document.createElement('span');gLabel.className='gainLabel';gLabel.textContent='0 dB';Object.assign(gLabel.style,{position:'absolute',right:'8px',top:'50px',fontSize:'11px',opacity:'.8'});holder.appendChild(gLabel)}
    let overlay=holder.querySelector('.overlay')
    if(!overlay){overlay=document.createElement('div');overlay.className='overlay';overlay.style.display='none'
      const playBtn=document.createElement('div');playBtn.className='btn';playBtn.textContent='▶ Monitor';playBtn.onclick=()=>{const sel=selection[i];if(!sel||!handlers.play)return;handlers.play(i,sel.x0Frac,sel.x1Frac,windowSeconds)}
      const saveBtn=document.createElement('div');saveBtn.className='btn';saveBtn.textContent='💾 Save WAV';saveBtn.onclick=()=>{const sel=selection[i];if(!sel||!handlers.save)return;handlers.save(i,sel.x0Frac,sel.x1Frac,windowSeconds)}
      const hint=document.createElement('div');hint.className='hint';hint.textContent='Wheel=Zoom, Drag=Select, Alt+Drag=Pan'
      const dur=document.createElement('div');dur.className='dur';dur.style.fontSize='11px';dur.style.opacity='.8';dur.style.marginLeft='6px';overlay.appendChild(playBtn);overlay.appendChild(saveBtn);overlay.appendChild(hint);overlay.appendChild(dur);holder.appendChild(overlay)}
    let selDiv=holder.querySelector('.sel')
    if(!selDiv){selDiv=document.createElement('div');selDiv.className='sel';selDiv.style.display='none';holder.appendChild(selDiv)}
    holder.style.display=(i<chCount)?'block':'none';slider.style.display=(i<chCount)?'block':'none';gLabel.style.display=(i<chCount)?'block':'none'
    if(i<chCount){const w=holder.clientWidth||300;const h=holder.clientHeight||150;canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#0a0f16';ctx.fillRect(0,0,w,h);canvases[i]=canvas;ctxs[i]=ctx;meters[i]=lvl;label.textContent=`CH ${i+1}`}
  })
  freqData=new Array(chCount);timeData=new Array(chCount)
  lastW=new Array(chCount).fill(0);lastH=new Array(chCount).fill(0)
  pxPerFrame=canvases.map(c=>((c?.width||300)/(windowSeconds*sampleRate)))
  frameAcc=new Array(chCount).fill(0)
  zoom=new Array(chCount).fill(1);viewStart=new Array(chCount).fill(0);selection=new Array(chCount).fill(null);frozen=new Array(chCount).fill(null)

  if(ro)ro.disconnect()
  ro=new ResizeObserver(()=>{
    canvases.forEach((canvas,i)=>{
      if(!canvas)return
      const holder=canvas.parentElement;const ctx=ctxs[i];const old=ctx.getImageData(0,0,canvas.width,canvas.height)
      const w=holder.clientWidth||300;const h=holder.clientHeight||150;canvas.width=w;canvas.height=h
      ctx.putImageData(old,Math.max(0,w-old.width),Math.max(0,h-old.height))
      pxPerFrame[i]=w/(windowSeconds*sampleRate);lastW[i]=w;lastH[i]=h
    })
  })
  canvases.forEach(c=>c&&ro.observe(c.parentElement))
  attachInteractions(chCount)
}

function attachInteractions(chCount){
  canvases.forEach((canvas,i)=>{
    if(!canvas)return
    const holder=canvas.parentElement,overlay=holder.querySelector('.overlay'),selDiv=holder.querySelector('.sel')
    let dragging=false,panning=false,selStartX=0
    const renderPaused=()=>{
      if(!inspect)return
      const ctx=ctxs[i],w=canvas.width,h=canvas.height
      ctx.fillStyle='#0a0f16';ctx.fillRect(0,0,w,h)
      const src=frozen[i];if(!src)return
      const z=Math.max(1,zoom[i]),span=1/z,sxFrac=Math.max(0,Math.min(1-span,viewStart[i]))
      const sx=Math.floor(sxFrac*src.width),sw=Math.max(1,Math.floor(span*src.width))
      ctx.drawImage(src,sx,0,sw,src.height,0,0,w,h)
      const sel=selection[i]
      if(sel){const left=(sel.x0Frac-sxFrac)/span,right=(sel.x1Frac-sxFrac)/span
        const x=Math.max(0,Math.floor(left*w)),x2=Math.min(w,Math.floor(right*w))
        selDiv.style.display=(x2>x)?'block':'none';selDiv.style.left=x+'px';selDiv.style.top='0px';selDiv.style.width=Math.max(0,x2-x)+'px';selDiv.style.height=h+'px';
        let d= (sel.x1Frac - sel.x0Frac) * windowSeconds;
        if (snapMeta) {
          const sr = snapMeta.sampleRate|0;
          const chMeta = snapMeta.perCh[i];
          if (chMeta) {
            const usable = chMeta.usable|0;
            const Wf = (snapMeta.windowSeconds|0) * sr;
            const r = Math.min(1, usable / Math.max(1, Wf));
            const leftPad = 1 - r;
            const scale = r > 0 ? (1 / r) : 1;
            const a2 = Math.max(0, Math.min(1, (selection[i].x0Frac - leftPad) * scale));
            const b2 = Math.max(0, Math.min(1, (selection[i].x1Frac - leftPad) * scale));
            d = (Math.max(0, b2 - a2)) * (usable / Math.max(1, sr));
          }
        }
        const dTxt=(d>=1?d.toFixed(2):d.toFixed(3))+' s'; const dEl=holder.querySelector('.dur'); if(dEl) dEl.textContent='Sel: '+dTxt
      }else selDiv.style.display='none'
    }
    canvas.addEventListener('wheel',(e)=>{
      if(!inspect)return;e.preventDefault()
      const rect=canvas.getBoundingClientRect(),mx=(e.clientX-rect.left)/rect.width,dir=Math.sign(e.deltaY)
      const zPrev=zoom[i];let z=zPrev*(dir>0?1/1.2:1.2);z=Math.max(1,Math.min(64,z))
      const spanPrev=1/zPrev,spanNew=1/z,vx=viewStart[i],focus=vx+mx*spanPrev
      viewStart[i]=Math.max(0,Math.min(1-spanNew,focus-mx*spanNew));zoom[i]=z;renderPaused()
    },{passive:false})
    canvas.addEventListener('mousedown',(e)=>{
      if(!inspect)return;e.preventDefault()
      if(e.altKey||e.button===1||e.button===2){panning=true}else{
        dragging=true;const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width
        const span=1/Math.max(1,zoom[i]);const xFrac=viewStart[i]+x*span;selStartX=xFrac;selection[i]={x0Frac:xFrac,x1Frac:xFrac}
      }
      renderPaused()
    })
    window.addEventListener('mousemove',(e)=>{
      if(!inspect||( !dragging && !panning))return
      const rect=canvas.getBoundingClientRect()
      if(panning){const dx=e.movementX;const span=1/Math.max(1,zoom[i]);const d=-dx/rect.width*span
        const ns=Math.max(0,Math.min(1-span,viewStart[i]+d));if(ns!==viewStart[i]){viewStart[i]=ns;renderPaused()}
      }else if(dragging){const x=(e.clientX-rect.left)/rect.width;const span=1/Math.max(1,zoom[i]);const xFrac=viewStart[i]+x*span
        const x0=Math.max(0,Math.min(1,Math.min(selStartX,xFrac))),x1=Math.max(0,Math.min(1,Math.max(selStartX,xFrac)))
        selection[i]={x0Frac:x0,x1Frac:x1};renderPaused()}
    })
    window.addEventListener('mouseup',()=>{
      if(!inspect)return
      if(dragging||panning){dragging=false;panning=false;const hasSel=selection[i]&&selection[i].x1Frac>selection[i].x0Frac;overlay.style.display=hasSel?'flex':'none'}
    })
    holder.addEventListener('contextmenu',(e)=>{if(inspect)e.preventDefault()})
    holder.__renderPaused=renderPaused;holder.__overlay=overlay;holder.__selDiv=selDiv
  })
}

export function bindGains(setters){
  canvases.forEach((_,i)=>{
    const el=document.querySelectorAll('.spec .gainSlider')[i];const lbl=document.querySelectorAll('.spec .gainLabel')[i]
    if(!el)return;const setDb=(db)=>{ if(lbl)lbl.textContent=`${db} dB`; if(setters[i])setters[i](parseFloat(db)) }
    el.oninput=(e)=>setDb(e.target.value);setDb(el.value||'0')
  })
}

export function start(analyzers){
  stop();const chCount=analyzers.length
  for(let i=0;i<chCount;i++){freqData[i]=new Uint8Array(analyzers[i].frequencyBinCount);timeData[i]=new Uint8Array(1024);frameAcc[i]=0}
  loops=new Array(chCount).fill(null)
  for(let i=0;i<chCount;i++){
    const ctx=ctxs[i],canvas=canvases[i],an=analyzers[i],lvl=meters[i]
    const draw=()=>{
      loops[i]=requestAnimationFrame(draw)
      const w=canvas.width,h=canvas.height;if(!w||!h)return
      const hWave=Math.max(30,Math.round(h*WAVE_RATIO)),hSpec=Math.max(1,h-hWave)
      if(!isPlaying())return
      const ppf=pxPerFrame[i]||0;let steps=0
      if(ppf>0){const pxToAdd=frameAcc[i]*ppf;steps=pxToAdd|0;frameAcc[i]-=steps/ppf}
      an.getByteFrequencyData(freqData[i]);an.getByteTimeDomainData(timeData[i])
      if(steps>0){
        if(steps<w){const img=ctx.getImageData(steps,0,w-steps,h);ctx.putImageData(img,0,0)}else{ctx.fillStyle='#0a0f16';ctx.fillRect(0,0,w,h)}
        for(let s=steps;s>0;s--){const x=w-s
          const t=timeData[i],val=(t[(t.length/2)|0]-128)/128,mid=(hWave/2)|0,y=mid-Math.round(Math.max(-1,Math.min(1,val))*(hWave/2-1))
          ctx.fillStyle='#0a0f16';ctx.fillRect(x,0,1,hWave);ctx.fillStyle='#7cc5ff';ctx.fillRect(x,Math.max(0,y-1),1,2)
          for(let yy=0;yy<hSpec;yy++){const bin=Math.floor((yy/hSpec)*freqData[i].length);const v=freqData[i][bin];ctx.fillStyle=hueHeat(v);ctx.fillRect(x,h-1-yy,1,1)}
        }
      }
      let acc=0;for(let k=0;k<timeData[i].length;k++){const s=(timeData[i][k]-128)/128;acc+=s*s}
      const rms=Math.sqrt(acc/timeData[i].length),pct=Math.max(0,Math.min(1,rms*3))*100
      if(lvl)lvl.style.background=`linear-gradient(to right, #36d67e ${pct}%, transparent ${pct}%)`
    }
    loops[i]=requestAnimationFrame(draw)
  }
}

export function stop(){loops.forEach(id=>id&&cancelAnimationFrame(id));loops=[]}

export function setPauseSnapshotMeta(snap){ snapMeta = snap }

export function enterInspectMode(){
  inspect=true
  canvases.forEach((canvas,i)=>{
    if(!canvas)return
    const off=document.createElement('canvas');off.width=canvas.width;off.height=canvas.height;off.getContext('2d').drawImage(canvas,0,0);frozen[i]=off
    const holder=canvas.parentElement;if(holder.__overlay)holder.__overlay.style.display=selection[i]?'flex':'none';if(holder.__renderPaused)holder.__renderPaused()
  })
}
export function exitInspectMode(){
  inspect=false
  canvases.forEach((canvas)=>{const holder=canvas?.parentElement;if(holder?.__overlay)holder.__overlay.style.display='none';if(holder?.__selDiv)holder.__selDiv.style.display='none'})
}
export function bindSelectionHandlers(h){handlers={...handlers,...h}}
