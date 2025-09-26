import { state, setMode } from "./state.js";
import { listDevices } from "./deviceManager.js";
import { ensureStream, createContext, buildGraph } from "./audioGraph.js";
import * as Spectro from "./spectrogramGrid.js";
import * as Rec from "./recorder.js";

export function initApp() {
  const els = {
    toggle: document.getElementById("toggle"),
    save: document.getElementById("save"),
    deviceSelect: document.getElementById("deviceSelect"),
    channels: document.getElementById("channels"),
    fft: document.getElementById("fft"),
    bufferSec: document.getElementById("bufferSec"),
    info: document.getElementById("info"),
  };

  let stream = null;
  let audioCtx = null;
  let splitter = null;
  let analyzers = [];
  let gains = [];
  let merger = null;
  let previewCtx = null;
  let previewSrc = null;
  let snapshot = null;

  const setInfo = (t) => (els.info.textContent = t);
  const setButton = (t) => (els.toggle.textContent = t);
  const dbToLin = (db) => Math.pow(10, db / 20);

  // UI prep
  const initialCh = Math.min(4, parseInt(els.channels.value, 10) || 2);
  Spectro.setupGrid("#spectrograms", initialCh);
  Spectro.setWindowSeconds(parseInt(els.bufferSec.value, 10) || 120);
  listDevices(els.deviceSelect, "").catch(() => {});

  // Selection actions
  Spectro.bindSelectionHandlers({
    play: (ch, f0, f1, winSec) => previewSelection(ch, f0, f1, winSec),
    save: (ch, f0, f1, winSec) => saveSelection(ch, f0, f1, winSec),
  });

  // Per-channel play/pause (recording write gate)
  Spectro.bindRecordControls({
    onToggle: (ch, running) => {
      console.log(
        `App received channel toggle: CH${ch + 1} = ${running ? "ON" : "OFF"}`
      );

      // Actually set the channel recording state
      Rec.setChannelRecording(ch, !!running);

      // Verify the state was set
      const actualState = Rec.getChannelRecording(ch);
      console.log(
        `Recorder actual state for CH${ch + 1}: ${actualState ? "ON" : "OFF"}`
      );

      // Update info display
      setInfo(`Channel ${ch + 1} recording: ${running ? "ON" : "OFF"}`);
    },
  });

  function stopPreview() {
    try {
      previewSrc && previewSrc.stop();
    } catch {}
    try {
      previewCtx && previewCtx.close();
    } catch {}
    previewSrc = null;
    previewCtx = null;
  }

  async function previewSelection(ch, f0, f1, winSec) {
    if (!snapshot) {
      setInfo("Pause first to monitor a selection.");
      return;
    }
    stopPreview();
    const { data, sampleRate } = Rec.extractWithSnapshot(ch, f0, f1, snapshot);
    if (!data.length) {
      setInfo("No audio in selection.");
      return;
    }
    previewCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = previewCtx.createBuffer(1, data.length, sampleRate);
    buf.copyToChannel(data, 0, 0);
    previewSrc = previewCtx.createBufferSource();
    previewSrc.buffer = buf;
    previewSrc.connect(previewCtx.destination);
    if (previewCtx.state === "suspended") {
      try {
        await previewCtx.resume();
      } catch {}
    }
    previewSrc.onended = () => stopPreview();
    previewSrc.start();
    setInfo(
      `Monitoring selection: ch${ch + 1}, ${(data.length / sampleRate).toFixed(2)}s`
    );
  }

  function saveSelection(ch, f0, f1, winSec) {
    if (!snapshot) {
      setInfo("Pause first to save a selection.");
      return;
    }
    const { data, sampleRate } = Rec.extractWithSnapshot(ch, f0, f1, snapshot);
    if (!data.length) {
      setInfo("No audio in selection.");
      return;
    }
    import("./utils/wav.js").then(({ encodeWavPCM16 }) => {
      const blob = encodeWavPCM16(data, sampleRate);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `selection_ch${ch + 1}_${(data.length / sampleRate).toFixed(2)}s_${sampleRate}Hz.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setInfo("Selection saved.");
    });
  }

  async function play() {
    const deviceId = els.deviceSelect.value;
    const chCount = Math.min(4, parseInt(els.channels.value, 10) || 2);
    const bufferSec = parseInt(els.bufferSec.value, 10) || 120;
    Spectro.setWindowSeconds(bufferSec);

    stream = stream || (await ensureStream(deviceId, chCount));
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch {}
    }
    audioCtx = createContext();
    if (audioCtx.state === "suspended") {
      try {
        await audioCtx.resume();
      } catch {}
    }

    const { splitter: sp } = buildGraph(audioCtx, stream);
    splitter = sp;
    Spectro.setupGrid("#spectrograms", chCount);
    Spectro.bindAudioClock(Rec.onAudioFrames, audioCtx.sampleRate);

    gains = Array.from({ length: chCount }, () => {
      const g = audioCtx.createGain();
      g.gain.value = 1;
      return g;
    });
    analyzers = Array.from({ length: chCount }, () => {
      const a = audioCtx.createAnalyser();
      a.fftSize = parseInt(els.fft.value, 10) || 1024;
      a.smoothingTimeConstant = 0.8;
      return a;
    });
    for (let i = 0; i < chCount; i++) {
      splitter.connect(gains[i], i, 0);
      gains[i].connect(analyzers[i]);
    }
    merger = audioCtx.createChannelMerger(chCount);
    for (let i = 0; i < chCount; i++) {
      gains[i].connect(merger, 0, i);
    }

    const setters = gains.map((g) => (db) => {
      g.gain.value = dbToLin(db);
    });
    Spectro.bindGains(setters);

    setMode("playing");
    setButton("Pause");
    requestAnimationFrame(() => {
      Spectro.start(analyzers);
    });
    const ok = await Rec.setupBuffering(audioCtx, merger, chCount, bufferSec);
    els.save.disabled = !ok;

    // Global start: enable recording on all channels (no reset)
    for (let i = 0; i < chCount; i++) {
      Rec.setChannelRecording(i, true);
      // Sync the UI state
      chRunning[i] = true; // This should be accessible or you need to call Spectro.setChannelState(i, true)
    }

    Rec.debugChannelStates();

    setInfo(
      `${stream.getAudioTracks?.[0]?.label || "Mic"} • buffering ${bufferSec}s • ${chCount} ch @ ${audioCtx.sampleRate | 0} Hz`
    );
  }

  function pause() {
    setMode("paused");
    if (audioCtx) {
      try {
        audioCtx.suspend();
      } catch {}
    }
    setButton("Play");
    setInfo("Paused: zoom/pan/select available.");
    Spectro.enterInspectMode();
    stopPreview();
    const bufSec = parseInt(els.bufferSec.value, 10) || 120;
    snapshot = Rec.getWindowSnapshot(bufSec);
    Spectro.setPauseSnapshotMeta?.(snapshot);

    // DON'T automatically pause all channels - let individual channel controls work
    // Remove this section:
    /*
  {
    const n = Math.min(4, parseInt(els.channels.value, 10) || 2);
    for (let i = 0; i < n; i++) {
      Rec.setChannelRecording(i, false);
    }
  }
  */
  }

  async function resume() {
    stopPreview();
    if (audioCtx?.state === "suspended") {
      await audioCtx.resume().catch(() => {});
    }
    setMode("playing");
    setButton("Pause");
    setInfo("Buffering + visuals resumed");
    Spectro.exitInspectMode();
    snapshot = null;

    // DON'T automatically resume all channels - let individual channel controls work
    // Remove this section:
    /*
  {
    const n = Math.min(4, parseInt(els.channels.value, 10) || 2);
    for (let i = 0; i < n; i++) {
      Rec.setChannelRecording(i, true);
    }
  }
  */

    // Instead, sync the visual button states with the actual recorder states
    if (typeof Spectro.syncChannelButtonStates === "function") {
      Spectro.syncChannelButtonStates();
    }
  }

  function stopAll() {
    Spectro.stop();
    stopPreview();
    if (audioCtx) {
      try {
        audioCtx.close();
      } catch {}
      audioCtx = null;
    }
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
      stream = null;
    }
  }

  // Main Play/Pause for visuals + input graph
  els.toggle.addEventListener("click", async () => {
    if (state.mode === "stopped") await play();
    else if (state.mode === "playing") pause();
    else await resume();
  });

  els.deviceSelect.addEventListener("change", async () => {
    if (state.mode === "stopped") return;
    pause();
    stopAll();
    await play();
  });

  els.channels.addEventListener("change", async () => {
    if (state.mode === "playing") {
      pause();
      stopAll();
      await play();
    } else {
      Spectro.setupGrid(
        "#spectrograms",
        Math.min(4, parseInt(els.channels.value, 10) || 2)
      );
    }
  });

  els.fft.addEventListener("change", () => {
    if (state.mode === "playing") {
      analyzers.forEach((an) => {
        an.fftSize = parseInt(els.fft.value, 10) || 1024;
      });
      Spectro.start(analyzers);
    }
  });

  els.bufferSec.addEventListener("change", () => {
    const buf = parseInt(els.bufferSec.value, 10) || 120;
    Spectro.setWindowSeconds(buf);
    if (state.mode === "playing") {
      Rec.setBufferSeconds(buf);
      setInfo(`Buffer length set to ${buf}s`);
    }
  });

  window.addEventListener("beforeunload", () => stopAll());
}
