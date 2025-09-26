import { hueHeat } from "./utils/color.js";
import { isPlaying } from "./state.js";

let windowSeconds = 120;
const WAVE_RATIO = 0.25;
const TICK_H = 16; // px for bottom time scale

let canvases = [],
  ctxs = [],
  meters = [],
  ro = null,
  loops = [];
let freqData = [],
  timeData = [];
let lastW = [],
  lastH = [];
let gainEls = [],
  gainLbls = [];

let sampleRate = 48000;
let pxPerFrame = [],
  frameAcc = [],
  unsubClock = null;

let inspect = false,
  frozen = [],
  zoom = [],
  viewStart = [],
  selection = [],
  handlers = { play: null, save: null };
let snapMeta = null;
let recArmed = [],
  loopFlags = [],
  setRecCallback = (ch, on) => {};
let globalRec = false;
let onArmCb = (ch, armed) => {};
let onToggleCb = (ch, running) => {};

export function setWindowSeconds(sec) {
  const s = Math.max(1, parseInt(sec) || 120);
  windowSeconds = s;
  frameAcc = canvases.map(() => 0);
}

export function bindAudioClock(onFrames, sr) {
  if (unsubClock) {
    try {
      unsubClock();
    } catch {}
    unsubClock = null;
  }
  sampleRate = sr || 48000;
  pxPerFrame = canvases.map(
    (c) => (c?.width || 300) / (windowSeconds * sampleRate)
  );
  frameAcc = canvases.map(() => 0);
  unsubClock = onFrames(({ frames }) => {
    for (let i = 0; i < frameAcc.length; i++) frameAcc[i] += frames;
  });
}

