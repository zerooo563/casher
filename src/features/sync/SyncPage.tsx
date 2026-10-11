import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProducts,
  fetchCategories,
  fetchUnits,
} from '@/lib/inventoryService'
import {
  publishSharedCatalog,
  pullSharedCatalog,
  fetchSharedCatalogCount,
  type PushProgress,
  type PushResult,
  type PullResult,
} from '@/lib/productSharingService'
import { isSupabaseConfigured } from '@/config/env'
import { toArabicNumerals } from '@/lib/utils'
import {
  CloudUpload,
  CloudDownload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Database,
  MonitorSmartphone,
} from 'lucide-react'

export default function SyncPage() {
  const queryClient = useQueryClient()

  const { data: products = [] } = useQuery({
    queryKey: ['products', 'management'],
    queryFn: () => fetchProducts(true),
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  })
  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: fetchUnits,
  })

  const cloudCountQuery = useQuery({
    queryKey: ['shared-catalog-count'],
    queryFn: fetchSharedCatalogCount,
    enabled: isSupabaseConfigured,
    staleTime: 30 * 1000,
    retry: false,
  })

  const [pushProgress, setPushProgress] = useState<PushProgress | null>(null)
  const [pushResult, setPushResult] = useState<PushResult | null>(null)
  const [pullResult, setPullResult] = useState<PullResult | null>(null)

  const pushMutation = useMutation({
    mutationFn: () =>
      publishSharedCatalog({ products, categories, units }, setPushProgress),
    onSuccess: (result) => {
      setPushResult(result)
      setPushProgress(null)
      void cloudCountQuery.refetch()
    },
    onError: () => {
      setPushProgress(null)
    },
  })

  const pullMutation = useMutation({
    mutationFn: pullSharedCatalog,
    onSuccess: (result) => {
      setPullResult(result)
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['categories'] }),
        queryClient.invalidateQueries({ queryKey: ['units'] }),
      ])
    },
  })

  const activeCount = products.filter((p) => p.is_active).length
  const busy = pushMutation.isPending || pullMutation.isPending

  const handlePush = () => {
    setPushResult(null)
    if (
      window.confirm(
        'سيتم رفع بيانات المنتجات النشطة (الاسم، SKU، الباركود، الأسعار، الصور) إلى الكتالوج السحابي المشترك. لن يُرفع رصيد المخزون أو أي سجل مبيعات. هل تريد المتابعة؟'
      )
    ) {
      pushMutation.mutate()
    }
  }

  const handlePull = () => {
    setPullResult(null)
    if (
      window.confirm(
        'سيتم سحب الكتالوج السحابي المشترك وإدخال المنتجات الناقصة إلى مخزون هذا الجهاز برصيد صفري. المنتجات الموجودة هنا لن تُمس. هل تريد المتابعة؟'
      )
    ) {
      pullMutation.mutate()
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">المزامنة السحابية (مؤقتة)</h1>
        <p className="text-muted-foreground text-sm mt-1">
          مساحة عمل مشتركة بدون حسابات: كل من يملك رابط التطبيق يدخل منتجاته هنا،
          ثم تُسحب إلى كل جهاز. تُستخدم فقط خلال مرحلة تهيئة البيانات (~٥٠٠٠ منتج).
        </p>
      </div>

      {!isSupabaseConfigured && (
        <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300 space-y-1">
          <p className="font-bold flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            <span>المزامنة السحابية غير مهيأة بعد</span>
          </p>
          <p>أضف `VITE_SUPABASE_URL` والمفتاح في ملف `.env.local` ثم أعد تشغيل التطبيق (`npm run dev`).</p>
        </div>
      )}

      {cloudCountQuery.isError && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive">
          تعذر الاتصال بالسحابة: {cloudCountQuery.error instanceof Error ? cloudCountQuery.error.message : 'خطأ غير معروف'}
          {' '}— تأكد من دفع الـ migrations إلى مشروع Supabase أولاً.
        </div>
      )}

      {/* Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex items-center gap-3">
          <span className="p-2.5 bg-primary/10 text-primary rounded-xl">
            <MonitorSmartphone className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground font-semibold">منتجات هذا الجهاز (نشطة)</p>
            <p className="text-2xl font-black text-foreground">{toArabicNumerals(activeCount)}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex items-center gap-3">
          <span className="p-2.5 bg-emerald-500/10 text-emerald-600 rounded-xl">
            <Database className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground font-semibold">منتجات الكتالوج السحابي</p>
            <p className="text-2xl font-black text-foreground">
              {cloudCountQuery.isLoading
                ? '…'
                : cloudCountQuery.data !== undefined
                  ? toArabicNumerals(cloudCountQuery.data)
                  : '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void cloudCountQuery.refetch()}
            disabled={!isSupabaseConfigured || cloudCountQuery.isFetching}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
            title="تحديث العد من السحابة"
          >
            <RefreshCw className={`h-4 w-4 ${cloudCountQuery.isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Push / Pull */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Push */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
          <h2 className="font-bold text-sm text-foreground flex items-center gap-2">
            <CloudUpload className="h-4 w-4 text-primary" />
            <span>دفع: من هذا الجهاز إلى السحابة</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            يرفع المنتجات النشطة بدفعات (٥٠٠ منتج للدفعة). الصور الأكبر من ٥٠٠ كيلوبايت ستفشل — أعد ضغطها من صفحة المنتجات.
          </p>
          <button
            type="button"
            onClick={handlePush}
            disabled={!isSupabaseConfigured || busy || activeCount === 0}
            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pushMutation.isPending ? 'جارٍ الدفع إلى السحابة...' : 'دفع المنتجات إلى السحابة'}
          </button>

          {pushProgress && (
            <div className="space-y-1.5" role="status">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((pushProgress.batch / pushProgress.batches) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                الدفعة {toArabicNumerals(pushProgress.batch)} من {toArabicNumerals(pushProgress.batches)}
                {' '}— تم قبول {toArabicNumerals(pushProgress.processed)} منتج حتى الآن
              </p>
            </div>
          )}

          {pushMutation.isError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {pushMutation.error instanceof Error ? pushMutation.error.message : 'فشل الدفع.'}
            </p>
          )}

          {pushResult && (
            <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                <span>تم قبول {toArabicNumerals(pushResult.processed)} منتج في السحابة</span>
              </p>
              {pushResult.skipped.length > 0 && (
                <p>
                  تُخطّي {toArabicNumerals(pushResult.skipped.length)} منتج لتعارض SKU أو باركود مع صف آخر
                  (وحّدوا الـ SKU والباركود بين الأجهزة ثم أعيدوا الدفع).
                </p>
              )}
            </div>
          )}
        </div>

        {/* Pull */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
          <h2 className="font-bold text-sm text-foreground flex items-center gap-2">
            <CloudDownload className="h-4 w-4 text-emerald-600" />
            <span>سحب: من السحابة إلى هذا الجهاز</span>
          </h2>
          <p className="text-xs text-muted-foreground">
            يُدخل المنتجات الناقصة فقط برصيد صفري. المنتجات الموجودة هنا لا تُمس، والمتعارضة تُتخطّى وتُعرض أدناه.
          </p>
          <button
            type="button"
            onClick={handlePull}
            disabled={!isSupabaseConfigured || busy}
            className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pullMutation.isPending ? 'جارٍ السحب من السحابة...' : 'سحب المنتجات من السحابة'}
          </button>

          {pullMutation.isError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {pullMutation.error instanceof Error ? pullMutation.error.message : 'فشل السحب.'}
            </p>
          )}

          {pullResult && (
            <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                <span>
                  الكتالوج: {toArabicNumerals(pullResult.catalogSize)}
                  {' '}— جديد: {toArabicNumerals(pullResult.created)}
                  {' '}— محدّث: {toArabicNumerals(pullResult.updated)}
                </span>
              </p>
              {pullResult.skipped.length > 0 && (
                <p>
                  تُخطّي {toArabicNumerals(pullResult.skipped.length)} منتج لتعارض SKU أو باركود مع منتج محلي:
                  {' '}{pullResult.skipped.slice(0, 5).join('، ')}
                  {pullResult.skipped.length > 5 ? '…' : ''}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rules */}
      <div className="bg-muted/40 border border-border rounded-xl p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-bold text-foreground">قواعد مرحلة إدخال البيانات:</p>
        <ul className="list-disc ps-5 space-y-1">
          <li>قسّموا المنتجات بين الأجهزة لتجنب إدخال نفس المنتج مرتين.</li>
          <li>نفس المنتج يجب أن يحمل نفس الـ SKU ونفس الباركود على كل الأجهزة — المختلف يُتخطّى.</li>
          <li>لا يُرفع رصيد المخزون ولا سجلات المبيعات أبداً — بيانات المنتج والأسعار والصور فقط.</li>
          <li>المنتجات المسحوبة تبدأ برصيد صفري على كل جهاز.</li>
          <li>بعد انتهاء التهيئة تُعطّل الكتابة السحابية ويبقى كل جهاز مستقلاً (تمهيداً لتطبيق الويندوز).</li>
        </ul>
      </div>
    </div>
  )
}
