export const state = { mode: 'stopped', currentDeviceId: '', desiredChannels: 2 }
export const setMode = (m) => { state.mode = m }
export const isPlaying = () => state.mode === 'playing'