export function setupGrid(containerSelector = "#spectrograms", chCount = 2) {
  const holders = Array.from(
    document.querySelectorAll(containerSelector + " .spec")
  );
  canvases = [];
  ctxs = [];
  meters = [];
  gainEls = [];
  gainLbls = [];
  holders.forEach((holder, i) => {
    const canvas = holder.querySelector("canvas");
    const label = holder.querySelector("span");
    const lvl = holder.querySelector(".lvl");
    // REC button (per-channel)
    let recBtn = holder.querySelector(".recBtn");
    if (!recBtn) {
      recBtn = document.createElement("div");
      recBtn.className = "recBtn";
      recBtn.textContent = "● REC";
      Object.assign(recBtn.style, {
        position: "absolute",
        left: "8px",
        top: "28px",
        padding: "2px 8px",
        borderRadius: "10px",
        border: "1px solid #2b425a",
        cursor: "pointer",
        userSelect: "none",
        background: "#1b2635",
      });
      holder.appendChild(recBtn);
    }
    // gain slider
    let slider = holder.querySelector("input.gainSlider");
    if (!slider) {
      slider = document.createElement("input");
      slider.type = "range";
      slider.className = "gainSlider";
      slider.min = "-24";
      slider.max = "24";
      slider.step = "0.5";
      slider.value = "0";
      Object.assign(slider.style, {
        position: "absolute",
        right: "8px",
        top: "28px",
        width: "140px",
        background: "transparent",
      });
      holder.appendChild(slider);
    }
    let gLabel = holder.querySelector("span.gainLabel");
    if (!gLabel) {
      gLabel = document.createElement("span");
      gLabel.className = "gainLabel";
      gLabel.textContent = "0 dB";
      Object.assign(gLabel.style, {
        position: "absolute",
        right: "8px",
        top: "50px",
        fontSize: "11px",
        opacity: ".8",
      });
      holder.appendChild(gLabel);
    }
    // overlay with play/save/loop
    let overlay = holder.querySelector(".overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "overlay";
      overlay.style.display = "none";
      const playBtn = document.createElement("div");
      playBtn.className = "btn";
      playBtn.textContent = "▶ Monitor";
      playBtn.onclick = () => {
        const sel = selection[i];
        if (!sel || !handlers.play) return;
        handlers.play(i, sel.x0Frac, sel.x1Frac, windowSeconds);
      };
      const saveBtn = document.createElement("div");
      saveBtn.className = "btn";
      saveBtn.textContent = "💾 Save WAV";
      saveBtn.onclick = () => {
        const sel = selection[i];
        if (!sel || !handlers.save) return;
        handlers.save(i, sel.x0Frac, sel.x1Frac, windowSeconds);
      };
      const loopBtn = document.createElement("div");
      loopBtn.className = "btn";
      loopBtn.textContent = "⟲ Loop";
      loopBtn.onclick = () => {
        loopFlags[i] = !loopFlags[i];
        loopBtn.style.borderColor = loopFlags[i] ? "#36d67e" : "#2b425a";
      };
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Wheel=Zoom, Drag=Select, Alt+Drag=Pan";
      overlay.appendChild(playBtn);
      overlay.appendChild(saveBtn);
      overlay.appendChild(loopBtn);
      overlay.appendChild(hint);
      holder.appendChild(overlay);
    }
    let selDiv = holder.querySelector(".sel");
    if (!selDiv) {
      selDiv = document.createElement("div");
      selDiv.className = "sel";
      selDiv.style.display = "none";
      holder.appendChild(selDiv);
    }
    holder.style.display = i < chCount ? "block" : "none";
    slider.style.display = i < chCount ? "block" : "none";
    gLabel.style.display = i < chCount ? "block" : "none";
    recBtn.style.display = i < chCount ? "inline-block" : "none";
    if (i < chCount) {
      const w = holder.clientWidth || 300;
      const h = holder.clientHeight || 150;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0a0f16";
      ctx.fillRect(0, 0, w, h);
      canvases[i] = canvas;
      ctxs[i] = ctx;
      meters[i] = lvl;
      label.textContent = `CH ${i + 1}`;
    }
  });
  const chCountReal = chCount;
  freqData = new Array(chCountReal);
  timeData = new Array(chCountReal);
  lastW = new Array(chCountReal).fill(0);
  lastH = new Array(chCountReal).fill(0);
  pxPerFrame = canvases.map(
    (c) => (c?.width || 300) / (windowSeconds * sampleRate)
  );
  frameAcc = new Array(chCountReal).fill(0);
  zoom = new Array(chCountReal).fill(1);
  viewStart = new Array(chCountReal).fill(0);
  selection = new Array(chCountReal).fill(null);
  frozen = new Array(chCountReal).fill(null);
  recArmed = new Array(chCountReal).fill(true);
  loopFlags = new Array(chCountReal).fill(false);
  // wire REC buttons
  document.querySelectorAll(".spec .recBtn").forEach((btn, idx) => {
    if (idx < chCountReal) {
      btn.style.borderColor = globalRec ? "#ff5161" : "#2b425a";
      btn.style.color = globalRec ? "#ff5161" : "#8aa0b4";
      btn.textContent = globalRec ? "● REC" : "ARM";
      btn.onclick = () => {
        recArmed[idx] = !recArmed[idx];
        if (recArmed[idx]) {
          btn.style.borderColor = globalRec ? "#ff5161" : "#2b425a";
          btn.style.color = globalRec ? "#ff5161" : "#8aa0b4";
          btn.textContent = globalRec ? "● REC" : "ARM";
        } else {
          btn.style.borderColor = "#2b425a";
          btn.style.color = "#8aa0b4";
        }
        setRecCallback(idx, recArmed[idx]);
      };
    }
  });

  if (ro) ro.disconnect();
  ro = new ResizeObserver(() => {
    canvases.forEach((canvas, i) => {
      if (!canvas) return;
      const holder = canvas.parentElement;
      const ctx = ctxs[i];
      const old = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const w = holder.clientWidth || 300;
      const h = holder.clientHeight || 150;
      canvas.width = w;
      canvas.height = h;
      ctx.putImageData(
        old,
        Math.max(0, w - old.width),
        Math.max(0, h - old.height)
      );
      pxPerFrame[i] = w / (windowSeconds * sampleRate);
      lastW[i] = w;
      lastH[i] = h;
    });
  });
  canvases.forEach((c) => c && ro.observe(c.parentElement));
  attachInteractions(chCountReal);
}

