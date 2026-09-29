import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AppShell }        from '@/components/layout/AppShell'
import { ROUTES }          from '@/config/constants'

// Lazy load pages for code splitting
const DashboardPage  = lazy(() => import('@/features/dashboard/DashboardPage'))
const ProductsPage   = lazy(() => import('@/features/inventory/ProductsPage'))
const MovementsPage  = lazy(() => import('@/features/inventory/MovementsPage'))

// Loading fallback (used during lazy chunk load)
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full min-h-32">
      <span className="text-muted-foreground text-sm animate-pulse">جارٍ التحميل...</span>
    </div>
  )
}

const router = createBrowserRouter([
  // Local inventory routes — no account is required.
  {
    path: '/',
    element: (
      <AppShell>
        <Suspense fallback={<PageLoader />}>
          <DashboardPage />
        </Suspense>
      </AppShell>
    ),
  },
  {
    path: '/products',
    element: (
      <AppShell>
        <Suspense fallback={<PageLoader />}>
          <ProductsPage />
        </Suspense>
      </AppShell>
    ),
  },
  {
    path: '/movements',
    element: (
      <AppShell>
        <Suspense fallback={<PageLoader />}>
          <MovementsPage />
        </Suspense>
      </AppShell>
    ),
  },

  // 404 fallback
  {
    path: '*',
    element: <Navigate to={ROUTES.DASHBOARD} replace />,
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
