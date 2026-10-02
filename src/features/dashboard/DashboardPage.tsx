import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProducts,
  fetchWarehouses,
  fetchCategories,
  findProductByBarcode,
  createSale,
  type ProductWithStock,
  type SaleRecord,
} from '@/lib/inventoryService'
import { toArabicNumerals, formatCurrency } from '@/lib/utils'
import { useTenant } from '@/hooks/useTenant'
import { APP_NAME } from '@/config/constants'
import { ReceiptModal } from '@/components/shared/ReceiptModal'
import {
  ScanLine,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  Package,
  Search,
  CheckCircle2,
  AlertTriangle,
  X,
  Tag,
  Layers,
  ArrowRight,
  Boxes,
  Printer,
  Sparkles,
  Maximize2,
} from 'lucide-react'
import { Link } from 'react-router-dom'

interface CartItem {
  product_id:      string
  product_name:    string
  unit_price:      number
  quantity:        number
  image_url:       string | null
  current_stock:   number
  wholesale_price: number
}

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const { tenant }  = useTenant()

  // Queries
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => fetchProducts(),
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  })

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: fetchWarehouses,
  })

  // State
  const [cart, setCart]                   = useState<CartItem[]>([])
  const [barcodeInput, setBarcodeInput]   = useState('')
  const [searchTerm, setSearchTerm]       = useState('')
  const [selectedCategory, setSelectedCat] = useState<string>('all')
  const [barcodeError, setBarcodeError]   = useState<string | null>(null)
  const [barcodeProcessingCount, setBarcodeProcessingCount] = useState(0)
  const [lastScanned, setLastScanned]     = useState<{ name: string; price: number } | null>(null)
  const [discount, setDiscount]           = useState('')
  const [completedSale, setCompletedSale] = useState<SaleRecord | null>(null)
  const [previewImage, setPreviewImage]   = useState<{ url: string; name: string } | null>(null)
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [mobileTab, setMobileTab]         = useState<'products' | 'cart'>('products')

  const barcodeRef = useRef<HTMLInputElement>(null)
  const searchRef  = useRef<HTMLInputElement>(null)
  const scanQueueRef = useRef<Promise<void>>(Promise.resolve())
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-focus barcode field on load
  useEffect(() => {
    barcodeRef.current?.focus()
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  // Re-focus barcode after sale completes
  useEffect(() => {
    if (!completedSale) {
      setTimeout(() => barcodeRef.current?.focus(), 150)
    }
  }, [completedSale])

  // Sale mutation
  const saleMutation = useMutation({
    mutationFn: createSale,
    onSuccess: (sale) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setCompletedSale(sale)
      setCart([])
      setDiscount('')
    },
    onError: (err) => {
      alert('حدث خطأ أثناء تسجيل عملية البيع: ' + String(err))
    }
  })

  // Add product to cart helper
  const addToCart = useCallback((product: ProductWithStock) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id)
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      }
      return [
        ...prev,
        {
          product_id:      product.id,
          product_name:    product.name_ar,
          unit_price:      product.selling_price,
          quantity:        1,
          image_url:       product.image_url,
          current_stock:   product.current_stock,
          wholesale_price: product.wholesale_price || product.cost_price,
        },
      ]
    })
  }, [])

  // Resolve scans one at a time so rapid consecutive scans are not lost.
  const addByBarcode = useCallback((value: string) => {
    const code = value.trim()
    if (!code) return
    setBarcodeError(null)
    setBarcodeInput('')
    setBarcodeProcessingCount((count) => count + 1)
    scanQueueRef.current = scanQueueRef.current
      .then(async () => {
        const product = await findProductByBarcode(code)
        if (!product) {
          setBarcodeError(`لم يُعثر على منتج نشط بالباركود أو SKU: ${code}`)
          return
        }

        addToCart(product)
        setLastScanned({ name: product.name_ar, price: product.selling_price })
        if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
        feedbackTimerRef.current = setTimeout(() => setLastScanned(null), 3000)
      })
      .catch((error: unknown) => {
        setBarcodeError(`تعذر البحث عن المنتج: ${String(error)}`)
      })
      .finally(() => {
        setBarcodeProcessingCount((count) => Math.max(0, count - 1))
        barcodeRef.current?.focus()
      })
  }, [addToCart])

  // USB/Bluetooth keyboard-wedge scanners usually terminate each scan with Enter.
  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addByBarcode(barcodeInput)
    }
  }

  const focusBarcodeScanner = () => {
    barcodeRef.current?.focus()
    barcodeRef.current?.select()
  }

  const updateQty = (product_id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.product_id === product_id ? { ...i, quantity: i.quantity + delta } : i
        )
        .filter((i) => i.quantity > 0)
    )
  }

  const removeFromCart = (product_id: string) => {
    setCart((prev) => prev.filter((i) => i.product_id !== product_id))
  }

  const cartTotal     = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const totalQuantity = cart.reduce((s, i) => s + i.quantity, 0)
  const discountAmt   = parseFloat(discount) || 0
  const netTotal      = Math.max(0, cartTotal - discountAmt)

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        p.name_ar.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.barcode && p.barcode.includes(searchTerm)) ||
        p.sku.toLowerCase().includes(searchTerm.toLowerCase())

      const matchCat = selectedCategory === 'all' || p.category_id === selectedCategory

      return matchSearch && matchCat
    })
  }, [products, searchTerm, selectedCategory])

  // Autocomplete suggestions (top 5 when typing in search)
  const searchSuggestions = useMemo(() => {
    if (!searchTerm.trim()) return []
    return products.filter((p) =>
      p.name_ar.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchTerm)) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 5)
  }, [products, searchTerm])

  const handleCompleteSale = () => {
    if (cart.length === 0) return
    const warehouseId = warehouses[0]?.id || 'wh-1'
    saleMutation.mutate({
      items: cart.map((i) => ({
        product_id:   i.product_id,
        product_name: i.product_name,
        quantity:     i.quantity,
        unit_price:   i.unit_price,
      })),
      warehouse_id:    warehouseId,
      discount_amount: discountAmt,
    })
  }

  return (
    <div className="space-y-5">

      {/* POS Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-foreground">شاشة البيع ونقطة البيع (POS)</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            امسح الباركود بقارئ USB أو Bluetooth يعمل كلوحة مفاتيح، أو ابحث عن المنتجات لإضافتها للسلة.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/products"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground hover:bg-muted transition-colors shadow-sm"
          >
            <Boxes className="h-4 w-4 text-primary" />
            <span>إدارة المخزون والصور</span>
            <ArrowRight className="h-3.5 w-3.5 rotate-180" />
          </Link>
        </div>
      </div>

      {/* Laser Barcode Scanner Top Bar */}
      <div className="bg-card border-2 border-primary/40 rounded-2xl p-4 shadow-sm space-y-2">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-black text-foreground shrink-0">
            <span className="p-2.5 bg-primary/10 text-primary rounded-xl">
              <ScanLine className="h-5 w-5" />
            </span>
            <span>قارئ الباركود:</span>
          </div>

          <div className="relative flex-1">
            <input
              ref={barcodeRef}
              type="text"
              dir="ltr"
              autoComplete="off"
              placeholder="امسح أو اكتب الباركود؛ ينهي القارئ المسح عادةً بـ Enter..."
              value={barcodeInput}
              onChange={(e) => {
                setBarcodeInput(e.target.value)
                setBarcodeError(null)
              }}
              onKeyDown={handleBarcodeKeyDown}
              className="w-full rounded-xl border-2 border-input bg-background pr-4 pl-12 py-2.5 text-sm font-mono focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-inner"
            />
            <span className="absolute left-3 top-3 text-xs text-muted-foreground font-mono">
              [Enter ↵]
            </span>
          </div>

          <button
            type="button"
            onClick={() => addByBarcode(barcodeInput)}
            className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-black hover:bg-primary/90 transition-colors shrink-0 shadow-sm flex items-center justify-center gap-1.5"
            disabled={!barcodeInput.trim()}
          >
            <Plus className="h-4 w-4" />
            <span>إضافة للسلة</span>
          </button>
          <button
            type="button"
            onClick={focusBarcodeScanner}
            className="px-3 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 flex items-center justify-center"
            title="إعادة تركيز قارئ الباركود"
            aria-label="إعادة تركيز قارئ الباركود"
          >
            <ScanLine className="h-4 w-4" />
          </button>
        </div>

        {/* Feedback alerts */}
        {barcodeProcessingCount > 0 && (
          <div className="text-xs text-muted-foreground animate-pulse" role="status">
            جارٍ قراءة وإضافة {toArabicNumerals(barcodeProcessingCount)} مسح...
          </div>
        )}
        {lastScanned && (
          <div className="flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-2 rounded-xl animate-in fade-in duration-150">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              تمت إضافة: <strong>{lastScanned.name}</strong> بنجاح — سعر الحبة:{' '}
              <strong dir="ltr">{formatCurrency(lastScanned.price, 'ILS', '₪', false)}</strong>
            </span>
          </div>
        )}

        {barcodeError && (
          <div className="flex items-center justify-between text-xs text-red-800 dark:text-red-300 bg-red-500/15 border border-red-500/30 px-3.5 py-2 rounded-xl">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span>{barcodeError}</span>
            </div>
            <button type="button" onClick={() => setBarcodeError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Mobile View Switcher Tabs (Only visible on screens < md) */}
      <div className="flex md:hidden bg-muted/60 p-1 rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setMobileTab('products')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
            mobileTab === 'products'
              ? 'bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Package className="h-4 w-4" />
          <span>المنتجات ({toArabicNumerals(filteredProducts.length)})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('cart')}
          className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
            mobileTab === 'cart'
              ? 'bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShoppingCart className="h-4 w-4" />
          <span>سلة المشتريات ({toArabicNumerals(totalQuantity)})</span>
        </button>
      </div>

      {/* Main Layout: Products (7/8 cols on md+) + Cart (5/4 cols on md+) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">

        {/* LEFT COLUMN: Products Section */}
        <div className={`md:col-span-7 xl:col-span-8 space-y-4 ${mobileTab === 'cart' ? 'hidden md:block' : 'block'}`}>

          {/* Interactive Search Bar with Autocomplete Dropdown */}
          <div className="relative z-20">
            <div className="bg-card border border-border rounded-xl p-3 shadow-sm flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute right-3.5 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="ابحث بالاسم، الباركود، أو كود SKU..."
                  value={searchTerm}
                  onFocus={() => setIsSearchFocused(true)}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background pr-10 pl-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('')
                      setIsSearchFocused(false)
                    }}
                    className="absolute left-3 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
                {toArabicNumerals(filteredProducts.length)} منتج
              </span>
            </div>

            {/* Autocomplete Dropdown Panel (Appears when user types in search) */}
            {isSearchFocused && searchSuggestions.length > 0 && (
              <div
                className="absolute top-full right-0 left-0 mt-1.5 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-30 divide-y divide-border animate-in fade-in zoom-in-95 duration-100"
                onMouseDown={(e) => e.preventDefault()}
              >
                <div className="px-3 py-1.5 bg-muted/50 text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span>نتائج بحث فورية:</span>
                  </span>
                  <span>اضغط لإضافة المنتج للسلة فوراً</span>
                </div>

                {searchSuggestions.map((prod) => (
                  <div
                    key={prod.id}
                    onClick={() => {
                      addToCart(prod)
                      setLastScanned({ name: prod.name_ar, price: prod.selling_price })
                      setTimeout(() => setLastScanned(null), 2500)
                    }}
                    className="p-2.5 flex items-center gap-3 hover:bg-primary/5 cursor-pointer transition-colors"
                  >
                    {/* Small image */}
                    {prod.image_url ? (
                      <img
                        src={prod.image_url}
                        alt={prod.name_ar}
                        className="h-10 w-10 rounded-lg object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                        <Package className="h-5 w-5 text-muted-foreground opacity-40" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{prod.name_ar}</p>
                      <div className="flex items-center gap-3 text-[11px] mt-0.5">
                        <span className="text-primary font-bold font-mono" dir="ltr">
                          سعر الحبة: {formatCurrency(prod.selling_price, 'ILS', '₪', false)}
                        </span>
                        <span className="text-muted-foreground font-mono" dir="ltr">
                          جملة: {formatCurrency(prod.wholesale_price || prod.cost_price, 'ILS', '₪', false)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="px-3 py-1.5 bg-primary text-primary-foreground font-bold text-xs rounded-lg hover:bg-primary/90 flex items-center gap-1 shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>أضف للسلة</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedCat('all')}
              className={`px-3.5 py-1.5 rounded-full font-bold transition-colors shrink-0 ${
                selectedCategory === 'all'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              كل التصنيفات ({toArabicNumerals(products.length)})
            </button>
            {categories.map((c) => {
              const count = products.filter((p) => p.category_id === c.id).length
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCat(c.id)}
                  className={`px-3.5 py-1.5 rounded-full font-semibold transition-colors shrink-0 ${
                    selectedCategory === c.id
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {c.name_ar} ({toArabicNumerals(count)})
                </button>
              )
            })}
          </div>

          {/* Products Grid */}
          {isLoading ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground animate-pulse text-sm">
              جارٍ تحميل المنتجات والمخزون...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground space-y-3">
              <Package className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm font-semibold">لا توجد منتجات مطابقة للبحث</p>
              <p className="text-xs text-muted-foreground">
                يمكنك إضافة منتجات جديدة وتحديد صورها من شاشة "المنتجات والمخزون"
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {filteredProducts.map((product) => {
                const inCart = cart.find((i) => i.product_id === product.id)
                const isOutOfStock = product.current_stock <= 0

                return (
                  <div
                    key={product.id}
                    onClick={() => addToCart(product)}
                    className={`group relative bg-card border rounded-2xl p-3 flex flex-col justify-between cursor-pointer transition-all duration-150 shadow-xs hover:shadow-md ${
                      inCart
                        ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    {/* Cart Quantity Badge if in cart */}
                    {inCart && (
                      <span className="absolute top-2 left-2 z-10 bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">
                        {toArabicNumerals(inCart.quantity)} بالسلة
                      </span>
                    )}

                    {/* Top: Large Crisp Product Image */}
                    <div className="space-y-2.5">
                      <div className="relative w-full aspect-square bg-muted/40 rounded-xl overflow-hidden border border-border flex items-center justify-center">
                        {product.image_url ? (
                          <>
                            <img
                              src={product.image_url}
                              alt={product.name_ar}
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                                (e.target as HTMLElement).parentElement?.classList.add('bg-gradient-to-br', 'from-emerald-500/10', 'to-primary/10');
                              }}
                            />
                            {/* Zoom button on hover */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setPreviewImage({ url: product.image_url!, name: product.name_ar })
                              }}
                              className="absolute bottom-2 left-2 p-1.5 bg-black/60 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                              title="تكبير الصورة"
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-muted-foreground opacity-40">
                            <Package className="h-10 w-10" />
                            <span className="text-[10px] mt-1 font-medium">بدون صورة</span>
                          </div>
                        )}
                      </div>

                      {/* Title & SKU */}
                      <div>
                        <h3 className="font-bold text-sm text-foreground leading-snug line-clamp-2">
                          {product.name_ar}
                        </h3>
                        {product.barcode && (
                          <p className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate" dir="ltr">
                            {product.barcode}
                          </p>
                        )}
                      </div>

                      {/* Prices: سعر الحبة وسعر الجملة */}
                      <div className="space-y-1.5 pt-1 border-t border-border/60">
                        {/* سعر الحبة (القطعة) */}
                        <div className="flex items-center justify-between bg-emerald-500/10 dark:bg-emerald-950/30 px-2 py-1 rounded-lg border border-emerald-500/20">
                          <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                            <Tag className="h-3 w-3" />
                            <span>سعر الحبة:</span>
                          </span>
                          <span className="text-sm font-black text-emerald-700 dark:text-emerald-400 font-mono" dir="ltr">
                            {formatCurrency(product.selling_price, 'ILS', '₪', false)}
                          </span>
                        </div>

                        {/* سعر الجملة */}
                        <div className="flex items-center justify-between px-2 py-0.5 text-muted-foreground text-[11px]">
                          <span className="flex items-center gap-1">
                            <Layers className="h-3 w-3 opacity-70" />
                            <span>سعر الجملة:</span>
                          </span>
                          <span className="font-mono text-foreground font-semibold" dir="ltr">
                            {formatCurrency(product.wholesale_price || product.cost_price, 'ILS', '₪', false)}
                          </span>
                        </div>

                        {/* الكمية المتوفرة */}
                        <div className="flex items-center justify-between px-2 pt-0.5 text-[11px]">
                          <span className="text-muted-foreground">الكمية المتوفرة:</span>
                          <span
                            className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                              isOutOfStock
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {toArabicNumerals(product.current_stock)} {product.unit_symbol || 'حبة'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Big Action Button: إضافة إلى السلة */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        addToCart(product)
                      }}
                      className="w-full mt-2.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 text-xs shadow-xs transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      <span>إضافة إلى السلة</span>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Cart & Checkout (Permanently Docked on side for md+) */}
        <div className={`md:col-span-5 xl:col-span-4 md:sticky md:top-4 space-y-4 ${mobileTab === 'products' ? 'hidden md:block' : 'block'}`}>
          <div className="bg-card border-2 border-border rounded-2xl shadow-lg overflow-hidden flex flex-col">

            {/* Cart Header */}
            <div className="px-5 py-4 border-b border-border bg-muted/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" />
                <h2 className="font-bold text-base text-foreground">سلة المشتريات</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-primary/10 text-primary font-bold px-2.5 py-0.5 rounded-full">
                  {toArabicNumerals(totalQuantity)} قطعة
                </span>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 mr-1"
                    title="تفريغ السلة"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>مسح</span>
                  </button>
                )}
              </div>
            </div>

            {/* Cart Items List */}
            <div className="divide-y divide-border max-h-[380px] overflow-y-auto p-2">
              {cart.length === 0 ? (
                <div className="py-14 text-center text-muted-foreground space-y-2">
                  <ShoppingCart className="h-10 w-10 mx-auto opacity-20" />
                  <p className="text-sm font-semibold">السلة فارغة حالياً</p>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                    امسح باركود المنتج بجهاز الليزر أو اضغط على أي منتج من القائمة لإضافته
                  </p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.product_id} className="p-2.5 flex items-center gap-3">
                    {/* Item Thumbnail */}
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.product_name}
                        className="h-11 w-11 rounded-lg object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="h-11 w-11 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                        <Package className="h-5 w-5 text-muted-foreground opacity-40" />
                      </div>
                    )}

                    {/* Item Details */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-foreground leading-tight truncate">
                        {item.product_name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400" dir="ltr">
                          {formatCurrency(item.unit_price, 'ILS', '₪', false)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">للحبة</span>
                      </div>
                    </div>

                    {/* Quantity Controls */}
                    <div className="flex items-center gap-1 shrink-0 bg-muted/60 p-1 rounded-lg border border-border">
                      <button
                        type="button"
                        onClick={() => updateQty(item.product_id, -1)}
                        className="h-6 w-6 rounded bg-card hover:bg-background border border-border flex items-center justify-center text-foreground transition-colors"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-xs font-bold text-foreground w-6 text-center">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQty(item.product_id, 1)}
                        className="h-6 w-6 rounded bg-card hover:bg-background border border-border flex items-center justify-center text-foreground transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Delete Item */}
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.product_id)}
                      className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors shrink-0"
                      title="حذف من السلة"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer: Summary and Complete Sale Button */}
            <div className="border-t border-border p-5 space-y-4 bg-muted/20">

              {/* Discount Field */}
              <div className="flex items-center justify-between gap-3 text-xs">
                <label className="font-semibold text-muted-foreground shrink-0">
                  خصم إضافي (₪):
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  dir="ltr"
                  placeholder="0.00"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-28 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-mono text-left focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Totals Breakdown */}
              <div className="space-y-1.5 text-xs pt-2 border-t border-border/60">
                <div className="flex justify-between text-muted-foreground">
                  <span>المجموع الفرعي:</span>
                  <span className="font-mono" dir="ltr">
                    {formatCurrency(cartTotal, 'ILS', '₪', false)}
                  </span>
                </div>

                {discountAmt > 0 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400 font-semibold">
                    <span>قيمة الخصم:</span>
                    <span className="font-mono" dir="ltr">
                      - {formatCurrency(discountAmt, 'ILS', '₪', false)}
                    </span>
                  </div>
                )}

                {/* Grand Total */}
                <div className="flex justify-between items-baseline font-bold text-lg text-foreground border-t-2 border-border pt-3">
                  <span>المجموع النهائي:</span>
                  <span className="text-xl text-emerald-600 dark:text-emerald-400 font-mono font-black" dir="ltr">
                    {formatCurrency(netTotal, 'ILS', '₪', false)}
                  </span>
                </div>
              </div>

              {/* Complete Sale Button */}
              <button
                type="button"
                onClick={handleCompleteSale}
                disabled={cart.length === 0 || saleMutation.isPending}
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm transition-all duration-150 shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Printer className="h-5 w-5" />
                <span>
                  {saleMutation.isPending
                    ? 'جارٍ حفظ وطباعة الوصل...'
                    : 'إنهاء الشراء وطباعة الوصل (PDF)'}
                </span>
              </button>
            </div>

          </div>
        </div>

      </div>

      {/* Mobile Floating Bottom Bar for quick checkout when in products tab */}
      {cart.length > 0 && mobileTab === 'products' && (
        <div className="md:hidden fixed bottom-4 left-4 right-4 z-40 bg-card border-2 border-primary rounded-2xl p-3 shadow-2xl flex items-center justify-between animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary text-primary-foreground rounded-xl">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">{toArabicNumerals(totalQuantity)} قطع بالسلة</p>
              <p className="text-sm font-black text-emerald-600 font-mono" dir="ltr">
                {formatCurrency(netTotal, 'ILS', '₪', false)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileTab('cart')}
            className="px-4 py-2 bg-emerald-600 text-white font-black text-xs rounded-xl shadow hover:bg-emerald-700 flex items-center gap-1.5"
          >
            <span>فتح السلة والإنهاء</span>
            <ArrowRight className="h-4 w-4 rotate-180" />
          </button>
        </div>
      )}

      {/* Modal: Big Image Preview Zoom */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-bold text-sm text-foreground">{previewImage.name}</h3>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={previewImage.url}
              alt={previewImage.name}
              className="w-full h-80 object-contain rounded-xl bg-muted/30"
            />
          </div>
        </div>
      )}

      {/* Printable Receipt Modal (HTML / PDF) */}
      {completedSale && (
        <ReceiptModal
          sale={completedSale}
          storeName={tenant?.name ?? APP_NAME}
          onClose={() => setCompletedSale(null)}
        />
      )}

    </div>
  )
}