function attachInteractions(chCount) {
  canvases.forEach((canvas, i) => {
    if (!canvas) return;
    const holder = canvas.parentElement,
      overlay = holder.querySelector(".overlay"),
      selDiv = holder.querySelector(".sel");
    let dragging = false,
      panning = false,
      selStartX = 0;
    const renderPaused = () => {
      if (!inspect) return;
      const ctx = ctxs[i],
        w = canvas.width,
        h = canvas.height;
      ctx.fillStyle = "#0a0f16";
      ctx.fillRect(0, 0, w, h);
      const src = frozen[i];
      if (!src) return;
      const z = Math.max(1, zoom[i]),
        span = 1 / z,
        sxFrac = Math.max(0, Math.min(1 - span, viewStart[i]));
      const sx = Math.floor(sxFrac * src.width),
        sw = Math.max(1, Math.floor(span * src.width));
      ctx.drawImage(src, sx, 0, sw, src.height, 0, 0, w, h);
      const sel = selection[i];
      if (sel) {
        const left = (sel.x0Frac - sxFrac) / span,
          right = (sel.x1Frac - sxFrac) / span;
        const x = Math.max(0, Math.floor(left * w)),
          x2 = Math.min(w, Math.floor(right * w));
        selDiv.style.display = x2 > x ? "block" : "none";
        selDiv.style.left = x + "px";
        selDiv.style.top = "0px";
        selDiv.style.width = Math.max(0, x2 - x) + "px";
        selDiv.style.height = h + "px";
      } else selDiv.style.display = "none";
    };
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!inspect) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect(),
          mx = (e.clientX - rect.left) / rect.width,
          dir = Math.sign(e.deltaY);
        const zPrev = zoom[i];
        let z = zPrev * (dir > 0 ? 1 / 1.2 : 1.2);
        z = Math.max(1, Math.min(64, z));
        const spanPrev = 1 / zPrev,
          spanNew = 1 / z,
          vx = viewStart[i],
          focus = vx + mx * spanPrev;
        viewStart[i] = Math.max(0, Math.min(1 - spanNew, focus - mx * spanNew));
        zoom[i] = z;
        renderPaused();
      },
      { passive: false }
    );
    canvas.addEventListener("mousedown", (e) => {
      if (!inspect) return;
      e.preventDefault();
      if (e.altKey || e.button === 1 || e.button === 2) {
        panning = true;
      } else {
        dragging = true;
        const rect = canvas.getBoundingClientRect(),
          x = (e.clientX - rect.left) / rect.width;
        const span = 1 / Math.max(1, zoom[i]);
        const xFrac = viewStart[i] + x * span;
        selStartX = xFrac;
        selection[i] = { x0Frac: xFrac, x1Frac: xFrac };
      }
      renderPaused();
    });
    window.addEventListener("mousemove", (e) => {
      if (!inspect || (!dragging && !panning)) return;
      const rect = canvas.getBoundingClientRect();
      if (panning) {
        const dx = e.movementX;
        const span = 1 / Math.max(1, zoom[i]);
        const d = (-dx / rect.width) * span;
        const ns = Math.max(0, Math.min(1 - span, viewStart[i] + d));
        if (ns !== viewStart[i]) {
          viewStart[i] = ns;
          renderPaused();
        }
      } else if (dragging) {
        const x = (e.clientX - rect.left) / rect.width;
        const span = 1 / Math.max(1, zoom[i]);
        const xFrac = viewStart[i] + x * span;
        const x0 = Math.max(0, Math.min(1, Math.min(selStartX, xFrac))),
          x1 = Math.max(0, Math.min(1, Math.max(selStartX, xFrac)));
        selection[i] = { x0Frac: x0, x1Frac: x1 };
        renderPaused();
      }
    });
    window.addEventListener("mouseup", () => {
      if (!inspect) return;
      if (dragging || panning) {
        dragging = false;
        panning = false;
        const hasSel =
          selection[i] && selection[i].x1Frac > selection[i].x0Frac;
        overlay.style.display = hasSel ? "flex" : "none";
      }
    });
    holder.addEventListener("contextmenu", (e) => {
      if (inspect) e.preventDefault();
    });
    holder.__renderPaused = renderPaused;
    holder.__overlay = overlay;
    holder.__selDiv = selDiv;
  });
}

