import {
  importSharedProducts,
  type CategoryItem,
  type ProductWithStock,
  type SharedProductCatalogItem,
  type UnitItem,
} from '@/lib/inventoryService'
import { env, isSupabaseConfigured } from '@/config/env'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'

/**
 * Temporary shared product catalog — ACCOUNT-LESS.
 *
 * Every device publishing the app link shares ONE workspace. No login:
 * the anon key may read/write only that workspace (enforced by RLS).
 * Used during the short collaborative data-entry phase (~5000 products),
 * then switched off when the app goes offline (Windows build).
 */
export const SHARED_WORKSPACE_ID = 'a1000000-0000-0000-0000-000000000001'

const MAX_SHARED_PRODUCTS = 10_000
const PUSH_BATCH_SIZE = 500
const MAX_IMAGE_BYTES = 500_000

type ProductToShare = Omit<SharedProductCatalogItem, 'updated_at'>

export interface PushProgress {
  batch:     number   // finished batches
  batches:   number   // total batches
  processed: number   // rows accepted so far
}

export interface PushResult {
  processed: number
  skipped:   string[] // source_product_ids skipped (invalid or SKU/barcode clash)
}

export interface PullResult {
  catalogSize: number
  created:     number
  updated:     number
  skipped:     string[]
}

function requireConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new Error('المزامنة السحابية غير مهيأة: أضف VITE_SUPABASE_URL والمفتاح في ملف .env.local ثم أعد تشغيل التطبيق.')
  }
}

function safeFileName(productId: string, mimeType: string): string {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  const safeId = productId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100)
  return `${safeId}.${extension}`
}

async function makeSharedImageUrl(
  productId: string,
  imageUrl: string | null
): Promise<string | null> {
  if (!imageUrl) return null
  const publicPrefix = `${env.supabase.url}/storage/v1/object/public/shared-product-images/${SHARED_WORKSPACE_ID}/`
  if (imageUrl.startsWith(publicPrefix)) return imageUrl
  if (!imageUrl.startsWith('data:image/')) {
    throw new Error(`صورة المنتج ${productId} ليست صورة محلية مضغوطة أو صورة مشاركة سابقة.`)
  }

  let image: Blob
  try {
    image = await (await fetch(imageUrl)).blob()
  } catch {
    throw new Error(`تعذرت قراءة صورة المنتج ${productId}.`)
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) {
    throw new Error(`صيغة صورة المنتج ${productId} غير مدعومة للمشاركة.`)
  }
  if (image.size > MAX_IMAGE_BYTES) {
    throw new Error(`صورة المنتج ${productId} أكبر من 500 كيلوبايت؛ أعد ضغطها قبل المشاركة.`)
  }

  const path = `${SHARED_WORKSPACE_ID}/${safeFileName(productId, image.type)}`
  const { error } = await supabase.storage
    .from('shared-product-images')
    .upload(path, image, { upsert: true, contentType: image.type, cacheControl: '31536000' })
  if (error) throw new Error(`فشل رفع صورة المنتج ${productId}: ${error.message}`)

  return supabase.storage.from('shared-product-images').getPublicUrl(path).data.publicUrl
}

function parsePublishResponse(value: Json, batchIndex: number): PushResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`استجابة الدفع للدفعة ${batchIndex + 1} غير صالحة.`)
  }
  const row = value as { [key: string]: Json | undefined }
  if (typeof row.processed !== 'number' || !Array.isArray(row.skipped)) {
    throw new Error(`استجابة الدفع للدفعة ${batchIndex + 1} غير صالحة.`)
  }
  return {
    processed: row.processed,
    skipped:   row.skipped.filter((s): s is string => typeof s === 'string'),
  }
}

function parseSharedCatalog(value: Json): SharedProductCatalogItem[] {
  if (!Array.isArray(value)) {
    throw new Error('استجابة كتالوج المنتجات من Supabase ليست قائمة صحيحة.')
  }

  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('تحتوي استجابة كتالوج المنتجات على سجل غير صالح.')
    }
    const row = item as { [key: string]: Json | undefined }
    const stringField = (key: string): string => {
      const field = row[key]
      if (typeof field !== 'string') throw new Error(`حقل ${key} مفقود من كتالوج المنتجات.`)
      return field
    }
    const nullableStringField = (key: string): string | null => {
      const field = row[key]
      if (field === null) return null
      if (typeof field !== 'string') throw new Error(`حقل ${key} غير صالح في كتالوج المنتجات.`)
      return field
    }
    const numberField = (key: string): number => {
      const field = row[key]
      if (typeof field !== 'number' || !Number.isFinite(field)) {
        throw new Error(`حقل ${key} غير صالح في كتالوج المنتجات.`)
      }
      return field
    }

    return {
      source_product_id: stringField('source_product_id'),
      name_ar: stringField('name_ar'),
      name_en: nullableStringField('name_en'),
      sku: stringField('sku'),
      barcode: nullableStringField('barcode'),
      category_name: nullableStringField('category_name'),
      unit_name: stringField('unit_name'),
      unit_symbol: stringField('unit_symbol'),
      cost_price: numberField('cost_price'),
      selling_price: numberField('selling_price'),
      wholesale_price: numberField('wholesale_price'),
      tax_rate: numberField('tax_rate'),
      min_stock: numberField('min_stock'),
      image_url: nullableStringField('image_url'),
      updated_at: stringField('updated_at'),
    }
  })
}

