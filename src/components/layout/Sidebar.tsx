import { NavLink } from 'react-router-dom'
import {
  ShoppingCart,
  ChevronRight,
  Package,
  History,
} from 'lucide-react'
import { useTenant } from '@/hooks/useTenant'
import { APP_NAME } from '@/config/constants'
import { cn } from '@/lib/utils'

interface NavItem {
  label:  string
  path:   string
  icon:   React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { label: 'شاشة البيع (POS)',      path: '/',          icon: ShoppingCart },
  { label: 'المنتجات والمخزون',     path: '/products',  icon: Package },
  { label: 'سجل حركات المخزون',     path: '/movements', icon: History },
]

export function Sidebar() {
  const { tenant } = useTenant()

  return (
    <aside className="flex flex-col w-60 min-h-screen bg-card border-e border-border shrink-0">

      {/* Brand */}
      <div className="px-4 py-5 border-b border-border">
        <span className="text-xl font-bold text-foreground">{APP_NAME}</span>
        {tenant && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {tenant.name}
          </p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            <ChevronRight className="h-3 w-3 opacity-40 rotate-180" />
          </NavLink>
        ))}
      </nav>

    </aside>
  )
}