export function bindGains(setters) {
  canvases.forEach((_, i) => {
    const el = document.querySelectorAll(".spec .gainSlider")[i];
    const lbl = document.querySelectorAll(".spec .gainLabel")[i];
    if (!el) return;
    const setDb = (db) => {
      if (lbl) lbl.textContent = `${db} dB`;
      if (setters[i]) setters[i](parseFloat(db));
    };
    el.oninput = (e) => setDb(e.target.value);
    setDb(el.value || "0");
  });
}

export function start(analyzers) {
  function drawTimeAxis(ctx, w, h, hWave, hSpec) {
    const TICK_H = 16;
    const hAvail = Math.max(1, h - TICK_H);
    // clear axis band
    ctx.fillStyle = "#0b131e";
    ctx.fillRect(0, h - TICK_H, w, TICK_H);
    // ticks each 1s across windowSeconds, right edge is 0s
    const secPerPx = windowSeconds / Math.max(1, w);
    const maxS = Math.max(0, Math.floor(windowSeconds));
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let s = 0; s <= maxS; s++) {
      const x = Math.round(w - s / secPerPx);
      if (x < 0 || x > w) continue;
      // grid line
      ctx.fillStyle = "rgba(124,197,255,0.18)";
      ctx.fillRect(x, 0, 1, hAvail);
      // tick
      ctx.fillStyle = "#7cc5ff";
      ctx.fillRect(x, h - TICK_H, 1, 6);
      // label
      ctx.fillText(`${s}s`, x, h - 2);
    }
  }

  stop();
  const chCount = analyzers.length;
  for (let i = 0; i < chCount; i++) {
    freqData[i] = new Uint8Array(analyzers[i].frequencyBinCount);
    timeData[i] = new Uint8Array(1024);
    frameAcc[i] = 0;
  }
  loops = new Array(chCount).fill(null);
  for (let i = 0; i < chCount; i++) {
    const ctx = ctxs[i],
      canvas = canvases[i],
      an = analyzers[i],
      lvl = meters[i];
    const draw = () => {
      loops[i] = requestAnimationFrame(draw);
      const w = canvas.width,
        h = canvas.height;
      if (!w || !h) return;
      const hAvail = Math.max(1, h - TICK_H);
      const hWave = Math.max(30, Math.round(hAvail * WAVE_RATIO)),
        hSpec = Math.max(1, hAvail - hWave);
      if (!isPlaying()) return;
      const ppf = pxPerFrame[i] || 0;
      let steps = 0;
      if (ppf > 0) {
        const pxToAdd = frameAcc[i] * ppf;
        steps = pxToAdd | 0;
        frameAcc[i] -= steps / ppf;
      }
      an.getByteFrequencyData(freqData[i]);
      an.getByteTimeDomainData(timeData[i]);
      if (steps > 0) {
        if (steps < w) {
          const img = ctx.getImageData(steps, 0, w - steps, h);
          ctx.putImageData(img, 0, 0);
        } else {
          ctx.fillStyle = "#0a0f16";
          ctx.fillRect(0, 0, w, h);
        }
        for (let s = steps; s > 0; s--) {
          const x = w - s;
          // waveform
          const t = timeData[i],
            val = (t[(t.length / 2) | 0] - 128) / 128,
            mid = (hWave / 2) | 0,
            y =
              mid -
              Math.round(Math.max(-1, Math.min(1, val)) * (hWave / 2 - 1));
          ctx.fillStyle = "#0a0f16";
          ctx.fillRect(x, 0, 1, hWave);
          ctx.fillStyle = "#7cc5ff";
          ctx.fillRect(x, Math.max(0, y - 1), 1, 2);
          // spectrogram
          for (let yy = 0; yy < hSpec; yy++) {
            const bin = Math.floor((yy / hSpec) * freqData[i].length);
            const v = freqData[i][bin];
            ctx.fillStyle = hueHeat(v);
            ctx.fillRect(x, h - TICK_H - 1 - yy, 1, 1);
          }
          // time axis column
          const secPerPx = windowSeconds / w;
          const tSec = (w - 1 - x) * secPerPx;
          const nearest = Math.round(tSec);
          const isMajor = Math.abs(tSec - nearest) < secPerPx * 0.5;
          // axis background
          ctx.fillStyle = "#0b131e";
          ctx.fillRect(x, h - TICK_H, 1, TICK_H);
          if (isMajor) {
            // vertical grid line
            ctx.fillStyle = "rgba(124,197,255,0.25)";
            ctx.fillRect(x, 0, 1, hAvail);
            // tick + label
            ctx.fillStyle = "#7cc5ff";
            ctx.fillRect(x, h - TICK_H, 1, 6);
            ctx.font = "10px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(`${nearest}s`, x, h - 2);
          }
        }
      }
      // meter
      let acc = 0;
      for (let k = 0; k < timeData[i].length; k++) {
        const s = (timeData[i][k] - 128) / 128;
        acc += s * s;
      }
      const rms = Math.sqrt(acc / timeData[i].length),
        pct = Math.max(0, Math.min(1, rms * 3)) * 100;
      if (lvl)
        lvl.style.background = `linear-gradient(to right, #36d67e ${pct}%, transparent ${pct}%)`;
    };
    loops[i] = requestAnimationFrame(draw);
  }
}

