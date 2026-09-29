import { Sidebar } from '@/components/layout/Sidebar'
import { Header }  from '@/components/layout/Header'
import type { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
}

/**
 * Root authenticated app layout.
 * RTL: sidebar on the right (logical end), content on the left (logical start).
 * Uses CSS logical properties via Tailwind to be RTL-correct.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — in RTL this renders on the right */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
