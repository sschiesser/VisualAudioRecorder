# Visual Audio Recorder - A recording tool for unheard sounds

A Node.js project (with Vide dev server) that visualize live microphone inputs with spectrograms.

This build preserves your selected input device and uses a robust `getUserMedia` strategy.

## Prerequisites

- Node.js 18+
- A browser with Web Audio + MediaDevices (Chrome, Edge, Firefox, Safari 15.4+)

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Then open <http://localhost:5173>, click **Start**, and allow mic access.

## Build

```bash
npm run build
npm run preview
```

## Notes

- Keeps dropdown selection when refreshing device list.
- Tries exact/ideal/default fallbacks for `deviceId`.
- Restarts the stream when you change the device while running.
