import {
  importSharedProducts,
  type CategoryItem,
  type ProductWithStock,
  type SharedProductCatalogItem,
  type UnitItem,
} from '@/lib/inventoryService'
import { env, isSupabaseConfigured } from '@/config/env'
import { toArabicNumerals } from '@/lib/utils'
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
// Phone networks choke on parallel uploads — keep image uploads sequential-ish.
const IMAGE_UPLOAD_CONCURRENCY = 6
const RPC_MAX_ATTEMPTS = 3
const RPC_RETRY_DELAY_MS = 1500
const MAX_IMAGE_BYTES = 500_000

type ProductToShare = Omit<SharedProductCatalogItem, 'updated_at'>

export interface PushProgress {
  batch:     number   // finished batches
  batches:   number   // total batches
  processed: number   // rows accepted so far
  phase:     'images' | 'upload'
  phaseDone: number
  phaseTotal: number
}

export interface PushResult {
  processed: number
  skipped:   string[] // source_product_ids skipped (invalid or SKU/barcode clash)
  skippedNames: string[] // local product names matching the skipped ids
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

/** Run async jobs with bounded concurrency (safe on phones). */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onStep?: (done: number, total: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let done = 0
  const runner = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
      done++
      onStep?.(done, items.length)
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runner()
  )
  await Promise.all(runners)
  return results
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function parsePublishResponse(value: Json, batchIndex: number): Omit<PushResult, 'skippedNames'> {
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

  const aggregate: PushResult = { processed: 0, skipped: [], skippedNames: [] }

  for (let index = 0; index < products.length; index += PUSH_BATCH_SIZE) {
    const batch = products.slice(index, index + PUSH_BATCH_SIZE)
    const batchIndex = Math.floor(index / PUSH_BATCH_SIZE)
    const batches = Math.ceil(products.length / PUSH_BATCH_SIZE)

    const report = (phase: PushProgress['phase'], phaseDone: number, phaseTotal: number) =>
      onProgress?.({
        batch: batchIndex,
        batches,
        processed: aggregate.processed,
        phase,
        phaseDone,
        phaseTotal,
      })

    // Images upload with bounded concurrency so phones don't stall.
    const payload: ProductToShare[] = await mapWithConcurrency(
      batch,
      IMAGE_UPLOAD_CONCURRENCY,
      async (product) => {
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
      },
      (done, total) => report('images', done, total)
    )

    // The server reports bad rows as skipped; transport errors are retried.
    let batchResult: Omit<PushResult, 'skippedNames'> | null = null
    let lastError: unknown = null
    for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt++) {
      report('upload', attempt, RPC_MAX_ATTEMPTS)
      const { data, error } = await supabase.rpc('publish_shared_product_catalog', {
        p_products: payload,
      })
      if (!error && data !== null) {
        batchResult = parsePublishResponse(data, batchIndex)
        break
      }
      lastError = error ?? new Error(`لم يُرجع Supabase نتيجة الدفعة ${batchIndex + 1}.`)
      if (attempt < RPC_MAX_ATTEMPTS) await delay(RPC_RETRY_DELAY_MS * attempt)
    }
    if (!batchResult) {
      const reason = lastError instanceof Error ? lastError.message : String(lastError)
      throw new Error(`تعذر دفع الدفعة ${batchIndex + 1} من ${batches} بعد ${RPC_MAX_ATTEMPTS} محاولات: ${reason}`)
    }

    aggregate.processed += batchResult.processed
    aggregate.skipped.push(...batchResult.skipped)
    const namesById = new Map(products.map((p) => [p.id, p.name_ar] as const))
    aggregate.skippedNames = aggregate.skipped.map(
      (id, i) => namesById.get(id) ?? `منتج ${toArabicNumerals(i + 1)}`
    )
    onProgress?.({
      batch: batchIndex + 1,
      batches,
      processed: aggregate.processed,
      phase: 'upload',
      phaseDone: 1,
      phaseTotal: 1,
    })
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
