import { useEffect, useMemo, useState } from 'react'

import { capitalize, normalize } from '@/lib/text'
import { useOkvevoAuth, type OkvevoAuthPublic } from '@/store/okvevo-auth'

import introCopyJsonl from './intro-copy.jsonl?raw'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'What are we moving today?',
    body: "Send a bug, branch, plan, or rough idea. I'll inspect the repo and turn it into the next concrete step."
  },
  {
    headline: "What's on your mind?",
    body: "Bring the code, question, or stuck part. I'll read the room before making changes."
  },
  {
    headline: 'What should Nia look at?',
    body: "Send the task, failing path, or half-formed plan. I'll help turn it into action."
  },
  {
    headline: 'Where should we start?',
    body: "Bring the problem, goal, or file. I'll inspect first and keep the next step concrete."
  },
  {
    headline: 'What needs attention?',
    body: "Send the context you have. I'll help sort it into a plan or a fix."
  }
]

function normalizeKey(value?: string): string {
  return normalize(value)
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

function neutralCopy(): IntroCopy[] {
  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: "Send the task, file, or rough idea. I'll use your configured voice and keep the work grounded in this repo."
    },
    {
      headline: `What does ${label} Nia need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} Nia tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

function resolveCopy(personality?: string, seed?: number): IntroCopy {
  const personalityKey = normalizeKey(personality)

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
    : INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey)

  return pickCopy(copies, seed)
}

/** Italic line under the composer on the empty splash. */
export function resolveIntroSubtitle(personality?: string, seed?: number): string {
  return resolveCopy(personality, seed).body
}

/**
 * Splash name from OkVevo only — never a hardcoded person.
 * displayName → email → empty (greeting omits the name clause).
 */
export function resolveSplashUserName(auth: Pick<OkvevoAuthPublic, 'displayName' | 'email'>): string {
  const name = auth.displayName?.trim()

  if (name) {
    return name
  }

  return auth.email?.trim() || ''
}

const TYPE_MS = 45

function useTypewriter(fullText: string, resetKey: string): number {
  const [visible, setVisible] = useState(0)

  useEffect(() => {
    setVisible(0)

    if (!fullText) {
      return
    }

    const id = window.setInterval(() => {
      setVisible(n => {
        if (n >= fullText.length) {
          window.clearInterval(id)

          return n
        }

        return n + 1
      })
    }, TYPE_MS)

    return () => window.clearInterval(id)
  }, [fullText, resetKey])

  return visible
}

/** Empty-chat splash: GIF on top; brief typewriter greeting under it. */
export function Intro(_props: IntroProps = {}) {
  const auth = useOkvevoAuth()
  const userName = resolveSplashUserName(auth)

  const script = useMemo(() => {
    if (userName) {
      const before = 'Hi '
      const mid = ", I'm "
      const after = '.'
      const hi = `${before}${userName}${mid}Nia${after}`

      return { hi, before, name: userName, mid, after }
    }

    const before = "Hi, I'm "
    const hi = `${before}Nia.`

    return { hi, before, name: '', mid: '', after: '.' }
  }, [userName])

  const visible = useTypewriter(script.hi, script.hi)

  let cursor = 0
  const take = (chunk: string) => {
    const start = cursor
    cursor += chunk.length
    if (visible <= start) {
      return ''
    }

    return chunk.slice(0, Math.max(0, visible - start))
  }

  const shownBefore = take(script.before)
  const shownName = take(script.name)
  const shownMid = take(script.mid)
  const shownNia = take('Nia')
  const shownAfter = take(script.after)

  return (
    <div
      className="pointer-events-none flex w-full min-w-0 flex-col items-center justify-center gap-2.5 px-0.5 py-6 text-center sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <img
        alt=""
        className="size-20 rounded-[1.75rem] object-cover sm:size-24 sm:rounded-[2rem] [image-rendering:pixelated]"
        src={assetPath('nia-intro.gif')}
      />

      <p
        aria-label={script.hi}
        className="intro-splash-line m-0 max-w-[24rem] text-[length:1.55rem] font-bold leading-[1.15] tracking-tight sm:max-w-[28rem] sm:text-[length:1.85rem]"
      >
        {shownBefore ? <span className="intro-splash-rest">{shownBefore}</span> : null}
        {shownName ? <span className="intro-splash-name">{shownName}</span> : null}
        {shownMid ? <span className="intro-splash-rest">{shownMid}</span> : null}
        {shownNia ? <span className="intro-splash-name">{shownNia}</span> : null}
        {shownAfter ? <span className="intro-splash-rest">{shownAfter}</span> : null}
        {visible < script.hi.length ? (
          <span
            aria-hidden
            className="intro-splash-caret ml-0.5 inline-block h-[1.05em] w-[0.18em] translate-y-[0.12em] align-baseline"
          />
        ) : null}
      </p>
    </div>
  )
}
