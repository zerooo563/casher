import type { ProductWithStock } from '@/lib/inventoryService'
import { formatCurrency, toArabicNumerals } from '@/lib/utils'
import { printDocument } from '@/lib/printDocument'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
}

export function printProductCatalog(
  products: ProductWithStock[],
  storeName: string,
  onPopupBlocked: () => void
): void {
  if (products.length === 0) return

  const productCards = products.map((product) => {
    const image = product.image_url
      ? `<img class="product-image" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name_ar)}">`
      : '<div class="product-image placeholder">بدون صورة</div>'
    const wholesalePrice = product.wholesale_price > 0
      ? `<div class="price-row"><span>سعر الجملة</span><strong>${formatCurrency(product.wholesale_price, 'ILS', '₪')}</strong></div>`
      : ''

    return `
      <article class="product-card">
        ${image}
        <div class="product-details">
          <h2>${escapeHtml(product.name_ar)}</h2>
          <div class="product-code">${escapeHtml(product.barcode || product.sku)}</div>
          <div class="price-row selling"><span>سعر البيع</span><strong>${formatCurrency(product.selling_price, 'ILS', '₪')}</strong></div>
          ${wholesalePrice}
        </div>
      </article>`
  }).join('')

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>قائمة المنتجات والأسعار - ${escapeHtml(storeName)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17202a; font-family: Arial, Tahoma, sans-serif; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 2px solid #16a34a; margin-bottom: 14px; }
    h1 { margin: 0; font-size: 20px; }
    header p { margin: 4px 0 0; color: #64748b; font-size: 11px; }
    .meta { color: #64748b; font-size: 10px; text-align: left; }
    main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .product-card { min-width: 0; display: flex; align-items: center; gap: 9px; padding: 8px; border: 1px solid #dbe3ea; border-radius: 8px; break-inside: avoid; page-break-inside: avoid; }
    .product-image { width: 66px; height: 66px; flex: 0 0 66px; object-fit: contain; border-radius: 5px; background: #f1f5f9; }
    .placeholder { display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 9px; }
    .product-details { min-width: 0; flex: 1; }
    h2 { margin: 0 0 3px; font-size: 12px; line-height: 1.35; }
    .product-code { margin-bottom: 5px; color: #64748b; font-size: 9px; direction: ltr; text-align: right; overflow-wrap: anywhere; }
    .price-row { display: flex; justify-content: space-between; gap: 6px; margin-top: 3px; color: #475569; font-size: 9px; }
    .price-row strong { color: #111827; font-size: 10px; white-space: nowrap; }
    .selling strong { color: #15803d; }
    footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 9px; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(storeName)}</h1>
      <p>قائمة المنتجات والأسعار</p>
    </div>
    <div class="meta">${toArabicNumerals(products.length)} منتج · ${escapeHtml(new Date().toLocaleDateString('ar'))}</div>
  </header>
  <main>${productCards}</main>
  <footer>الأسعار بالشيكل — ${toArabicNumerals(products.length)} منتج</footer>
</body>
</html>`

  printDocument(html, onPopupBlocked)
}
