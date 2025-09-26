/*
 * Copyright (C) 2025 sschiesser
 * SPDX-License-Identifier: GPL-3.0-only
 */
export function hueHeat(val) {
  const hue = 260 * (1 - val / 255)
  return `hsl(${hue}, 100%, ${15 + 45 * (val / 255)}%)`
}
