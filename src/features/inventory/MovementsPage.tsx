import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveLedgerMonth,
  compactArchivedLedgerMonth,
  clearLedgerMonthArchives,
  fetchLedgerMonthArchives,
  fetchInventoryCapital,
  fetchSalesProfitSummary,
  fetchStockMovements,
  type LedgerMonthArchive,
  type StockMovementRecord,
} from '@/lib/inventoryService'
import { toArabicNumerals, formatCurrency } from '@/lib/utils'
import { printDocument } from '@/lib/printDocument'
import { useTenant } from '@/hooks/useTenant'
import { APP_NAME } from '@/config/constants'
import {
  ArrowDownRight,
  ArrowUpLeft,
  Layers,
  Calendar,
  ArrowLeft,
  Printer,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  ReceiptText,
} from 'lucide-react'
import { Link } from 'react-router-dom'

function localDateTimeBound(date: string, time: string, isEnd: boolean): Date | null {
  if (!date) return null
  const bound = new Date(`${date}T${time || (isEnd ? '23:59:59.999' : '00:00:00')}`)
  if (Number.isNaN(bound.getTime())) return null
  if (isEnd && time) bound.setSeconds(59, 999)
  return bound
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function MovementsPage() {
  const { tenant } = useTenant()
  const queryClient = useQueryClient()
  const previousMonth = new Date()
  previousMonth.setDate(1)
  previousMonth.setMonth(previousMonth.getMonth() - 1)
  const [filterType, setFilterType] = useState<string>('all')
  const [startDate, setStartDate] = useState<string>('')
  const [startTime, setStartTime] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [endTime, setEndTime] = useState<string>('')
  const [dismissMonthReminder, setDismissMonthReminder] = useState(false)
  const [archiveMonth, setArchiveMonth] = useState(formatLocalDate(previousMonth).slice(0, 7))
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archivedMonth, setArchivedMonth] = useState<string | null>(null)
  const [archiveClearError, setArchiveClearError] = useState<string | null>(null)

  const currencySymbol = tenant?.settings.currency_symbol ?? '₪'
  const storeName = tenant?.name ?? APP_NAME

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['stock_movements'],
    queryFn: () => fetchStockMovements(),
  })

  const startBound = localDateTimeBound(startDate, startTime, false)
  const endBound = localDateTimeBound(endDate, endTime, true)
  const startAt = startBound?.toISOString()
  const endAt = endBound?.toISOString()
  const {
    data: profitSummary,
    isLoading: isProfitLoading,
    isError: isProfitError,
  } = useQuery({
    queryKey: ['sales_profit_summary', startAt, endAt],
    queryFn: () => fetchSalesProfitSummary(startAt, endAt),
  })
  const {
    data: inventoryCapital = 0,
    isLoading: isCapitalLoading,
    isError: isCapitalError,
  } = useQuery({
    queryKey: ['inventory_capital'],
    queryFn: fetchInventoryCapital,
  })
  const today = new Date()
  const currentMonth = formatLocalDate(today).slice(0, 7)
  const daysUntilMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate()
  const monthReminderKind = today.getDate() <= 3
    ? 'start'
    : daysUntilMonthEnd <= 3
    ? 'end'
    : null
  const { data: monthArchives = [] } = useQuery({
    queryKey: ['ledger_month_archives'],
    queryFn: fetchLedgerMonthArchives,
  })
  const fullMonthArchive = (() => {
    if (startTime || endTime || !startDate || !endDate) return undefined
    const [year, month] = startDate.split('-').map(Number)
    if (!year || !month || month > 12) return undefined
    const monthKey = `${year}-${String(month).padStart(2, '0')}`
    const lastDay = String(new Date(year, month, 0).getDate()).padStart(2, '0')
    if (startDate !== `${monthKey}-01` || endDate !== `${monthKey}-${lastDay}`) return undefined
    return monthArchives.find((archive) => archive.month === monthKey)
  })()
  const effectiveFilterType = fullMonthArchive?.movement_details_removed ? 'all' : filterType
  const selectedArchive = monthArchives.find((archive) => archive.month === archiveMonth)
  const archiveMutation = useMutation({
    mutationFn: () => archiveLedgerMonth({ month: archiveMonth }),
    onSuccess: (archive) => {
      setArchiveError(null)
      setArchivedMonth(archive.month)
      void queryClient.invalidateQueries({ queryKey: ['ledger_month_archives'] })
    },
    onError: (error) => {
      setArchiveError(error instanceof Error ? error.message : String(error))
    },
  })
  const compactMutation = useMutation({
    mutationFn: () => compactArchivedLedgerMonth({ month: archiveMonth }),
    onSuccess: (deletedCount) => {
      setArchiveError(null)
      setArchivedMonth(archiveMonth)
      alert(`تم ضغط الأرشيف وإزالة ${toArabicNumerals(deletedCount)} حركة تفصيلية؛ رصيد المخزون محفوظ.`)
      void queryClient.invalidateQueries({ queryKey: ['ledger_month_archives'] })
      void queryClient.invalidateQueries({ queryKey: ['stock_movements'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory_capital'] })
    },
    onError: (error) => {
      setArchiveError(error instanceof Error ? error.message : String(error))
    },
  })
  const clearArchivesMutation = useMutation({
    mutationFn: clearLedgerMonthArchives,
    onSuccess: (deletedCount) => {
      setArchiveClearError(null)
      setArchivedMonth(null)
      void queryClient.invalidateQueries({ queryKey: ['ledger_month_archives'] })
      alert(`تم مسح ${toArabicNumerals(deletedCount)} أرشيف. لم يتم حذف الحركات أو الفواتير.`)
    },
    onError: (error) => {
      setArchiveClearError(error instanceof Error ? error.message : String(error))
    },
  })

  const profitCaveat = [
    profitSummary?.estimatedCostItems
      ? `تكلفة ${toArabicNumerals(profitSummary.estimatedCostItems)} بند تاريخي تقديرية من سعر المنتج الحالي.`
      : '',
    profitSummary?.unknownCostItems
      ? `تكلفة ${toArabicNumerals(profitSummary.unknownCostItems)} بند غير متاحة، لذلك الرقم جزئي ولا يشملها.`
      : '',
  ].filter(Boolean).join(' ')
  const profitDefinition =
    'ربح المبيعات = صافي المبيعات بعد توزيع خصم الفاتورة نسبيًا − تكلفة البضاعة المباعة (COGS). لا يشمل المصاريف التشغيلية أو الضرائب غير المسجلة؛ لذلك لا يمثل صافي الدخل المحاسبي.'

  // Date presets helper
  const applyDatePreset = (preset: 'today' | 'week' | 'month' | 'all') => {
    const now = new Date()

    if (preset === 'today') {
      const todayStr = formatLocalDate(now)
      setStartDate(todayStr)
      setEndDate(todayStr)
    } else if (preset === 'week') {
      const weekAgo = new Date()
      weekAgo.setDate(now.getDate() - 7)
      setStartDate(formatLocalDate(weekAgo))
      setEndDate(formatLocalDate(now))
    } else if (preset === 'month') {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      setStartDate(formatLocalDate(firstOfMonth))
      setEndDate(formatLocalDate(now))
    } else {
      setStartDate('')
      setEndDate('')
    }
    setStartTime('')
    setEndTime('')
  }

  // Filtered movements based on type and custom date range
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      // Type filter
      if (effectiveFilterType !== 'all' && m.movement_type !== effectiveFilterType) {
        return false
      }

      // Date range filter
      if (startBound) {
        if (new Date(m.created_at) < startBound) return false
      }

      if (endBound) {
        if (new Date(m.created_at) > endBound) return false
      }

      return true
    })
  }, [movements, effectiveFilterType, startBound, endBound])

  // Summary figures for filtered dataset
  const summary = useMemo(() => {
    let inQty = 0
    let soldQty = 0

    for (const m of filteredMovements) {
      if (m.quantity > 0) {
        if (m.movement_type !== 'month_checkpoint') inQty += m.quantity
      }
      if (m.movement_type === 'sale') {
        soldQty += Math.abs(m.quantity)
      }
    }

    return {
      count: filteredMovements.length,
      inQty,
      soldQty,
    }
  }, [filteredMovements])
  const reportSummary = fullMonthArchive && (filterType === 'all' || fullMonthArchive.movement_details_removed)
    ? {
        count: fullMonthArchive.movements_count,
        inQty: fullMonthArchive.added_quantity,
        soldQty: fullMonthArchive.sold_quantity,
      }
    : summary
  const reportCapital = fullMonthArchive?.inventory_capital ?? inventoryCapital

  const typeLabels: Record<string, { label: string; color: string }> = {
    opening:          { label: 'رصيد افتتاحي', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20' },
    adjustment_in:    { label: 'تسوية إضافة',  color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
    adjustment_out:   { label: 'تسوية خصم',    color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20' },
    purchase_receipt: { label: 'استلام مشتريات', color: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20' },
    sale:             { label: 'فاتورة بيع',    color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
    transfer_in:      { label: 'تحويل وارد',    color: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20' },
    transfer_out:     { label: 'تحويل صادر',    color: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
    month_checkpoint: { label: 'رصيد مجمع مؤرشف', color: 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20' },
  }

  // Print report to PDF or Paper
  const handlePrintLedger = () => {
    if (!profitSummary || isProfitLoading || isProfitError || isCapitalLoading || isCapitalError) {
      alert('تعذر تجهيز التقرير قبل اكتمال حساب الربح وقيمة المخزون.')
      return
    }

    const nowFormatted = new Date().toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const periodLabel =
      startDate && endDate
        ? `من ${startDate} ${startTime || '00:00'} إلى ${endDate} ${endTime || '23:59'}`
        : startDate
        ? `من ${startDate} ${startTime || '00:00'}`
        : endDate
        ? `حتى ${endDate} ${endTime || '23:59'}`
        : 'جميع المعاملات المسجلة'

    const filterTypeLabel =
      fullMonthArchive?.movement_details_removed
        ? 'ملخص الأرشيف؛ تفاصيل الأنواع مضغوطة'
        : filterType === 'all'
        ? 'جميع أنواع الحركات'
        : typeLabels[filterType]?.label ?? filterType
    const archiveNote = fullMonthArchive?.movement_details_removed
      ? 'تم ضغط تفاصيل حركات الشهر بعد حفظ الأرشيف؛ يعرض التقرير الملخص الأصلي المحفوظ.'
      : ''

    const htmlContent = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <title>تقرير حركات المخزون - ${storeName}</title>
  <style>
    @media print {
      @page {
        size: A4 landscape;
        margin: 10mm;
      }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print { display: none !important; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'IBM Plex Arabic', Arial, sans-serif;
      direction: rtl;
      background: #fff;
      color: #111;
      padding: 16px;
      font-size: 11px;
      line-height: 1.4;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .header h1 { font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 3px; }
    .header p { font-size: 12px; color: #475569; }
    .meta-box {
      text-align: left;
      font-size: 11px;
      color: #334155;
      line-height: 1.6;
    }
    .meta-box strong { color: #0f172a; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 10px;
      margin-bottom: 14px;
    }
    .summary-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 12px;
      text-align: center;
    }
    .summary-card .label { font-size: 10px; color: #64748b; margin-bottom: 2px; }
    .summary-card .val { font-size: 14px; font-weight: bold; color: #0f172a; font-family: monospace; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    thead th {
      background: #f1f5f9;
      color: #0f172a;
      font-weight: 700;
      padding: 7px 6px;
      border: 1px solid #cbd5e1;
      text-align: right;
    }
    tbody td {
      padding: 6px;
      border: 1px solid #e2e8f0;
      text-align: right;
    }
    tbody tr:nth-child(even) { background: #fafafa; }
    tbody tr { page-break-inside: avoid; }
    .qty-in { color: #059669; font-weight: bold; font-family: monospace; }
    .qty-out { color: #dc2626; font-weight: bold; font-family: monospace; }
    .price { font-family: monospace; }
    .footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px dashed #cbd5e1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: #64748b;
    }
    .signature-area {
      display: flex;
      gap: 60px;
      margin-top: 20px;
      font-size: 11px;
    }
    .signature-line {
      border-top: 1px solid #94a3b8;
      width: 140px;
      margin-top: 30px;
      text-align: center;
      padding-top: 4px;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${storeName}</h1>
      <p>تقرير سجل حركات المخزون (Inventory Ledger Report)</p>
    </div>
    <div class="meta-box">
      <div><strong>الفترة المحددة:</strong> ${periodLabel}</div>
      <div><strong>نوع التصفية:</strong> ${filterTypeLabel}</div>
      <div><strong>تاريخ الاستخراج:</strong> ${nowFormatted}</div>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="label">إجمالي عدد الحركات</div>
      <div class="val">${toArabicNumerals(reportSummary.count)}</div>
    </div>
    <div class="summary-card">
      <div class="label">إجمالي ما تم إضافته</div>
      <div class="val" style="color: #059669;">+${toArabicNumerals(reportSummary.inQty)}</div>
    </div>
    <div class="summary-card">
      <div class="label">إجمالي القطع التي تم بيعها</div>
      <div class="val" style="color: #059669;">${toArabicNumerals(reportSummary.soldQty)}</div>
    </div>
    <div class="summary-card">
      <div class="label">رأس مال المشروع</div>
      <div class="val">${formatCurrency(reportCapital, 'ILS', currencySymbol, false)}</div>
    </div>
    <div class="summary-card">
      <div class="label">صافي الربح</div>
      <div class="val">${formatCurrency(profitSummary?.netProfit ?? 0, 'ILS', currencySymbol, false)}</div>
    </div>
  </div>
  <p style="color:#475569; margin: -6px 0 12px; font-size:10px;">
    ${profitDefinition} قيمة رأس المال هي تقييم المخزون المسجل عند إقفال الشهر باستخدام تكلفة المنتجات المتاحة وقت الأرشفة. ${archiveNote} ${profitCaveat}
  </p>

  <table>
    <thead>
      <tr>
        <th style="width: 35px; text-align: center;">#</th>
        <th>التاريخ والوقت</th>
        <th>اسم الصنف</th>
        <th>المستودع</th>
        <th>نوع الحركة</th>
        <th style="text-align: center;">الكمية</th>
        <th>سعر الوحدة</th>
        <th>القيمة الإجمالية</th>
        <th>ملاحظات</th>
      </tr>
    </thead>
    <tbody>
      ${filteredMovements
        .map((m: StockMovementRecord, idx: number) => {
          const isPos = m.quantity > 0
          const typeName = typeLabels[m.movement_type]?.label ?? m.movement_type
          const dateStr = new Date(m.created_at).toLocaleString('ar-SA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
          return `
            <tr>
              <td style="text-align: center; color: #64748b;">${idx + 1}</td>
              <td style="font-size: 10px;">${toArabicNumerals(dateStr)}</td>
              <td><strong>${m.product_name}</strong></td>
              <td>${m.warehouse_name}</td>
              <td>${typeName}</td>
              <td style="text-align: center;" class="${isPos ? 'qty-in' : 'qty-out'}">
                ${isPos ? '+' : ''}${toArabicNumerals(m.quantity)}
              </td>
              <td class="price">${formatCurrency(m.unit_cost, 'ILS', currencySymbol, false)}</td>
              <td class="price" style="font-weight: bold;">${formatCurrency(m.total_cost, 'ILS', currencySymbol, false)}</td>
              <td style="color: #64748b;">${m.notes || '—'}</td>
            </tr>
          `
        })
        .join('')}
    </tbody>
  </table>

  <div class="signature-area">
    <div>
      <span>توقيع مسؤول المخزن:</span>
      <div class="signature-line">التوقيع / الختم</div>
    </div>
    <div>
      <span>اعتماد الإدارة:</span>
      <div class="signature-line">التوقيع / التاريخ</div>
    </div>
  </div>

  <div class="footer">
    <span>يرجى حفظ نسخة من تقرير السجلات وإرسالها للعميل عند الحاجة. السجلات الأصلية محفوظة ولا تُحذف تلقائيًا.</span>
    <span>صفحة تقرير رسمية</span>
  </div>

</body>
</html>`

    printDocument(htmlContent, () => {
      alert('تعذر تشغيل طباعة التقرير. تحقق من أن المتصفح يسمح بالطباعة.')
    })
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/products" className="hover:text-foreground flex items-center gap-1 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>العودة للمنتجات</span>
            </Link>
            <span>/</span>
            <span>سجل المعاملات</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">سجل حركات المخزون (Ledger)</h1>
          <p className="text-muted-foreground text-sm mt-1">
            سجل تدقيق تراكمي وغير قابل للتعديل (Append-only Ledger) لجميع حركات الإدخال والإخراج
          </p>
        </div>

        {/* Print / Export PDF button */}
        <button
          type="button"
          onClick={handlePrintLedger}
          disabled={isLoading || isProfitLoading || isProfitError || isCapitalLoading || isCapitalError || filteredMovements.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50 shrink-0"
          title="طباعة تقرير السجلات للعميل أو حفظه بصيغة PDF"
        >
          <Printer className="h-4 w-4" />
          <span>طباعة تقرير السجلات (PDF)</span>
        </button>
      </div>

      {monthReminderKind && !dismissMonthReminder && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <div>
            <p className="font-bold text-amber-800 dark:text-amber-300">
              {monthReminderKind === 'end' ? 'اقتربت نهاية الشهر' : 'بدأ شهر جديد'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              يرجى مراجعة سجلات الشهر وطباعتها أو حفظها PDF وإرسال نسخة للعميل. لا يحدث حذف تلقائي؛ يمكن ضغط التفاصيل يدويًا بعد حفظ الأرشيف.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => applyDatePreset('month')}
              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
            >
              عرض سجلات هذا الشهر
            </button>
            <button
              type="button"
              onClick={() => setDismissMonthReminder(true)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium"
            >
              إخفاء
            </button>
          </div>
        </div>
      )}

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-bold text-foreground">إقفال الشهر وأرشفة نسخة</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            تحفظ الأرشفة ملخص الشهر ورصيد المخزون المحسوب حتى نهايته. لا تحذف الحركات أو الفواتير أو الأرباح الأصلية ولا تغيّر المخزون الحالي.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="archive-month" className="text-xs font-medium text-foreground">
            الشهر المكتمل:
          </label>
          <input
            id="archive-month"
            type="month"
            lang="ar"
            max={currentMonth}
            value={archiveMonth}
            onChange={(event) => {
              setArchiveMonth(event.target.value)
              setArchiveError(null)
              setArchivedMonth(null)
            }}
            className="rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono"
          />
          <button
            type="button"
            onClick={() => {
              const accepted = window.confirm(
                `أرشفة ملخص ${archiveMonth} ولقطة المخزون دون حذف أو تعديل أي سجل أصلي؟`
              )
              if (accepted) archiveMutation.mutate()
            }}
            disabled={
              !archiveMonth ||
              archiveMonth >= currentMonth ||
              archiveMutation.isPending ||
              monthArchives.some((archive) => archive.month === archiveMonth)
            }
            className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {archiveMutation.isPending ? 'جارٍ حفظ الأرشيف...' : 'تأكيد إقفال وأرشفة الشهر'}
          </button>
          {selectedArchive && !selectedArchive.movement_details_removed && (
            <button
              type="button"
              onClick={() => {
                const accepted = window.confirm(
                  `تحذير نهائي: حذف تفاصيل الحركات اليومية لشهر ${archiveMonth} بعد التأكد من وجود الأرشيف؟ سيبقى ملخص الشهر ولقطة أرصدة المنتجات، كما ستبقى الفواتير وبنود البيع والربح. لا يمكن استعادة تفاصيل الحركات بعد ذلك.`
                )
                if (accepted) compactMutation.mutate()
              }}
              disabled={compactMutation.isPending}
              className="rounded-lg border border-destructive/40 px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/5 disabled:opacity-50"
            >
              {compactMutation.isPending ? 'جارٍ ضغط التفاصيل...' : 'حذف التفاصيل بعد الأرشفة'}
            </button>
          )}
          {selectedArchive?.movement_details_removed && (
            <span className="text-xs text-muted-foreground">تم ضغط تفاصيل هذا الشهر مسبقًا.</span>
          )}
          {archiveError && <span className="text-xs text-destructive" role="alert">{archiveError}</span>}
          {archivedMonth && (
            <span className="text-xs font-medium text-emerald-700" role="status">
              تم حفظ أرشيف {archivedMonth} دون حذف البيانات الأصلية.
            </span>
          )}
        </div>
        {monthArchives.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => {
                const accepted = window.confirm(
                  'مسح جميع ملخصات الأرشيف ولقطات المخزون؟ لن تُحذف حركات المخزون أو الفواتير. لا يمكن مسح الأرشيف إذا كانت تفاصيل شهر مضغوطة لأن ملخصه ولقطته هما النسخة الوحيدة الباقية.'
                )
                if (accepted) clearArchivesMutation.mutate()
              }}
              disabled={clearArchivesMutation.isPending}
              className="rounded-lg border border-destructive/40 px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/5 disabled:opacity-50"
            >
              {clearArchivesMutation.isPending ? 'جارٍ مسح الأرشيف...' : 'مسح الأرشيف'}
            </button>
            {archiveClearError && (
              <span className="text-xs text-destructive" role="alert">{archiveClearError}</span>
            )}
          </div>
        )}
        {monthArchives.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="py-2 pl-3">الشهر المؤرشف</th>
                  <th className="py-2 pl-3">الحركات</th>
                  <th className="py-2 pl-3">المضاف</th>
                  <th className="py-2 pl-3">المباع</th>
                  <th className="py-2 pl-3">قيمة المخزون</th>
                  <th className="py-2">ربح المبيعات</th>
                  <th className="py-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {monthArchives.map((archive: LedgerMonthArchive) => (
                  <tr key={archive.month} className="border-b border-border/60">
                    <td className="py-2 pl-3">{archive.month}</td>
                    <td className="py-2 pl-3">{toArabicNumerals(archive.movements_count)}</td>
                    <td className="py-2 pl-3 text-emerald-600">{toArabicNumerals(archive.added_quantity)}</td>
                    <td className="py-2 pl-3 text-emerald-600">{toArabicNumerals(archive.sold_quantity)}</td>
                    <td className="py-2 pl-3">{formatCurrency(archive.inventory_capital, 'ILS', currencySymbol)}</td>
                    <td className="py-2">
                      <div>{formatCurrency(archive.sales_profit, 'ILS', currencySymbol)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {archive.unknown_cost_items > 0
                          ? `جزئي؛ ${toArabicNumerals(archive.unknown_cost_items)} بند بتكلفة مجهولة`
                          : archive.estimated_cost_items > 0
                            ? `تقديري؛ ${toArabicNumerals(archive.estimated_cost_items)} بند بسعر تكلفة حالي`
                            : 'محسوب من تكاليف البيع المسجلة'}
                      </div>
                    </td>
                    <td className="py-2">
                      {archive.movement_details_removed ? 'تفاصيل مضغوطة' : 'أرشيف كامل'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Filter and Date Control Card */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          {/* Custom Date Range Inputs */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Calendar className="h-4 w-4 text-primary" />
              <span>تحديد الفترة:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-muted-foreground">من</span>
              <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-xl px-2.5 py-1.5 text-xs">
                <label htmlFor="ledger-start-date" className="sr-only">تاريخ البداية</label>
                <input
                  id="ledger-start-date"
                  type="date"
                  lang="ar"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    if (!e.target.value) setStartTime('')
                  }}
                  className="bg-transparent text-xs text-foreground focus:outline-none font-mono"
                />
              </div>

              <span className="text-[11px] font-bold text-muted-foreground">إلى</span>
              <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-xl px-2.5 py-1.5 text-xs">
                <label htmlFor="ledger-end-date" className="sr-only">تاريخ النهاية</label>
                <input
                  id="ledger-end-date"
                  type="date"
                  lang="ar"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value)
                    if (!e.target.value) setEndTime('')
                  }}
                  className="bg-transparent text-xs text-foreground focus:outline-none font-mono"
                />
              </div>

              <span className="text-[11px] font-bold text-muted-foreground ms-2">الوقت من</span>
              <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-xl px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground text-[11px]">وقت البداية (ساعة:دقيقة):</span>
                <input
                  type="time"
                  lang="ar"
                  step="60"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={!startDate}
                  className="bg-transparent text-xs text-foreground focus:outline-none font-mono"
                  title={startDate ? 'يطبق مع تاريخ البداية المحدد' : 'حدد تاريخ البداية أولاً'}
                />
              </div>

              <span className="text-[11px] font-bold text-muted-foreground">إلى</span>
              <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-xl px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground text-[11px]">وقت النهاية (ساعة:دقيقة):</span>
                <input
                  type="time"
                  lang="ar"
                  step="60"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  disabled={!endDate}
                  className="bg-transparent text-xs text-foreground focus:outline-none font-mono"
                  title={endDate ? 'يطبق مع تاريخ النهاية المحدد' : 'حدد تاريخ النهاية أولاً'}
                />
              </div>

              {(startDate || endDate || startTime || endTime) && (
                <button
                  type="button"
                  onClick={() => {
                    setStartDate('')
                    setEndDate('')
                    setStartTime('')
                    setEndTime('')
                  }}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors text-xs flex items-center gap-1"
                  title="تفريغ التواريخ"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="text-[11px] hidden sm:inline">مسح</span>
                </button>
              )}
            </div>

            {/* Quick Preset Buttons */}
            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/60 text-xs">
              <button
                type="button"
                onClick={() => applyDatePreset('today')}
                className="px-2.5 py-1 rounded-lg hover:bg-card hover:text-foreground text-muted-foreground text-[11px] font-medium transition-colors"
              >
                اليوم (يوم)
              </button>
              <button
                type="button"
                onClick={() => applyDatePreset('week')}
                className="px-2.5 py-1 rounded-lg hover:bg-card hover:text-foreground text-muted-foreground text-[11px] font-medium transition-colors"
              >
                آخر 7 أيام (أسبوع)
              </button>
              <button
                type="button"
                onClick={() => applyDatePreset('month')}
                className="px-2.5 py-1 rounded-lg hover:bg-card hover:text-foreground text-muted-foreground text-[11px] font-medium transition-colors"
              >
                الشهر الحالي
              </button>
              <button
                type="button"
                onClick={() => applyDatePreset('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  !startDate && !endDate
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-card'
                }`}
              >
                الكل
              </button>
            </div>
          </div>

          {/* Filter by Type Tabs */}
          <div className="flex flex-wrap items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              disabled={Boolean(fullMonthArchive?.movement_details_removed)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterType === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card'
              }`}
            >
              الكل ({toArabicNumerals(movements.length)})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('opening')}
              disabled={Boolean(fullMonthArchive?.movement_details_removed)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterType === 'opening'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card'
              }`}
            >
              أرصدة افتتاحية
            </button>
            <button
              type="button"
              onClick={() => setFilterType('adjustment_in')}
              disabled={Boolean(fullMonthArchive?.movement_details_removed)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterType === 'adjustment_in'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card'
              }`}
            >
              تسويات إضافة
            </button>
            <button
              type="button"
              onClick={() => setFilterType('adjustment_out')}
              disabled={Boolean(fullMonthArchive?.movement_details_removed)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterType === 'adjustment_out'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card'
              }`}
            >
              تسويات خصم
            </button>
            <button
              type="button"
              onClick={() => setFilterType('sale')}
              disabled={Boolean(fullMonthArchive?.movement_details_removed)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filterType === 'sale'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card'
              }`}
            >
              فواتير بيع
            </button>
          </div>
        </div>

        {/* Live Filter Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 pt-3 border-t border-border/70 text-xs">
          <div className="bg-muted/30 border border-border/50 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 text-primary rounded-lg">
              <ReceiptText className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">عدد الحركات في الفترة:</span>
              <strong className="text-sm font-mono text-foreground">
                {toArabicNumerals(reportSummary.count)} حركة
              </strong>
            </div>
          </div>

          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">إجمالي ما تم إضافته:</span>
              <strong className="text-sm font-mono text-emerald-600">
                +{toArabicNumerals(reportSummary.inQty)}
              </strong>
            </div>
          </div>

          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
              <TrendingDown className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">إجمالي القطع التي تم بيعها:</span>
              <strong className="text-sm font-mono text-emerald-600">
                {toArabicNumerals(reportSummary.soldQty)}
              </strong>
            </div>
          </div>

          <div className="bg-muted/30 border border-border/50 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">رأس مال المشروع:</span>
              <strong className="text-sm font-mono text-foreground">
                {isCapitalLoading
                  ? 'جارٍ الحساب...'
                  : isCapitalError
                  ? 'تعذر تحميل القيمة'
                  : formatCurrency(reportCapital, 'ILS', currencySymbol)}
              </strong>
            </div>
          </div>
          {fullMonthArchive?.movement_details_removed && (
            <p className="col-span-full text-[11px] text-amber-700 dark:text-amber-300">
              تفاصيل هذا الشهر مضغوطة بعد الأرشفة؛ أعداد الإضافة والبيع المعروضة مأخوذة من الملخص الأصلي المحفوظ.
            </p>
          )}
          <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-violet-500/10 text-violet-600 rounded-lg">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">
                {profitSummary?.unknownCostItems ? 'صافي الربح (جزئي):' : 'صافي الربح:'}
              </span>
              <strong className="text-sm font-mono text-foreground">
                {isProfitLoading
                  ? 'جارٍ الحساب...'
                  : isProfitError
                  ? 'تعذر تحميل الربح'
                  : formatCurrency(profitSummary?.netProfit ?? 0, 'ILS', currencySymbol)}
              </strong>
            </div>
          </div>
          <p className="col-span-full text-[11px] text-muted-foreground">
            {profitDefinition} قيمة رأس المال هي تقييم المخزون الحالي بحسب تكلفة المنتجات الحالية.{' '}
            {profitCaveat}
          </p>
        </div>
      </div>

      {/* Movements Table */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground text-sm animate-pulse">
            جارٍ تحميل سجل الحركات من قاعدة البيانات...
          </div>
        ) : filteredMovements.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground space-y-2">
            <Layers className="h-8 w-8 mx-auto opacity-40" />
            <p className="text-sm font-medium">لا توجد حركات مخزنية مطابقة للفترة المحددة</p>
            <p className="text-xs text-muted-foreground">جرب تغيير تواريخ الفلتر أو اختيار "جميع الفترات"</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3 px-4">التاريخ والوقت</th>
                  <th className="py-3 px-4">اسم المنتج</th>
                  <th className="py-3 px-4">المستودع</th>
                  <th className="py-3 px-4">نوع الحركة</th>
                  <th className="py-3 px-4">الكمية</th>
                  <th className="py-3 px-4">تكلفة الوحدة</th>
                  <th className="py-3 px-4">القيمة الإجمالية</th>
                  <th className="py-3 px-4">الملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredMovements.map((m) => {
                  const isPositive = m.quantity > 0
                  const typeInfo = typeLabels[m.movement_type] || {
                    label: m.movement_type,
                    color: 'bg-muted text-muted-foreground',
                  }

                  const dateFormatted = new Date(m.created_at).toLocaleString('ar-SA', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })

                  return (
                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 opacity-60" />
                          <span>{toArabicNumerals(dateFormatted)}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-medium text-foreground">
                        {m.product_name}
                      </td>

                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {m.warehouse_name}
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${typeInfo.color}`}
                        >
                          {typeInfo.label}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-bold font-mono">
                        <div
                          className={`inline-flex items-center gap-1 ${
                            isPositive
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {isPositive ? (
                            <ArrowDownRight className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpLeft className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {isPositive ? '+' : ''}
                            {toArabicNumerals(m.quantity)}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-xs font-mono text-muted-foreground">
                        {formatCurrency(m.unit_cost, 'ILS', currencySymbol)}
                      </td>

                      <td className="py-3 px-4 text-xs font-mono font-semibold text-foreground">
                        {formatCurrency(m.total_cost, 'ILS', currencySymbol)}
                      </td>

                      <td className="py-3 px-4 text-xs text-muted-foreground max-w-xs truncate">
                        {m.notes || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
