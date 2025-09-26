/**
 * @file src/lib/state.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */
export const state = {
  mode: 'stopped', // 'stopped' | 'playing' | 'paused'
  currentDeviceId: '',
  desiredChannels: 2,
  rafIds: [],
}
export const setMode = (m) => { state.mode = m }
export const isPlaying = () => state.mode === 'playing'
export const isPaused  = () => state.mode === 'paused'
