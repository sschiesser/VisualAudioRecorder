/**
 * @file src/lib/deviceManager.js
 * @copyright Copyright (C) 2025 sschiesser
 * @license GPL-3.0-only
 * SPDX-License-Identifier: GPL-3.0-only
 */
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'

export async function listDevices(selectEl, currentId='') {
  const devices = await RecordPlugin.getAvailableAudioDevices()
  const score = (d) => (d.deviceId === 'default' || d.deviceId === 'communications') ? 1 : 0
  devices.sort((a,b) => score(a) - score(b))

  const prev = selectEl.value || currentId
  selectEl.innerHTML = devices.map(d => 
    `<option value="${d.deviceId}">${d.label || (d.deviceId === 'default' ? 'Default' : d.deviceId)}</option>`
  ).join('')

  if (prev && [...selectEl.options].some(o => o.value === prev)) {
    selectEl.value = prev
    return prev
  }
  return selectEl.value
}
