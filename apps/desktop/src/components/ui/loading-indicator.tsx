import 'ldrs/react/TailChase.css'

import { TailChase } from 'ldrs/react'

import { prefersReducedMotion } from '@/hooks/use-media-query'

const DEFAULT_SIZE = 50
const DEFAULT_SPEED = 1.8
const DEFAULT_COLOR = 'var(--theme-primary)'

interface LoadingIndicatorProps {
  'aria-label'?: string
  color?: string
  size?: number
  speed?: number
}

export function LoadingIndicator({
  'aria-label': ariaLabel = 'Loading',
  color = DEFAULT_COLOR,
  size = DEFAULT_SIZE,
  speed = DEFAULT_SPEED
}: LoadingIndicatorProps) {
  if (prefersReducedMotion()) {
    return (
      <span className="inline-grid place-items-center" role="status" style={{ width: size, height: size }}>
        <span className="sr-only">{ariaLabel}</span>
        <span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} />
      </span>
    )
  }

  return (
    <span role="status">
      <span className="sr-only">{ariaLabel}</span>
      <TailChase color={color} size={size} speed={speed} />
    </span>
  )
}
