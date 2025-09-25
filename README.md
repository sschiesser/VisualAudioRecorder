# Live Mic Spectrogram — Device Selection Fix

This build preserves your selected input device and uses a robust `getUserMedia` strategy.

## Run
```bash
npm install
npm run dev
```
Open http://localhost:5173, pick a mic, click **Start**.

## Notes
- Keeps dropdown selection when refreshing device list.
- Tries exact/ideal/default fallbacks for `deviceId`.
- Restarts the stream when you change the device while running.
