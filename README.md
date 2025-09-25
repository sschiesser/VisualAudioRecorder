# Mic Spectrogram — Up to 4 Channels (Robust fix)

This build fixes:
- **Device list**: correct template literals (no escaping), and repopulates labels *after* mic permission.
- **Black spectrogram**: set state before loops, keep `requestAnimationFrame` alive, ensure non‑zero canvas sizes, and `AudioContext.resume()` on Play.

Features:
- One **Play/Pause** button
- **Mic**, **Channels (1–4)**, **FFT** controls
- Up to **4 per‑channel spectrograms** + simple level meters
- Optional per‑channel recording via `AudioWorklet`

## Run
```bash
npm install
npm run dev
```
Open the URL, click **Play** (grant mic), then adjust mic/channels/FFT.
