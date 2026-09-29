import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProducts,
  fetchCategories,
  fetchUnits,
  fetchWarehouses,
  createProduct,
  updateProductImage,
  addStockAdjustment,
  type ProductWithStock,
} from '@/lib/inventoryService'
import { toArabicNumerals, formatCurrency } from '@/lib/utils'
import { compressImage } from '@/lib/imageUtils'
import {
  Search,
  Plus,
  SlidersHorizontal,
  Package,
  AlertTriangle,
  Boxes,
  BadgeDollarSign,
  ArrowUpDown,
  History,
  X,
  ScanLine,
  ImagePlus,
  Camera,
  Check,
} from 'lucide-react'
import { Link } from 'react-router-dom'

export default function ProductsPage() {
  const queryClient = useQueryClient()

  // Queries
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  })

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: fetchUnits,
  })

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: fetchWarehouses,
  })

  // State
  const [searchTerm, setSearchTerm]         = useState('')
  const [selectedCategory, setSelectedCat]   = useState<string>('all')
  const [onlyLowStock, setOnlyLowStock]     = useState(false)
  const [showAddModal, setShowAddModal]     = useState(false)
  const [adjustProduct, setAdjustProduct]   = useState<ProductWithStock | null>(null)
  const [editImageProduct, setEditImageProduct] = useState<ProductWithStock | null>(null)
  const [tempImageUrl, setTempImageUrl]     = useState<string | null>(null)
  const [imageError, setImageError]         = useState<string | null>(null)
  const [isCompressing, setIsCompressing]   = useState(false)

  // Form State for Add Product
  const [newProdNameAr, setNewProdNameAr]       = useState('')
  const [newProdSku, setNewProdSku]             = useState('')
  const [newProdBarcode, setNewProdBarcode]     = useState('')
  const [newProdCat, setNewProdCat]             = useState('')
  const [newProdUnit, setNewProdUnit]           = useState('')
  const [newProdCost, setNewProdCost]           = useState('')
  const [newProdPrice, setNewProdPrice]         = useState('')
  const [newProdWholesale, setNewProdWholesale] = useState('')
  const [newProdMinStock, setNewProdMinStock]   = useState('5')
  const [newProdInitStock, setNewProdInit]      = useState('0')
  const [newProdWh, setNewProdWh]               = useState('')
  const [newProdImage, setNewProdImage]         = useState<string | null>(null)

  // Form State for Stock Adjustment
  const [adjType, setAdjType]   = useState<'adjustment_in' | 'adjustment_out'>('adjustment_in')
  const [adjQty, setAdjQty]     = useState('1')
  const [adjNotes, setAdjNotes] = useState('')
  const [adjWh, setAdjWh]       = useState('')

  // Refs
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const addImageInputRef = useRef<HTMLInputElement>(null)
  const modalImageInputRef = useRef<HTMLInputElement>(null)

  // Mutations
  const addProductMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setShowAddModal(false)
      resetForm()
    },
  })

  const updateImageMutation = useMutation({
    mutationFn: ({ productId, imageUrl }: { productId: string; imageUrl: string | null }) =>
      updateProductImage(productId, imageUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setEditImageProduct(null)
      setTempImageUrl(null)
      setImageError(null)
    },
  })

  const adjustStockMutation = useMutation({
    mutationFn: addStockAdjustment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setAdjustProduct(null)
      setAdjQty('1')
      setAdjNotes('')
    },
  })

  const resetForm = () => {
    setNewProdNameAr('')
    setNewProdSku('')
    setNewProdBarcode('')
    setNewProdCat('')
    setNewProdUnit('')
    setNewProdCost('')
    setNewProdPrice('')
    setNewProdWholesale('')
    setNewProdMinStock('5')
    setNewProdInit('0')
    setNewProdWh('')
    setNewProdImage(null)
  }

  // Handle image upload with auto-compression for Add Modal
  const handleAddImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setIsCompressing(true)
      const compressed = await compressImage(file, 500, 500, 0.8)
      setNewProdImage(compressed)
    } catch {
      alert('حدث خطأ أثناء معالجة الصورة، يرجى اختيار ملف صورة صالح')
    } finally {
      setIsCompressing(false)
    }
  }

  // Handle image upload with auto-compression for Edit Image Modal
  const handleEditImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setIsCompressing(true)
      setImageError(null)
      const compressed = await compressImage(file, 500, 500, 0.8)
      setTempImageUrl(compressed)
    } catch {
      setImageError('حدث خطأ أثناء قراءة ملف الصورة')
    } finally {
      setIsCompressing(false)
    }
  }

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch =
        p.name_ar.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.barcode && p.barcode.includes(searchTerm))

      const matchCat =
        selectedCategory === 'all' || p.category_id === selectedCategory

      const matchLow = !onlyLowStock || p.current_stock <= p.min_stock

      return matchSearch && matchCat && matchLow
    })
  }, [products, searchTerm, selectedCategory, onlyLowStock])

  // Summary Metrics
  const totalItemsCount = products.length
  const totalStockUnits = products.reduce((acc, p) => acc + p.current_stock, 0)
  const totalValuation = products.reduce((acc, p) => acc + p.total_valuation, 0)
  const lowStockCount = products.filter((p) => p.current_stock <= p.min_stock).length

  return (
    <div className="space-y-6">

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">إدارة المنتجات والمخزون</h1>
          <p className="text-muted-foreground text-sm mt-1">
            سجل المنتجات الفعلي، مستويات المخزون الحالية، وأسعار الجملة والقطعة
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/movements"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
          >
            <History className="h-4 w-4 text-muted-foreground" />
            <span>سجل حركات المخزون</span>
          </Link>

          <button
            onClick={() => {
              if (categories.length > 0 && !newProdCat) setNewProdCat(categories[0].id)
              if (units.length > 0 && !newProdUnit) setNewProdUnit(units[0].id)
              if (warehouses.length > 0 && !newProdWh) setNewProdWh(warehouses[0].id)
              setNewProdSku(`SKU-${Math.floor(1000 + Math.random() * 9000)}`)
              setShowAddModal(true)
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة منتج جديد</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase">عدد المنتجات</span>
            <Package className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold text-foreground">
            {toArabicNumerals(totalItemsCount)}
          </div>
          <p className="text-[11px] text-muted-foreground">صنف مسجل في قاعدة البيانات</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase">الكمية المتوفرة الإجمالية</span>
            <Boxes className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-foreground">
            {toArabicNumerals(totalStockUnits.toLocaleString('ar-SA'))}
          </div>
          <p className="text-[11px] text-muted-foreground">قطعة / وحدة متوفرة</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase">إجمالي تقييم المخزون</span>
            <BadgeDollarSign className="h-4 w-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-foreground">
            {formatCurrency(totalValuation, 'ILS', '₪')}
          </div>
          <p className="text-[11px] text-muted-foreground">بسعر الجملة (شيكل ₪)</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase">تنبيهات نقص المخزون</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {toArabicNumerals(lowStockCount)}
          </div>
          <p className="text-[11px] text-muted-foreground">أصناف قاربت على النفاد</p>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="بحث باسم المنتج، رمز SKU، أو الباركود..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-input bg-background pr-9 pl-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Category Filter */}
          <div className="flex items-center gap-1.5 bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs text-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCat(e.target.value)}
              className="bg-transparent focus:outline-none text-xs text-foreground"
            >
              <option value="all">كل التصنيفات ({toArabicNumerals(products.length)})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_ar}
                </option>
              ))}
            </select>
          </div>

          {/* Low Stock Toggle */}
          <button
            onClick={() => setOnlyLowStock(!onlyLowStock)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              onlyLowStock
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
                : 'bg-background text-muted-foreground border-input hover:text-foreground'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>نواقص المخزون فقط</span>
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground text-sm animate-pulse">
            جارٍ تحميل بيانات المخزون من قاعدة البيانات المحلية...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground space-y-2">
            <Package className="h-8 w-8 mx-auto opacity-40" />
            <p className="text-sm font-medium">لا توجد منتجات مطابقة للبحث</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3 px-4">الصورة</th>
                  <th className="py-3 px-4">اسم المنتج</th>
                  <th className="py-3 px-4">SKU / الباركود</th>
                  <th className="py-3 px-4">التصنيف</th>
                  <th className="py-3 px-4">سعر الجملة</th>
                  <th className="py-3 px-4">سعر القطعة</th>
                  <th className="py-3 px-4">الكمية المتوفرة</th>
                  <th className="py-3 px-4">قيمة المخزون</th>
                  <th className="py-3 px-4 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredProducts.map((p) => {
                  const isLow = p.current_stock <= p.min_stock
                  const isOut = p.current_stock <= 0

                  return (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      {/* Image Thumbnail with Direct Click to Edit */}
                      <td className="py-2 px-4">
                        <button
                          type="button"
                          onClick={() => {
                            setEditImageProduct(p)
                            setTempImageUrl(p.image_url)
                            setImageError(null)
                          }}
                          className="relative group rounded-lg overflow-hidden border border-border hover:border-primary transition-all focus:outline-none focus:ring-2 focus:ring-primary block"
                          title="انقر لتغيير أو إضافة صورة للمنتج"
                        >
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.name_ar}
                              className="h-11 w-11 object-cover"
                            />
                          ) : (
                            <div className="h-11 w-11 bg-muted flex flex-col items-center justify-center text-[10px] text-muted-foreground hover:bg-muted/80">
                              <Camera className="h-4 w-4 opacity-60" />
                              <span className="text-[9px] mt-0.5">إضافة</span>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                            <Camera className="h-4 w-4" />
                          </div>
                        </button>
                      </td>

                      {/* Name */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-foreground">{p.name_ar}</div>
                        {p.name_en && (
                          <div className="text-[11px] text-muted-foreground font-mono" dir="ltr">
                            {p.name_en}
                          </div>
                        )}
                      </td>

                      {/* SKU / Barcode */}
                      <td className="py-3 px-4 text-xs font-mono text-muted-foreground">
                        <div>{p.sku}</div>
                        {p.barcode && <div className="text-[11px] opacity-75">{p.barcode}</div>}
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4 text-xs text-foreground">
                        <span className="bg-muted px-2 py-0.5 rounded-md font-medium">
                          {p.category_name || 'عام'}
                        </span>
                      </td>

                      {/* Wholesale Price (سعر الجملة) */}
                      <td className="py-3 px-4 text-xs font-mono text-muted-foreground">
                        {formatCurrency(p.wholesale_price > 0 ? p.wholesale_price : p.cost_price, 'ILS', '₪')}
                      </td>

                      {/* Selling Price (سعر القطعة) */}
                      <td className="py-3 px-4 text-xs font-mono font-bold text-foreground">
                        {formatCurrency(p.selling_price, 'ILS', '₪')}
                      </td>

                      {/* Stock Level (الكمية المتوفرة) */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              isOut
                                ? 'bg-red-500'
                                : isLow
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                          />
                          <span className="font-bold text-foreground">
                            {toArabicNumerals(p.current_stock)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {p.unit_symbol || 'حبة'}
                          </span>
                        </div>
                        {isLow && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                            حد الطلب: {toArabicNumerals(p.min_stock)}
                          </span>
                        )}
                      </td>

                      {/* Total Valuation */}
                      <td className="py-3 px-4 text-xs font-mono font-medium text-foreground">
                        {formatCurrency(p.total_valuation, 'ILS', '₪')}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Change Image Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setEditImageProduct(p)
                              setTempImageUrl(p.image_url)
                              setImageError(null)
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-border bg-card hover:bg-muted text-foreground transition-colors shadow-xs"
                            title="إضافة أو تعديل صورة المنتج"
                          >
                            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>الصورة</span>
                          </button>

                          {/* Adjustment Button */}
                          <button
                            type="button"
                            onClick={() => {
                              setAdjustProduct(p)
                              if (warehouses.length > 0) setAdjWh(warehouses[0].id)
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-border bg-card hover:bg-muted text-foreground transition-colors shadow-xs"
                            title="تسوية مخزنية سريعة"
                          >
                            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>تسوية</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: EDIT PRODUCT IMAGE */}
      {editImageProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-sm shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-foreground">صورة المنتج</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{editImageProduct.name_ar}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditImageProduct(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-center">
              {/* Image Preview Box */}
              <div className="flex justify-center">
                {tempImageUrl ? (
                  <div className="relative">
                    <img
                      src={tempImageUrl}
                      alt="معاينة"
                      className="h-40 w-40 rounded-xl object-cover border-2 border-primary shadow-md"
                    />
                    <button
                      type="button"
                      onClick={() => setTempImageUrl(null)}
                      className="absolute -top-2 -left-2 bg-destructive text-destructive-foreground rounded-full h-6 w-6 flex items-center justify-center shadow hover:bg-destructive/90"
                      title="إزالة الصورة"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => modalImageInputRef.current?.click()}
                    className="h-40 w-40 rounded-xl border-2 border-dashed border-border hover:border-primary bg-muted/40 flex flex-col items-center justify-center cursor-pointer transition-colors p-4"
                  >
                    <ImagePlus className="h-10 w-10 text-muted-foreground opacity-50 mb-2" />
                    <span className="text-xs text-muted-foreground font-medium">
                      انقر لاختيار صورة
                    </span>
                  </div>
                )}
              </div>

              {imageError && (
                <p className="text-xs text-destructive">{imageError}</p>
              )}

              {isCompressing && (
                <p className="text-xs text-primary animate-pulse">جارٍ معالجة وضغط الصورة...</p>
              )}

              <input
                ref={modalImageInputRef}
                type="file"
                accept="image/*"
                onChange={handleEditImageChange}
                className="hidden"
              />

              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => modalImageInputRef.current?.click()}
                  className="px-4 py-2 rounded-lg border border-border text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-1.5"
                >
                  <Camera className="h-4 w-4" />
                  <span>{tempImageUrl ? 'تغيير الصورة' : 'اختيار ملف صورة'}</span>
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditImageProduct(null)}
                  className="px-4 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={updateImageMutation.isPending || isCompressing}
                  onClick={() => {
                    updateImageMutation.mutate({
                      productId: editImageProduct.id,
                      imageUrl: tempImageUrl,
                    })
                  }}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Check className="h-4 w-4" />
                  <span>{updateImageMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ الصورة'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD PRODUCT */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
              <h3 className="font-bold text-base text-foreground">إضافة منتج جديد للمخزون</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                addProductMutation.mutate({
                  name_ar:         newProdNameAr,
                  sku:             newProdSku,
                  barcode:         newProdBarcode,
                  category_id:     newProdCat,
                  unit_id:         newProdUnit,
                  cost_price:      parseFloat(newProdCost) || 0,
                  selling_price:   parseFloat(newProdPrice) || 0,
                  wholesale_price: parseFloat(newProdWholesale) || parseFloat(newProdCost) || 0,
                  min_stock:       parseFloat(newProdMinStock) || 0,
                  initial_stock:   parseFloat(newProdInitStock) || 0,
                  warehouse_id:    newProdWh,
                  image_url:       newProdImage || undefined,
                })
              }}
              className="p-6 space-y-4 overflow-y-auto"
            >
              {/* Image Upload */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground">صورة المنتج</label>
                <div className="flex items-center gap-3">
                  {newProdImage ? (
                    <div className="relative">
                      <img
                        src={newProdImage}
                        alt="معاينة"
                        className="h-16 w-16 rounded-lg object-cover border border-border"
                      />
                      <button
                        type="button"
                        onClick={() => setNewProdImage(null)}
                        className="absolute -top-1.5 -left-1.5 bg-destructive text-destructive-foreground rounded-full h-4 w-4 flex items-center justify-center text-[10px]"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="h-16 w-16 rounded-lg border-2 border-dashed border-border bg-muted flex items-center justify-center cursor-pointer hover:border-primary transition-colors"
                      onClick={() => addImageInputRef.current?.click()}
                    >
                      <ImagePlus className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1">
                    <button
                      type="button"
                      onClick={() => addImageInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors"
                    >
                      {newProdImage ? 'تغيير الصورة' : 'اختيار صورة'}
                    </button>
                    <p className="text-[11px] text-muted-foreground mt-1">يتم ضغط الصورة وتحسينها تلقائياً</p>
                  </div>
                  <input
                    ref={addImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAddImageChange}
                    className="hidden"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">اسم المنتج بالعربية *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: زيت زيتون بكر 1 لتر"
                  value={newProdNameAr}
                  onChange={(e) => setNewProdNameAr(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">رمز SKU *</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={newProdSku}
                    onChange={(e) => setNewProdSku(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {/* Barcode with scanner support */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    الباركود
                    <span className="text-muted-foreground font-normal mr-1">(مسح بالليزر أو يدوي)</span>
                  </label>
                  <div className="relative">
                    <ScanLine className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <input
                      ref={barcodeInputRef}
                      type="text"
                      dir="ltr"
                      placeholder="امسح الباركود بالليزر..."
                      value={newProdBarcode}
                      onChange={(e) => setNewProdBarcode(e.target.value)}
                      className="w-full rounded-md border border-input bg-background pr-9 pl-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      onFocus={() => barcodeInputRef.current?.select()}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">التصنيف *</label>
                  <select
                    value={newProdCat}
                    onChange={(e) => setNewProdCat(e.target.value)}
                    required
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name_ar}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">وحدة القياس *</label>
                  <select
                    value={newProdUnit}
                    onChange={(e) => setNewProdUnit(e.target.value)}
                    required
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name_ar} ({u.symbol})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Prices: سعر الجملة وسعر القطعة */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">سعر الجملة (₪) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    dir="ltr"
                    placeholder="0.00"
                    value={newProdWholesale}
                    onChange={(e) => {
                      setNewProdWholesale(e.target.value)
                      if (!newProdCost) setNewProdCost(e.target.value)
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">سعر القطعة (₪) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    dir="ltr"
                    placeholder="0.00"
                    value={newProdPrice}
                    onChange={(e) => setNewProdPrice(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">الكمية الافتتاحية</label>
                  <input
                    type="number"
                    step="1"
                    dir="ltr"
                    value={newProdInitStock}
                    onChange={(e) => setNewProdInit(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">المستودع المستقبل</label>
                  <select
                    value={newProdWh}
                    onChange={(e) => setNewProdWh(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name_ar}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={addProductMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {addProductMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ المنتج'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: STOCK ADJUSTMENT */}
      {adjustProduct && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base text-foreground">تسوية مخزنية</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{adjustProduct.name_ar}</p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustProduct(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                adjustStockMutation.mutate({
                  product_id: adjustProduct.id,
                  warehouse_id: adjWh || warehouses[0]?.id || 'wh-1',
                  movement_type: adjType,
                  quantity: parseFloat(adjQty) || 1,
                  unit_cost: adjustProduct.cost_price,
                  notes: adjNotes || (adjType === 'adjustment_in' ? 'تسوية إضافة رصيد' : 'تسوية خصم تالف/عجز'),
                })
              }}
              className="p-6 space-y-4"
            >
              <div className="bg-muted/50 p-3 rounded-lg text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الكمية المتوفرة:</span>
                  <span className="font-bold text-foreground">
                    {toArabicNumerals(adjustProduct.current_stock)} {adjustProduct.unit_symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">سعر الجملة:</span>
                  <span className="font-mono">{formatCurrency(adjustProduct.wholesale_price || adjustProduct.cost_price, 'ILS', '₪')}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">نوع التسوية *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjType('adjustment_in')}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                      adjType === 'adjustment_in'
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    + إضافة للمخزون
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjType('adjustment_out')}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-colors ${
                      adjType === 'adjustment_out'
                        ? 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    - خصم من المخزون
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">الكمية *</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    required
                    dir="ltr"
                    value={adjQty}
                    onChange={(e) => setAdjQty(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">المستودع *</label>
                  <select
                    value={adjWh}
                    onChange={(e) => setAdjWh(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name_ar}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">ملاحظات / سبب التسوية</label>
                <input
                  type="text"
                  placeholder="مثال: تلف عبوات، فرق جرد دوري، إلخ"
                  value={adjNotes}
                  onChange={(e) => setAdjNotes(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setAdjustProduct(null)}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={adjustStockMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {adjustStockMutation.isPending ? 'جارٍ التسجيل...' : 'تأكيد التسوية'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