export function stop() {
  loops.forEach((id) => id && cancelAnimationFrame(id));
  loops = [];
}
export function enterInspectMode() {
  inspect = true;
  canvases.forEach((canvas, i) => {
    if (!canvas) return;
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    off.getContext("2d").drawImage(canvas, 0, 0);
    frozen[i] = off;
    const holder = canvas.parentElement;
    if (holder.__overlay)
      holder.__overlay.style.display = selection[i] ? "flex" : "none";
    if (holder.__renderPaused) holder.__renderPaused();
  });
}
export function exitInspectMode() {
  inspect = false;
  canvases.forEach((canvas) => {
    const holder = canvas?.parentElement;
    if (holder?.__overlay) holder.__overlay.style.display = "none";
    if (holder?.__selDiv) holder.__selDiv.style.display = "none";
  });
}
export function bindSelectionHandlers(h) {
  handlers = { ...handlers, ...h };
}
export function setPauseSnapshotMeta(snap) {
  snapMeta = snap;
}
export function bindRecordToggles(setter) {
  setRecCallback = setter;
}
export function isLoopEnabled(ch) {
  return !!loopFlags[ch];
}

export function getRecStates() {
  return Array.isArray(recArmed) ? recArmed.slice() : [];
}

export function bindRecordControls(cbs) {
  onArmCb = cbs?.onArm || onArmCb;
  onToggleCb = cbs?.onToggle || onToggleCb;
}

export function setGlobalRecRunning(r) {
  globalRec = !!r; // update buttons to reflect mode
  document.querySelectorAll(".spec .recBtn").forEach((btn, idx) => {
    if (globalRec) {
      btn.textContent = recArmed[idx] ? "● REC" : "⏸︎";
      btn.style.borderColor = recArmed[idx] ? "#ff5161" : "#2b425a";
      btn.style.color = recArmed[idx] ? "#ff5161" : "#8aa0b4";
    } else {
      btn.textContent = recArmed[idx] ? "ARMED" : "ARM";
      btn.style.borderColor = recArmed[idx] ? "#d2a64f" : "#2b425a";
      btn.style.color = recArmed[idx] ? "#ffd37a" : "#8aa0b4";
    }
  });
}

export function getArmStates() {
  return Array.isArray(recArmed) ? recArmed.slice() : [];
}
