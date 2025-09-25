# Mic Spectrogram (Modular, 1–4 channels)

Refactor of the multichannel app into small ES modules:

```
src/
  index.js
  lib/
    app.js                # orchestrates UI + modules
    state.js              # simple state
    deviceManager.js      # device enumeration/sorting
    audioGraph.js         # getUserMedia + AudioContext graph helpers
    waveform.js           # wavesurfer + record plugin hookup
    spectrogramGrid.js    # canvas grid + draw loops + meters
    recorder.js           # AudioWorklet capture + WAV saving
    recorder-worklet.js   # worklet processor (copied by Vite)
    utils/
      color.js            # color mapping
      wav.js              # WAV encoder
```

## Run
```bash
npm install
npm run dev
```
Open http://localhost:5173, choose devices/channels/FFT, and hit **Play**.

- **Play/Pause** toggles monitoring
- **● Rec** begins per-channel capture (if AudioWorklet supported); **Save WAVs** downloads 1 WAV per channel.
