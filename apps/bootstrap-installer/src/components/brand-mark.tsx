import okvevoMark from '../../../../brand/assets/apps/desktop/public/okvevo.png'
import { cn } from '../lib/utils'

// Brand badge: OkVevo mark from brand/assets (not upstream nous-girl).
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('inline-flex size-14 shrink-0 items-center justify-center', className)} {...props}>
      <img alt="" className="size-full object-contain" src={okvevoMark} />
    </span>
  )
}
