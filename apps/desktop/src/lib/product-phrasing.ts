import { translateNowArray } from '@/i18n'
import type { ProductPhrasingKey } from '@/i18n'

/**
 * WS3 Product-mode rotating phrasings. One phrase per tool row, picked
 * deterministically from the toolCallId so re-renders never flicker.
 * Tone deck approved by Karan 2026-09-09; copy lives in i18n
 * `assistant.tool.phrasing.*`.
 */

const SET_BY_TOOL: Record<string, ProductPhrasingKey> = {
  edit_file: 'file_edit',
  image_generate: 'image_generate',
  patch: 'file_edit',
  read_file: 'read_file',
  video_generate: 'video_generate',
  vision_analyze: 'vision_analyze',
  web_search: 'web_search',
  write_file: 'file_edit'
}

// djb2 — stable across sessions, no crypto needed for a title pick.
function hashSeed(seed: string): number {
  let hash = 5381

  for (let index = 0; index < seed.length; index++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) | 0
  }

  return Math.abs(hash)
}

function pickPhrase(set: ProductPhrasingKey, seed: string): string | null {
  const phrases = translateNowArray(`assistant.tool.phrasing.${set}`)

  return phrases.length ? phrases[hashSeed(seed) % phrases.length] : null
}

/**
 * Rotating pending title for a tool with its own phrasing set, or null when
 * the tool has no set / the phrase needs a detail we don't have (caller then
 * falls through to the existing title logic).
 */
export function listedProductPhrasing(toolName: string, toolCallId: string, detail: string): string | null {
  const set = SET_BY_TOOL[toolName]

  if (!set) {
    return null
  }

  const phrase = pickPhrase(set, toolCallId)

  if (!phrase) {
    return null
  }

  if ((phrase.includes('{query}') || phrase.includes('{file}')) && !detail.trim()) {
    return null
  }

  return phrase.replaceAll('{query}', detail).replaceAll('{file}', detail)
}

/** Generic rotating pending line for tools without their own set. */
export function genericProductPhrasing(toolCallId: string): string | null {
  return pickPhrase('fallback', toolCallId)
}
