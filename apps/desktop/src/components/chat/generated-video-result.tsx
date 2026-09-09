'use client'

import { type FC, useEffect, useState } from 'react'

import { useI18n } from '@/i18n'
import { generatedVideoFromResult } from '@/lib/generated-images'
import { mediaExternalUrl, mediaName, resolveMediaPlaybackSrc } from '@/lib/media'

// Generated-video card. The Python side downloads the deliverable to a local
// cache path before the result ever reaches the renderer, so `video` is almost
// always a filesystem path — playback goes through the seekable hermes-media://
// bridge (resolveMediaPlaybackSrc), never a bare CDN URL.
export const GeneratedVideo: FC<{ result?: unknown }> = ({ result }) => {
  const { t } = useI18n()
  const copy = t.desktop
  const video = result === undefined ? null : generatedVideoFromResult(result)
  const pending = result === undefined

  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    setSrc('')

    if (!video) {
      return
    }

    void resolveMediaPlaybackSrc(video)
      .then(resolved => !cancelled && setSrc(resolved))
      .catch(() => !cancelled && setFailed(true))

    return () => {
      cancelled = true
    }
  }, [video])

  // Completed but no usable video (generation failed): the agent's prose carries
  // the explanation, so render nothing here (image card parity).
  if (!pending && !video) {
    return null
  }

  if (pending) {
    return (
      <span
        aria-label={t.assistant.tool.renderingVideo}
        aria-live="polite"
        className="mt-2 flex aspect-video w-full max-w-md items-center justify-center rounded-2xl bg-(--ui-bg-quinary) text-xs text-(--ui-text-tertiary)"
        data-slot="aui_generated-video"
        role="status"
      >
        {t.assistant.tool.renderingVideo}…
      </span>
    )
  }

  if (failed && video) {
    return (
      <a
        className="mt-2 ref inline-block wrap-anywhere"
        href="#"
        onClick={event => {
          event.preventDefault()
          void window.hermesDesktop?.openExternal(mediaExternalUrl(video))
        }}
      >
        {copy.openImage}: {mediaName(video)}
      </a>
    )
  }

  if (!src) {
    return null
  }

  return (
    <video
      className="mt-2 max-h-96 w-full max-w-md rounded-2xl border border-(--ui-stroke-tertiary) bg-black"
      controls
      data-slot="aui_generated-video"
      preload="metadata"
      src={src}
    />
  )
}
