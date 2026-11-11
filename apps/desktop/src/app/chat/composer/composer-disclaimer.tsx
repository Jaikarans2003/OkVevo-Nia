import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export const COMPOSER_DISCLAIMER_CLASS =
  'mt-1.5 pb-1 text-center text-[0.6875rem] leading-snug text-(--ui-text-tertiary)'

export function ComposerDisclaimer({ show }: { show: boolean }) {
  const { t } = useI18n()

  if (!show) {
    return null
  }

  return (
    <p className={cn(COMPOSER_DISCLAIMER_CLASS)} data-slot="composer-disclaimer">
      {t.composer.disclaimer}
    </p>
  )
}
