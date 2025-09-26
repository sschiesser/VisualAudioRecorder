export function buildUI(){
  document.title = 'Visual Audio Recorder'
  const $ = (tag, props={}, ...children)=>{
    const el = document.createElement(tag)
    for(const [k,v] of Object.entries(props||{})){
      if(k === 'class') el.className = v
      else if(k === 'text') el.textContent = v
      else if(k.startsWith('on') && typeof v === 'function') el.addEventListener(k.substring(2), v)
      else if(v !== null && v !== undefined) el.setAttribute(k, v)
    }
    for(const c of children){ if(c!=null){ el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c) } }
    return el
  }

  const root = $('div', { class: 'wrap' })
  const header = $('header')
  const h1 = $('h1', { text: 'Visual Audio Recorder' })
  const controls = $('div', { class: 'controls' })

  const btnPlay = $('button', { id: 'toggle', class: 'primary', text: 'Play' })
  const btnSave = $('button', { id: 'save', text: 'Save WAVs' })
  btnSave.disabled = true
  const btnRecAll = $('button', { id: 'recAll', class: 'danger', text: 'Start All REC' })

  const labMic = $('label', {}, 'Mic: ', $('select', { id: 'deviceSelect' }))

  const labCh = $('label', {}, 'Channels: ', (function(){
    const sel = $('select', { id: 'channels' })
    ;[1,2,3,4].forEach(v=>{ const o=$('option', { value: String(v) }); o.text = String(v); if(v===2) o.selected = true; sel.appendChild(o) })
    return sel
  })())

  const labFFT = $('label', {}, 'FFT: ', (function(){
    const sel = $('select', { id: 'fft' })
    ;[512,1024,2048,4096,8192].forEach(v=>{ const o=$('option'); o.text = String(v); if(v===1024) o.selected = true; sel.appendChild(o) })
    return sel
  })())

  const labBuf = $('label', {}, 'Buffer: ', (function(){
    const sel = $('select', { id: 'bufferSec' })
    ;[[30,'30'],[60,'60'],[120,'120'],[300,'300 (5m)']].forEach(([v,t])=>{ const o=$('option', { value:String(v) }); o.text = t; if(v===120) o.selected = true; sel.appendChild(o) })
    return sel
  })())

  controls.append(btnPlay, btnSave, btnRecAll, labMic, labCh, labFFT, labBuf)
  header.append(h1, controls)

  const panes = $('section', { class: 'panes' })
  const grid = $('div', { id: 'spectrograms', class: 'grid4' })
  for (let i=0;i<4;i++){
    const card = $('div', { class: 'spec card' })
    const canvas = $('canvas')
    const label = $('span', { text: `CH ${i+1}` })
    const lvl = $('i', { class: 'lvl' })
    card.append(canvas, label, lvl)
    grid.appendChild(card)
  }
  panes.appendChild(grid)

  const footer = $('footer', {}, $('small', { id: 'info', text: '—' }))

  root.append(header, panes, footer)
  document.body.prepend(root)
}
