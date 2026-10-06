import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { requestForOwnedSession } from '@/store/session-states'

interface SubagentControlsProps {
  sessionId: string
  subagentId: string
}

/**
 * Steer or stop a running sub-task from the composer stack.
 * The stack only lists sub-tasks that are running or queued.
 */
export function SubagentControls({ sessionId, subagentId }: SubagentControlsProps) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async (action: 'interrupt' | 'steer', message?: string) => {
    setBusy(true)
    setNote(null)

    try {
      const result = await requestForOwnedSession<{ found?: boolean; status?: string }>(
        sessionId,
        async () => {
          throw new Error(t.agents.requestRejected)
        },
        `subagent.${action}`,
        {
          session_id: sessionId,
          subagent_id: subagentId,
          ...(message ? { text: message } : {})
        }
      )

      if (action === 'steer' && result?.status === 'queued') {
        setText('')
        setNote(t.agents.steerQueued)
      } else if (action === 'interrupt' && result?.found) {
        setNote(t.agents.stopRequested)
      } else {
        setNote(t.agents.requestRejected)
      }
    } catch {
      setNote(t.agents.requestRejected)
    } finally {
      setBusy(false)
    }
  }

  const onSteer = (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()

    if (message) {
      void send('steer', message)
    }
  }

  return (
    <form className="flex items-center gap-1 px-2 pb-1" onSubmit={onSteer}>
      <Input
        aria-label={t.agents.steerPlaceholder}
        className="h-6 text-xs"
        disabled={busy}
        onChange={event => setText(event.target.value)}
        placeholder={t.agents.steerPlaceholder}
        value={text}
      />
      <Button disabled={busy || !text.trim()} size="xs" type="submit" variant="text">
        {t.agents.steer}
      </Button>
      <Button disabled={busy} onClick={() => void send('interrupt')} size="xs" type="button" variant="text">
        {t.statusStack.stop}
      </Button>
      {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}
    </form>
  )
}
