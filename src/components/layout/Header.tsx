import { useTenant } from '@/hooks/useTenant'
import { toArabicNumerals } from '@/lib/utils'

export function Header() {
  const { tenant } = useTenant()

  const now = new Date()
  const dateStr = new Intl.DateTimeFormat('ar', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  }).format(now)

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
      {/* Date */}
      <span className="text-sm text-muted-foreground">
        {toArabicNumerals(dateStr)}
      </span>

      {/* Currency badge */}
      {tenant && (
        <span className="text-xs font-medium bg-muted text-muted-foreground rounded px-2 py-1">
          {tenant.settings.currency} {tenant.settings.currency_symbol}
        </span>
      )}
    </header>
  )
}
