import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/build-channel', () => ({
  isByokChromeVisible: () => false
}))

import { technicalTrace, technicalTracePaint } from '@/components/assistant-ui/tool/fallback'
import { summarizeToolRun } from '@/components/assistant-ui/tool/run-summary'
import { readableError } from '@/store/notifications'

import { paintToolSurface } from './display-path'
import { publicErrorText, scrubUserFacingText } from './user-facing-error'

const PATH = '/Users/karan/.hermes/cache/generated/images/x.png'

describe('tool surfaces', () => {
  it('keeps hermes out of every painted surface', () => {
    const samples = {
      title: paintToolSurface(PATH).prose,
      dump: technicalTrace(undefined, PATH),
      snippet: paintToolSurface(`found ${PATH} in the notes`).prose,
      summary: summarizeToolRun(
        [{ toolName: 'terminal', args: { command: `cp ${PATH} /tmp/x.png` } }],
        true
      ),
      error: publicErrorText(PATH),
      toast: readableError(PATH, 'Something went wrong').message,
      tooltip: scrubUserFacingText(PATH)
    }

    for (const [label, text] of Object.entries(samples)) {
      expect(text.toLowerCase(), label).not.toMatch(/hermes/)
    }
  })

  it('turns a MEDIA line into a player path and hides the directive', () => {
    const painted = paintToolSurface(`MEDIA:${PATH}`)

    expect(painted.mediaPaths).toEqual([PATH])
    expect(painted.prose).not.toMatch(/MEDIA:/)
    expect(painted.prose.toLowerCase()).not.toMatch(/hermes/)

    const dump = technicalTracePaint(undefined, `MEDIA:${PATH}`)

    expect(dump.mediaPaths).toEqual([PATH])
    expect(dump.prose).not.toMatch(/MEDIA:/)
    expect(dump.prose.toLowerCase()).not.toMatch(/hermes/)
  })
})
