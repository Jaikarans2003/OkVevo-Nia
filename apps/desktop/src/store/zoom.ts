/**
 * Window text size (zoom).
 *
 * The main process owns the zoom level and persists it (see electron/zoom.ts
 * for the scale). The renderer only mirrors the current percent for the
 * settings UI: preset clicks go to the main process over IPC, and every
 * change comes back through onChanged, including ones made with the
 * Ctrl/Cmd +/-/0 shortcuts or the View menu, so the UI never drifts.
 */

import { atom } from 'nanostores'

/** Locked UI scale (110%). Matches electron/zoom.ts. */
export const LOCKED_ZOOM_PERCENT = 110

export const $zoomPercent = atom<number>(LOCKED_ZOOM_PERCENT)

export function setZoomPercent(percent: number): void {
  window.hermesDesktop?.zoom?.setPercent(percent)
}

if (typeof window !== 'undefined' && window.hermesDesktop?.zoom) {
  const zoom = window.hermesDesktop.zoom
  let receivedZoomChange = false

  zoom.onChanged(({ percent }) => {
    receivedZoomChange = true
    $zoomPercent.set(percent)
  })

  void zoom.get().then(({ percent }) => {
    if (!receivedZoomChange) {
      $zoomPercent.set(percent)
    }
  })
}
