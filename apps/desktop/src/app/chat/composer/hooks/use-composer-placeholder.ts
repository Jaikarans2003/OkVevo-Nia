import { useEffect, useRef, useState } from 'react'

import { useI18n } from '@/i18n'
import { resetBrowseState } from '@/store/composer-input-history'

import { pickPlaceholder } from '../composer-utils'

interface UseComposerPlaceholderOptions {
  disabled: boolean
  /** When true, cycle every sentence with type-forward / type-back (normal window only). */
  loop: boolean
  reconnecting: boolean
  sessionId: null | string | undefined
}

export type ComposerPlaceholderState = {
  /** True when the orange loop caret should paint over the empty field. */
  looping: boolean
  text: string
}

const TYPE_MS = 28
const HOLD_MS = 1100
const GAP_MS = 320

type Phase = 'type' | 'hold' | 'delete' | 'gap'

/**
 * Composer placeholder: static pick (HUD / transport-down), or an endless
 * forward/back typewriter through the full sentence pool (normal mode).
 */
export function useComposerPlaceholder({
  disabled,
  loop,
  reconnecting,
  sessionId
}: UseComposerPlaceholderOptions): ComposerPlaceholderState {
  const { t } = useI18n()
  const newSessionPlaceholders = t.composer.newSessionPlaceholders
  const followUpPlaceholders = t.composer.followUpPlaceholders
  const pool = sessionId ? followUpPlaceholders : newSessionPlaceholders

  const [restingPlaceholder, setRestingPlaceholder] = useState(() => pickPlaceholder(pool))
  const [loopText, setLoopText] = useState('')
  const prevSessionIdRef = useRef(sessionId)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    const prev = prevSessionIdRef.current
    prevSessionIdRef.current = sessionId

    if (prev === sessionId) {
      return
    }

    // null → id: keep the starter we already showed.
    if (prev == null && sessionId) {
      return
    }

    resetBrowseState(prev)
    setRestingPlaceholder(pickPlaceholder(sessionId ? followUpPlaceholders : newSessionPlaceholders))
  }, [followUpPlaceholders, newSessionPlaceholders, sessionId])

  const statusText = disabled
    ? reconnecting
      ? t.composer.placeholderReconnecting
      : t.composer.placeholderStarting
    : null

  const looping = loop && !disabled && pool.length > 0
  const poolKey = pool.join('\0')

  useEffect(() => {
    if (!looping) {
      setLoopText('')

      return
    }

    const sentences = poolKey.split('\0').filter(Boolean)

    if (sentences.length === 0) {
      return
    }

    let sentenceIndex = 0
    let visible = 0
    let phase: Phase = 'type'
    let holdUntil = 0
    let timer: number | undefined

    const sentence = () => sentences[sentenceIndex % sentences.length] ?? ''

    const paint = () => {
      setLoopText(sentence().slice(0, visible))
    }

    const schedule = (ms: number, fn: () => void) => {
      timer = window.setTimeout(fn, ms)
    }

    const tick = () => {
      const current = sentence()

      if (phase === 'type') {
        visible += 1
        paint()

        if (visible >= current.length) {
          phase = 'hold'
          holdUntil = Date.now() + HOLD_MS
          schedule(HOLD_MS, tick)

          return
        }

        schedule(TYPE_MS, tick)

        return
      }

      if (phase === 'hold') {
        if (Date.now() < holdUntil) {
          schedule(Math.max(16, holdUntil - Date.now()), tick)

          return
        }

        phase = 'delete'
        schedule(TYPE_MS, tick)

        return
      }

      if (phase === 'delete') {
        visible = Math.max(0, visible - 1)
        paint()

        if (visible <= 0) {
          sentenceIndex = (sentenceIndex + 1) % sentences.length
          phase = 'gap'
          schedule(GAP_MS, tick)

          return
        }

        schedule(TYPE_MS, tick)

        return
      }

      // gap between sentences
      phase = 'type'
      visible = 0
      paint()
      schedule(TYPE_MS, tick)
    }

    paint()
    schedule(TYPE_MS, tick)

    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [looping, poolKey])

  if (statusText) {
    return { looping: false, text: statusText }
  }

  if (looping) {
    return { looping: true, text: loopText }
  }

  return { looping: false, text: restingPlaceholder }
}
