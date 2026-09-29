import { useRef } from 'react'
import { formatCurrency } from '@/lib/utils'
import type { SaleRecord } from '@/lib/inventoryService'
import { X, Printer, CheckCircle2 } from 'lucide-react'

interface ReceiptModalProps {
  sale: SaleRecord
  storeName: string
  onClose: () => void
}

export function ReceiptModal({ sale, storeName, onClose }: ReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null)

  const now = new Date(sale.created_at)
  const dateStr = now.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
  const netTotal = sale.total_amount - sale.discount_amount

  // Build a print document for browser, PDF, or thermal printing.
  const getReceiptHtml = () => `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>وصل شراء رقم ${sale.receipt_number}</title>
  <style>
    @media print {
      body { margin: 0; padding: 10px; }
      .no-print { display: none !important; }
      @page { size: 80mm auto; margin: 3mm; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 13px;
      color: #111;
      direction: rtl;
      background: #fff;
      padding: 16px;
      max-width: 380px;
      margin: 0 auto;
      line-height: 1.4;
    }
    .header { text-align: center; margin-bottom: 12px; border-bottom: 2px dashed #999; padding-bottom: 12px; }
    .header h1 { font-size: 20px; font-weight: 800; margin-bottom: 4px; color: #000; }
    .header p { font-size: 12px; color: #555; }
    .receipt-no {
      text-align: center;
      font-size: 12px;
      color: #333;
      margin: 10px 0;
      padding: 8px;
      background: #f3f4f6;
      border-radius: 6px;
      font-family: monospace;
      border: 1px solid #e5e7eb;
    }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    thead tr { border-bottom: 2px solid #333; }
    th { padding: 8px 4px; font-size: 12px; font-weight: bold; color: #111; }
    td { padding: 7px 4px; font-size: 12px; border-bottom: 1px dotted #ccc; }
    .name-col { text-align: right; width: 45%; }
    .qty-col { text-align: center; width: 15%; }
    .price-col { text-align: left; width: 20%; font-family: monospace; }
    .total-col { text-align: left; width: 20%; font-family: monospace; font-weight: bold; }
    .totals { margin: 12px 0; border-top: 1px dashed #999; padding-top: 8px; }
    .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; color: #333; }
    .totals .grand-total {
      font-size: 17px;
      font-weight: 800;
      border-top: 2px solid #000;
      padding-top: 8px;
      margin-top: 6px;
      color: #000;
    }
    .footer { text-align: center; margin-top: 16px; padding-top: 12px; border-top: 2px dashed #999; font-size: 11px; color: #666; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; background: #e5e7eb; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${storeName}</h1>
    <p>وصل مبيعات رسمي (فاتورة نقدية)</p>
    <p style="margin-top: 3px; font-size: 11px; color: #666;">${dateStr} — ${timeStr}</p>
  </div>

  <div class="receipt-no">
    رقم الوصل: <strong>${sale.receipt_number}</strong>
  </div>

  <table>
    <thead>
      <tr>
        <th class="name-col">الصنف</th>
        <th class="qty-col">الكمية</th>
        <th class="price-col">سعر الحبة</th>
        <th class="total-col">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${sale.items.map(item => `
        <tr>
          <td class="name-col">${item.product_name}</td>
          <td class="qty-col">${item.quantity}</td>
          <td class="price-col" dir="ltr">${formatCurrency(item.unit_price, 'ILS', '₪', false)}</td>
          <td class="total-col" dir="ltr">${formatCurrency(item.total_price, 'ILS', '₪', false)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="row">
      <span>المجموع الفرعي:</span>
      <span dir="ltr">${formatCurrency(sale.total_amount, 'ILS', '₪', false)}</span>
    </div>
    ${sale.discount_amount > 0 ? `
      <div class="row" style="color: #dc2626;">
        <span>الخصم الممنوح:</span>
        <span dir="ltr">- ${formatCurrency(sale.discount_amount, 'ILS', '₪', false)}</span>
      </div>
    ` : ''}
    <div class="row grand-total">
      <span>المجموع الصافي المطلوب:</span>
      <span dir="ltr">${formatCurrency(netTotal, 'ILS', '₪', false)}</span>
    </div>
  </div>

  <div class="footer">
    <p>شكراً لزيارتكم ونسعد بخدمتكم دائماً</p>
    <p style="margin-top: 4px;">الرجاء الاحتفاظ بهذا الوصل عند الحاجة للاستبدال أو الاسترجاع</p>
    <p style="margin-top: 8px; font-family: monospace; font-size: 10px; color: #999;">نظام كاشر Casher POS</p>
  </div>
</body>
</html>`

  // 1. Direct Print (Standard Printer / Thermal / Save to PDF)
  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=450,height=750')
    if (!printWindow) return

    const html = getReceiptHtml()
    printWindow.document.write(html)
    printWindow.document.write('<script>window.onload = () => { window.print(); window.close(); }<\/script>')
    printWindow.document.close()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-emerald-600 text-white rounded-lg">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-foreground">تمت عملية الشراء بنجاح!</h3>
              <p className="text-xs text-muted-foreground">وصل المشتريات جاهز للطباعة</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Receipt Body Preview */}
        <div className="overflow-y-auto flex-1 p-5 bg-muted/10">
          <div
            ref={printRef}
            className="bg-white text-gray-900 border border-gray-200 rounded-xl p-5 shadow-sm space-y-3"
            dir="rtl"
          >
            {/* Header */}
            <div className="text-center pb-3 border-b-2 border-dashed border-gray-300">
              <h1 className="text-xl font-extrabold text-gray-900">{storeName}</h1>
              <p className="text-xs text-gray-500 mt-0.5">وصل مبيعات رسمي (فاتورة نقدية)</p>
              <p className="text-[11px] text-gray-400 mt-1">{dateStr} — {timeStr}</p>
            </div>

            {/* Receipt Number */}
            <div className="text-center text-xs font-mono bg-gray-100 py-1.5 px-3 rounded-lg border border-gray-200">
              رقم الوصل: <strong className="text-gray-800">{sale.receipt_number}</strong>
            </div>

            {/* Items Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-gray-300 text-gray-700">
                  <tr>
                    <th className="py-2 px-1 font-bold">الصنف</th>
                    <th className="py-2 px-1 text-center">الكمية</th>
                    <th className="py-2 px-1 text-left">سعر الحبة</th>
                    <th className="py-2 px-1 text-left">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dotted divide-gray-200">
                  {sale.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/50">
                      <td className="py-2 px-1 font-medium">{item.product_name}</td>
                      <td className="py-2 px-1 text-center font-bold">{item.quantity}</td>
                      <td className="py-2 px-1 text-left font-mono" dir="ltr">
                        {formatCurrency(item.unit_price, 'ILS', '₪', false)}
                      </td>
                      <td className="py-2 px-1 text-left font-mono font-bold text-gray-900" dir="ltr">
                        {formatCurrency(item.total_price, 'ILS', '₪', false)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="pt-2 border-t-2 border-dashed border-gray-300 space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>المجموع الفرعي:</span>
                <span className="font-mono" dir="ltr">{formatCurrency(sale.total_amount, 'ILS', '₪', false)}</span>
              </div>
              {sale.discount_amount > 0 && (
                <div className="flex justify-between text-red-600 font-semibold">
                  <span>الخصم الممنوح:</span>
                  <span className="font-mono" dir="ltr">- {formatCurrency(sale.discount_amount, 'ILS', '₪', false)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline pt-2 border-t-2 border-gray-900 text-base font-black text-gray-900">
                <span>الإجمالي الصافي:</span>
                <span className="text-lg font-mono font-black text-emerald-700" dir="ltr">
                  {formatCurrency(netTotal, 'ILS', '₪', false)}
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-dashed border-gray-300 text-center text-[11px] text-gray-500 space-y-0.5">
              <p>شكراً لتسوقكم معنا ونسعد بخدمتكم</p>
              <p className="text-[10px] text-gray-400">يُرجى الاحتفاظ بالوصل لأغراض الاستبدال أو الاسترجاع</p>
            </div>
          </div>
        </div>

        {/* Print via browser, PDF, or thermal printer */}
        <div className="p-4 border-t border-border bg-card space-y-2">
          <button
            type="button"
            onClick={handlePrint}
            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
          >
            <Printer className="h-4 w-4" />
            <span>طباعة الوصل (PDF / حراري)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            إغلاق ومتابعة البيع
          </button>
        </div>

      </div>
    </div>
  )
}
