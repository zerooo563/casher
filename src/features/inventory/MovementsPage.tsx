import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchStockMovements } from '@/lib/inventoryService'
import { toArabicNumerals, formatCurrency } from '@/lib/utils'
import { ArrowDownRight, ArrowUpLeft, Layers, Calendar, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function MovementsPage() {
  const [filterType, setFilterType] = useState<string>('all')

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['stock_movements'],
    queryFn: () => fetchStockMovements(),
  })

  const filteredMovements = movements.filter((m) => {
    if (filterType === 'all') return true
    return m.movement_type === filterType
  })

  const typeLabels: Record<string, { label: string; color: string }> = {
    opening:          { label: 'رصيد افتتاحي', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20' },
    adjustment_in:    { label: 'تسوية إضافة',  color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
    adjustment_out:   { label: 'تسوية خصم',    color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20' },
    purchase_receipt: { label: 'استلام مشتريات', color: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20' },
    sale:             { label: 'فاتورة بيع',    color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' },
    transfer_in:      { label: 'تحويل وارد',    color: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20' },
    transfer_out:     { label: 'تحويل صادر',    color: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/products" className="hover:text-foreground flex items-center gap-1">
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

        {/* Filter by type */}
        <div className="flex items-center gap-2 bg-card border border-border p-1 rounded-lg text-xs">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterType === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            الكل ({toArabicNumerals(movements.length)})
          </button>
          <button
            onClick={() => setFilterType('opening')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterType === 'opening'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            أرصدة افتتاحية
          </button>
          <button
            onClick={() => setFilterType('adjustment_in')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterType === 'adjustment_in'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            تسويات إضافة
          </button>
          <button
            onClick={() => setFilterType('adjustment_out')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterType === 'adjustment_out'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            تسويات خصم
          </button>
        </div>
      </div>

      {/* Movements Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground text-sm animate-pulse">
            جارٍ تحميل سجل الحركات من قاعدة البيانات...
          </div>
        ) : filteredMovements.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground space-y-2">
            <Layers className="h-8 w-8 mx-auto opacity-40" />
            <p className="text-sm font-medium">لا توجد حركات مخزنية مسجلة</p>
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
                        {formatCurrency(m.unit_cost, 'ILS', '₪')}
                      </td>

                      <td className="py-3 px-4 text-xs font-mono font-semibold text-foreground">
                        {formatCurrency(m.total_cost, 'ILS', '₪')}
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