/**
 * Push local ACTIVE products to the shared cloud workspace.
 * Upsert by SKU in batches of 500 (safe for ~5000 products, with progress).
 * Stock balances and sales history are NEVER uploaded — catalog data only.
 */
export async function publishSharedCatalog(
  input: {
    products:   ProductWithStock[]
    categories: CategoryItem[]
    units:      UnitItem[]
  },
  onProgress?: (progress: PushProgress) => void
): Promise<PushResult> {
  requireConfigured()

  const products = input.products.filter((product) => product.is_active)
  if (products.length === 0) {
    throw new Error('لا توجد منتجات نشطة للدفع إلى السحابة.')
  }
  if (products.length > MAX_SHARED_PRODUCTS) {
    throw new Error(`لا يمكن دفع أكثر من ${MAX_SHARED_PRODUCTS.toLocaleString()} منتج في المرة الواحدة.`)
  }

  const categories = new Map(input.categories.map((category) => [category.id, category.name_ar]))
  const units = new Map(input.units.map((unit) => [unit.id, unit]))

  const aggregate: PushResult = { processed: 0, skipped: [] }

  for (let index = 0; index < products.length; index += PUSH_BATCH_SIZE) {
    const batch = products.slice(index, index + PUSH_BATCH_SIZE)
    const batchIndex = Math.floor(index / PUSH_BATCH_SIZE)
    const batches = Math.ceil(products.length / PUSH_BATCH_SIZE)

    const payload: ProductToShare[] = await Promise.all(batch.map(async (product) => {
      const unit = product.unit_id ? units.get(product.unit_id) : undefined
      if (!unit) throw new Error(`وحدة قياس المنتج «${product.name_ar}» غير موجودة.`)
      return {
        source_product_id: product.id,
        name_ar: product.name_ar,
        name_en: product.name_en,
        sku: product.sku,
        barcode: product.barcode,
        category_name: product.category_id ? categories.get(product.category_id) ?? null : null,
        unit_name: unit.name_ar,
        unit_symbol: unit.symbol,
        cost_price: product.cost_price,
        selling_price: product.selling_price,
        wholesale_price: product.wholesale_price,
        tax_rate: product.tax_rate,
        min_stock: product.min_stock,
        image_url: await makeSharedImageUrl(product.id, product.image_url),
      } satisfies ProductToShare
    }))

    const { data, error } = await supabase.rpc('publish_shared_product_catalog', {
      p_products: payload,
    })
    if (error) throw new Error(`تعذر دفع الدفعة ${batchIndex + 1} من ${batches}: ${error.message}`)
    if (data === null) throw new Error(`لم يُرجع Supabase نتيجة الدفعة ${batchIndex + 1}.`)

    const batchResult = parsePublishResponse(data, batchIndex)
    aggregate.processed += batchResult.processed
    aggregate.skipped.push(...batchResult.skipped)
    onProgress?.({ batch: batchIndex + 1, batches, processed: aggregate.processed })
  }

  return aggregate
}

/** Number of products currently stored in the shared cloud workspace. */
export async function fetchSharedCatalogCount(): Promise<number> {
  requireConfigured()
  const { count, error } = await supabase
    .from('shared_product_catalog')
    .select('source_product_id', { count: 'exact', head: true })
    .eq('tenant_id', SHARED_WORKSPACE_ID)
  if (error) throw new Error(`تعذر قراءة عدد منتجات السحابة: ${error.message}`)
  return count ?? 0
}

/**
 * Pull the shared cloud catalog into this device's local inventory.
 * Missing products are created with ZERO stock; sales and movements
 * stay local to this device. SKU/barcode clashes are skipped, not overwritten.
 */
export async function pullSharedCatalog(): Promise<PullResult> {
  requireConfigured()

  const { data, error } = await supabase.rpc('get_shared_product_catalog')
  if (error) throw new Error(`تعذر جلب الكتالوج المشترك: ${error.message}`)
  if (data === null) throw new Error('لم يُرجع Supabase الكتالوج المشترك.')

  const items = parseSharedCatalog(data)
  const result = await importSharedProducts(items)
  return {
    catalogSize: items.length,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
  }
}
