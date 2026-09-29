import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthContext } from '@/features/auth/authContext'
import { loginSchema, type LoginFormData } from '@/features/auth/authSchema'
import { APP_NAME } from '@/config/constants'
import { isSupabaseConfigured } from '@/config/env'

export default function LoginPage() {
  const { signIn, signInDemo } = useAuthContext()
  const navigate    = useNavigate()
  const location    = useLocation()
  const [serverError, setServerError] = useState<string | null>(null)

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/'

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null)
    const { error } = await signIn(data.email, data.password)
    if (error) {
      setServerError('البريد الإلكتروني أو كلمة المرور غير صحيحة')
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">
            {APP_NAME}
          </h1>
          <p className="text-muted-foreground text-sm mt-2">
            نظام إدارة نقاط البيع والمحاسبة
          </p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-6 text-foreground">
            تسجيل الدخول
          </h2>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">

            {/* Email */}
            <div className="space-y-1">
              <label
                htmlFor="email"
                className="text-sm font-medium text-foreground"
              >
                البريد الإلكتروني
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                dir="ltr"
                placeholder="admin@example.com"
                {...register('email')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 ltr:text-left rtl:text-right"
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label
                htmlFor="password"
                className="text-sm font-medium text-foreground"
              >
                كلمة المرور
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                dir="ltr"
                placeholder="••••••••"
                {...register('password')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50"
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            {/* Supabase connection warning */}
            {!isSupabaseConfigured && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-semibold">تنبيه إعداد السحابة (Supabase Cloud):</p>
                <p>يرجى إضافة مفاتيح المشروع في ملف <code className="bg-muted px-1 rounded">.env.local</code>:</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] font-mono" dir="ltr">
                  <li>VITE_SUPABASE_URL</li>
                  <li>VITE_SUPABASE_PUBLISHABLE_KEY</li>
                </ul>
              </div>
            )}

            {/* Server Error */}
            {serverError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2">
                <p className="text-sm text-destructive">{serverError}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول'}
            </button>

            {/* Demo Preview Option */}
            <div className="pt-2">
              <div className="relative my-3">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[11px]">
                  <span className="bg-card px-2 text-muted-foreground">أو للمعاينة السريعة</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  signInDemo()
                  navigate(from, { replace: true })
                }}
                className="w-full rounded-md border border-input bg-muted/60 hover:bg-muted text-foreground px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <span>دخول تجريبي فوري (معاينة الواجهة)</span>
                <span className="text-xs">⚡</span>
              </button>
            </div>

          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          {APP_NAME} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
