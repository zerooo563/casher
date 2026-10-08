import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchStockMovements, type StockMovementRecord } from '@/lib/inventoryService'
import { toArabicNumerals, formatCurrency } from '@/lib/utils'
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

export default function MovementsPage() {
  const { tenant } = useTenant()
  const [filterType, setFilterType] = useState<string>('all')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const currencySymbol = tenant?.settings.currency_symbol ?? '₪'
  const storeName = tenant?.name ?? APP_NAME

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['stock_movements'],
    queryFn: () => fetchStockMovements(),
  })

  // Date presets helper
  const applyDatePreset = (preset: 'today' | 'week' | 'month' | 'all') => {
    const now = new Date()
    const formatDate = (d: Date) => d.toISOString().split('T')[0]

    if (preset === 'today') {
      const todayStr = formatDate(now)
      setStartDate(todayStr)
      setEndDate(todayStr)
    } else if (preset === 'week') {
      const weekAgo = new Date()
      weekAgo.setDate(now.getDate() - 7)
      setStartDate(formatDate(weekAgo))
      setEndDate(formatDate(now))
    } else if (preset === 'month') {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      setStartDate(formatDate(firstOfMonth))
      setEndDate(formatDate(now))
    } else {
      setStartDate('')
      setEndDate('')
    }
  }

  // Filtered movements based on type and custom date range
  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      // Type filter
      if (filterType !== 'all' && m.movement_type !== filterType) {
        return false
      }

      // Date range filter
      if (startDate) {
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        if (new Date(m.created_at) < start) return false
      }

      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        if (new Date(m.created_at) > end) return false
      }

      return true
    })
  }, [movements, filterType, startDate, endDate])

  // Summary figures for filtered dataset
  const summary = useMemo(() => {
    let inQty = 0
    let outQty = 0
    let totalValue = 0

    for (const m of filteredMovements) {
      if (m.quantity > 0) {
        inQty += m.quantity
      } else {
        outQty += Math.abs(m.quantity)
      }
      totalValue += m.total_cost
    }

    return {
      count: filteredMovements.length,
      inQty,
      outQty,
      totalValue,
    }
  }, [filteredMovements])

  const typeLabels: Record<string, { label: string; color: string }> = {
    opening:          { label: 'رصيد افتتاحي', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20' },
    adjustment_in:    { label: 'تسوية إضافة',  color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
    adjustment_out:   { label: 'تسوية خصم',    color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20' },
    purchase_receipt: { label: 'استلام مشتريات', color: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20' },
    sale:             { label: 'فاتورة بيع',    color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
    transfer_in:      { label: 'تحويل وارد',    color: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20' },
    transfer_out:     { label: 'تحويل صادر',    color: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
  }

  // Print report to PDF or Paper
  const handlePrintLedger = () => {
    const printWindow = window.open('', '_blank', 'width=1000,height=800')
    if (!printWindow) {
      alert('يرجى السماح بالنوافذ المنبثقة لطباعة التقرير.')
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
        ? `من ${startDate} إلى ${endDate}`
        : startDate
        ? `من تاريخ ${startDate}`
        : endDate
        ? `حتى تاريخ ${endDate}`
        : 'جميع المعاملات المسجلة'

    const filterTypeLabel =
      filterType === 'all'
        ? 'جميع أنواع الحركات'
        : typeLabels[filterType]?.label ?? filterType

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
      grid-template-columns: repeat(4, 1fr);
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
      <div class="val">${toArabicNumerals(summary.count)}</div>
    </div>
    <div class="summary-card">
      <div class="label">إجمالي الوارد (إضافات)</div>
      <div class="val" style="color: #059669;">+${toArabicNumerals(summary.inQty)}</div>
    </div>
    <div class="summary-card">
      <div class="label">إجمالي الصادر (مبيعات/خصم)</div>
      <div class="val" style="color: #dc2626;">-${toArabicNumerals(summary.outQty)}</div>
    </div>
    <div class="summary-card">
      <div class="label">إجمالي التكلفة / القيمة</div>
      <div class="val">${formatCurrency(summary.totalValue, 'ILS', currencySymbol, false)}</div>
    </div>
  </div>

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
    <span>تم إنشاء هذا التقرير تلقائياً بواسطة نظام كاشر (Casher POS & Inventory)</span>
    <span>صفحة تقرير رسمية</span>
  </div>

  <script>
    window.onload = function() {
      window.print();
    }
  </script>
</body>
</html>`

    printWindow.document.open()
    printWindow.document.write(htmlContent)
    printWindow.document.close()
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
          disabled={isLoading || filteredMovements.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50 shrink-0"
          title="طباعة السجل أو حفظه بصيغة PDF"
        >
          <Printer className="h-4 w-4" />
          <span>طباعة التقرير (PDF)</span>
        </button>
      </div>

      {/* Filter and Date Control Card */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          {/* Custom Date Range Inputs */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Calendar className="h-4 w-4 text-primary" />
              <span>تحديد الفترة:</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-xl px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground text-[11px]">من:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-transparent text-xs text-foreground focus:outline-none font-mono"
                />
              </div>

              <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-xl px-2.5 py-1.5 text-xs">
                <span className="text-muted-foreground text-[11px]">إلى:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-transparent text-xs text-foreground focus:outline-none font-mono"
                />
              </div>

              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setStartDate('')
                    setEndDate('')
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
                اليوم
              </button>
              <button
                type="button"
                onClick={() => applyDatePreset('week')}
                className="px-2.5 py-1 rounded-lg hover:bg-card hover:text-foreground text-muted-foreground text-[11px] font-medium transition-colors"
              >
                آخر 7 أيام
              </button>
              <button
                type="button"
                onClick={() => applyDatePreset('month')}
                className="px-2.5 py-1 rounded-lg hover:bg-card hover:text-foreground text-muted-foreground text-[11px] font-medium transition-colors"
              >
                هذا الشهر
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border/70 text-xs">
          <div className="bg-muted/30 border border-border/50 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 text-primary rounded-lg">
              <ReceiptText className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">عدد الحركات في الفترة:</span>
              <strong className="text-sm font-mono text-foreground">
                {toArabicNumerals(summary.count)} حركة
              </strong>
            </div>
          </div>

          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-lg">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">إجمالي الوارد (إضافات):</span>
              <strong className="text-sm font-mono text-emerald-600">
                +{toArabicNumerals(summary.inQty)}
              </strong>
            </div>
          </div>

          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-red-500/10 text-red-600 rounded-lg">
              <TrendingDown className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">إجمالي الصادر (مبيعات/خصم):</span>
              <strong className="text-sm font-mono text-red-600">
                -{toArabicNumerals(summary.outQty)}
              </strong>
            </div>
          </div>

          <div className="bg-muted/30 border border-border/50 rounded-xl p-2.5 flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/10 text-amber-600 rounded-lg">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block">إجمالي القيمة:</span>
              <strong className="text-sm font-mono text-foreground">
                {formatCurrency(summary.totalValue, 'ILS', currencySymbol)}
              </strong>
            </div>
          </div>
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
