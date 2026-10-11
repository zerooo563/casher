import { PGlite } from '@electric-sql/pglite'
import { getInventoryAccountScope, getInventoryDatabaseName } from '@/lib/inventoryAccountScope'

let writeQueue: Promise<void> = Promise.resolve()
const pgliteInstances = new Map<string, PGlite>()
const dbInitializations = new Map<string, Promise<PGlite>>()

async function withInventoryWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request('casher-inventory-write', operation)
  }

  const previous = writeQueue
  let release!: () => void
  writeQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

function localMonthBounds(monthKey: string): { startAt: string; endAt: string } {
  const [year, month] = monthKey.split('-').map(Number)
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0, 23, 59, 59, 999)
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}

function currentLocalMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export async function getDb(): Promise<PGlite> {
  const accountScope = getInventoryAccountScope()
  const existingDb = pgliteInstances.get(accountScope)
  if (existingDb) return existingDb
  let initialization = dbInitializations.get(accountScope)
  if (!initialization) {
    const db = new PGlite(getInventoryDatabaseName(accountScope))
    initialization = (async () => {
      await db.waitReady
      await initSchema(db)
      pgliteInstances.set(accountScope, db)
      return db
    })().catch((error: unknown) => {
      dbInitializations.delete(accountScope)
      throw error
    })
    dbInitializations.set(accountScope, initialization)
  }
  return initialization
}

async function initSchema(db: PGlite) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      symbol TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      shared_source_id TEXT,
      category_id TEXT REFERENCES categories(id),
      unit_id TEXT REFERENCES units(id),
      name_ar TEXT NOT NULL,
      name_en TEXT,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT,
      cost_price NUMERIC(19,4) NOT NULL DEFAULT 0,
      selling_price NUMERIC(19,4) NOT NULL DEFAULT 0,
      wholesale_price NUMERIC(19,4) NOT NULL DEFAULT 0,
      tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.17,
      min_stock NUMERIC(15,3) NOT NULL DEFAULT 0,
      image_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL DEFAULT '',
      movement_type TEXT NOT NULL,
      quantity NUMERIC(15,3) NOT NULL,
      unit_cost NUMERIC(19,4) NOT NULL,
      total_cost NUMERIC(19,4) NOT NULL,
      reference_type TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      receipt_number TEXT NOT NULL UNIQUE,
      total_amount NUMERIC(19,4) NOT NULL DEFAULT 0,
      discount_amount NUMERIC(19,4) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES sales(id),
      product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity NUMERIC(15,3) NOT NULL,
      unit_price NUMERIC(19,4) NOT NULL,
      total_price NUMERIC(19,4) NOT NULL,
      cost_price_snapshot NUMERIC(19,4),
      cost_price_is_estimate BOOLEAN NOT NULL DEFAULT false
    );
  `)

  await migrateProductHistory(db)
  await ensureSaleCostSnapshots(db)

  // Add image_url and wholesale_price column if they don't exist (for existing DBs)
  try {
    await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;`)
    await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(19,4) NOT NULL DEFAULT 0;`)
    await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS shared_source_id TEXT;`)
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS products_shared_source_unique_idx
        ON products (shared_source_id)
        WHERE shared_source_id IS NOT NULL;
    `)
  } catch (error) {
    throw new Error(`تعذر تحديث بنية قاعدة المنتجات المحلية: ${String(error)}`)
  }

  await ensureUniqueProductBarcodes(db)
  await ensureUniqueCategoryNames(db)
  await ensureWholesalePriceRule(db)

  // Seed lookup data only. Product databases start empty; existing data is never reset.
  const catCheck = await db.query('SELECT count(*) as count FROM categories')
  const countVal = Number((catCheck.rows[0] as Record<string, unknown>)?.count ?? 0)
  if (countVal === 0) {
    await seedInitialReferenceData(db)
  }
}

async function ensureWholesalePriceRule(db: PGlite) {
  await db.exec('BEGIN;')
  try {
    const migrationId = 'wholesale-lte-selling-v1'
    const migration = await db.query(
      `SELECT id FROM app_migrations WHERE id = $1;`,
      [migrationId]
    )
    if (migration.rows.length === 0) {
      // Business rule: wholesale may equal the piece price but never exceed it.
      // Clamp legacy rows first so the constraint below can be created.
      await db.exec(`
        UPDATE products
        SET wholesale_price = selling_price, updated_at = now()
        WHERE wholesale_price > selling_price;
      `)
      await db.query(`INSERT INTO app_migrations (id) VALUES ($1);`, [migrationId])
    }
    await db.exec(`
      ALTER TABLE products DROP CONSTRAINT IF EXISTS products_wholesale_lte_selling;
      ALTER TABLE products
        ADD CONSTRAINT products_wholesale_lte_selling
        CHECK (wholesale_price <= selling_price);
    `)
    await db.exec('COMMIT;')
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

async function ensureUniqueProductBarcodes(db: PGlite) {
  await db.exec('BEGIN;')
  try {
    const migrationId = 'unique-product-barcodes-v1'
    const migration = await db.query(
      `SELECT id FROM app_migrations WHERE id = $1;`,
      [migrationId]
    )
    if (migration.rows.length === 0) {
      // Keep each product and its history; only ambiguous duplicate barcode values are cleared.
      await db.exec(`
        WITH ranked_barcodes AS (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY TRIM(barcode)
            ORDER BY created_at ASC, id ASC
          ) AS duplicate_rank
          FROM products
          WHERE barcode IS NOT NULL AND TRIM(barcode) <> ''
        )
        UPDATE products
        SET barcode = NULL
        WHERE id IN (
          SELECT id FROM ranked_barcodes WHERE duplicate_rank > 1
        );
      `)
    }
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_trim_unique_idx
        ON products (TRIM(barcode))
        WHERE barcode IS NOT NULL AND TRIM(barcode) <> '';
    `)
    if (migration.rows.length === 0) {
      await db.query(`INSERT INTO app_migrations (id) VALUES ($1);`, [migrationId])
    }
    await db.exec('COMMIT;')
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

async function ensureUniqueCategoryNames(db: PGlite) {
  await db.exec('BEGIN;')
  try {
    const migrationId = 'unique-category-names-v1'
    const migration = await db.query(
      `SELECT id FROM app_migrations WHERE id = $1;`,
      [migrationId]
    )
    if (migration.rows.length === 0) {
      await db.exec(`
        WITH ranked_categories AS (
          SELECT id, FIRST_VALUE(id) OVER (
            PARTITION BY LOWER(TRIM(name_ar))
            ORDER BY id ASC
          ) AS canonical_id,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(name_ar))
            ORDER BY id ASC
          ) AS duplicate_rank
          FROM categories
        )
        UPDATE products p
        SET category_id = ranked.canonical_id
        FROM ranked_categories ranked
        WHERE p.category_id = ranked.id AND ranked.duplicate_rank > 1;

        WITH ranked_categories AS (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(name_ar))
            ORDER BY id ASC
          ) AS duplicate_rank
          FROM categories
        )
        DELETE FROM categories
        WHERE id IN (
          SELECT id FROM ranked_categories WHERE duplicate_rank > 1
        );
      `)
    }
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS categories_name_normalized_unique_idx
        ON categories (LOWER(TRIM(name_ar)));
    `)
    if (migration.rows.length === 0) {
      await db.query(`INSERT INTO app_migrations (id) VALUES ($1);`, [migrationId])
    }
    await db.exec('COMMIT;')
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

async function migrateProductHistory(db: PGlite) {
  await db.exec('BEGIN;')
  try {
    await db.exec(`
      ALTER TABLE stock_movements
        ADD COLUMN IF NOT EXISTS product_name TEXT NOT NULL DEFAULT '';
      UPDATE stock_movements m
      SET product_name = p.name_ar
      FROM products p
      WHERE m.product_id = p.id AND m.product_name = '';

      ALTER TABLE stock_movements ALTER COLUMN product_id DROP NOT NULL;
      ALTER TABLE sale_items ALTER COLUMN product_id DROP NOT NULL;
      CREATE TABLE IF NOT EXISTS app_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)

    await ensureSetNullProductForeignKey(db, 'stock_movements')
    await ensureSetNullProductForeignKey(db, 'sale_items')

    const seedMigration = await db.query(
      `SELECT id FROM app_migrations WHERE id = $1;`,
      ['remove-seeded-demo-products-v1']
    )
    if (seedMigration.rows.length === 0) {
      await db.exec(`
        DELETE FROM stock_movements
        WHERE product_id IN ('p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8')
          AND reference_type = 'initial_count';
        DELETE FROM products
        WHERE id IN ('p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-7', 'p-8');
      `)
      await db.query(
        `INSERT INTO app_migrations (id) VALUES ($1);`,
        ['remove-seeded-demo-products-v1']
      )
    }

    await db.exec('COMMIT;')
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

async function ensureSaleCostSnapshots(db: PGlite) {
  await db.exec('BEGIN;')
  try {
    await db.exec(`
      ALTER TABLE sale_items
        ADD COLUMN IF NOT EXISTS cost_price_snapshot NUMERIC(19,4);
      ALTER TABLE sale_items
        ADD COLUMN IF NOT EXISTS cost_price_is_estimate BOOLEAN NOT NULL DEFAULT false;
      CREATE INDEX IF NOT EXISTS sales_created_at_idx ON sales (created_at);
      CREATE TABLE IF NOT EXISTS app_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)

    const migrationId = 'sale-item-cost-snapshot-v1'
    const migration = await db.query(
      `SELECT id FROM app_migrations WHERE id = $1;`,
      [migrationId]
    )
    if (migration.rows.length === 0) {
      await db.exec(`
        UPDATE sale_items si
        SET cost_price_snapshot = p.cost_price,
            cost_price_is_estimate = true
        FROM products p
        WHERE si.product_id = p.id
          AND si.cost_price_snapshot IS NULL;
      `)
      await db.query(`INSERT INTO app_migrations (id) VALUES ($1);`, [migrationId])
    }

    await db.exec('COMMIT;')
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

async function ensureSetNullProductForeignKey(db: PGlite, table: 'stock_movements' | 'sale_items') {
  const constraintName = `${table}_product_id_fkey`
  const existing = await db.query(
    `SELECT confdeltype
     FROM pg_constraint
     WHERE conrelid = $1::regclass AND conname = $2 AND contype = 'f';`,
    [table, constraintName]
  )
  const existingConstraint = existing.rows[0] as { confdeltype?: string } | undefined
  const onDeleteSetNull = existingConstraint?.confdeltype === 'n'
  if (onDeleteSetNull) return

  await db.exec(`
    ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraintName};
    ALTER TABLE ${table}
      ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
  `)
}

async function seedInitialReferenceData(db: PGlite) {
  await db.exec(`
    INSERT INTO categories (id, name_ar, description) VALUES
      ('cat-1', 'المواد الغذائية والتموينية', 'منتجات البقالة والأغذية الجافة'),
      ('cat-2', 'المشروبات والعصائر', 'المياه والمشروبات الغازية والعصائر'),
      ('cat-3', 'الألبان والأجبان', 'مشتقات الحليب والمنتجات المبردة'),
      ('cat-4', 'المنظفات والعناية', 'مواد التنظيف والعناية الشخصية');

    INSERT INTO units (id, name_ar, symbol) VALUES
      ('u-1', 'حبة / قطعة', 'حبة'),
      ('u-2', 'كيلوجرام', 'كجم'),
      ('u-3', 'كرتونة', 'كرتون'),
      ('u-4', 'لتر', 'لتر');

    INSERT INTO warehouses (id, name_ar, is_active) VALUES
      ('wh-1', 'المستودع الرئيسي — المتجر', true),
      ('wh-2', 'مستودع التخزين الخلفي', true);
  `)
}

// ---------------------------------------------------------------------------
// Data Access Methods (Transactional and Real SQL)
// ---------------------------------------------------------------------------

export interface ProductWithStock {
  id:              string
  name_ar:         string
  name_en:         string | null
  sku:             string
  barcode:         string | null
  category_id:     string | null
  category_name:   string | null
  unit_id:         string | null
  unit_symbol:     string | null
  cost_price:      number
  selling_price:   number
  wholesale_price: number
  tax_rate:        number
  min_stock:       number
  current_stock:   number
  ever_stocked:    boolean
  total_valuation: number
  image_url:       string | null
  is_active:       boolean
}

export interface SharedProductCatalogItem {
  source_product_id: string
  name_ar: string
  name_en: string | null
  sku: string
  barcode: string | null
  category_name: string | null
  unit_name: string
  unit_symbol: string
  cost_price: number
  selling_price: number
  wholesale_price: number
  tax_rate: number
  min_stock: number
  image_url: string | null
  updated_at: string
}

export interface SharedProductImportResult {
  created: number
  updated: number
  skipped: string[]
}

async function importSharedProductsTransaction(
  sharedProducts: SharedProductCatalogItem[]
): Promise<SharedProductImportResult> {
  const db = await getDb()
  const result: SharedProductImportResult = { created: 0, updated: 0, skipped: [] }
  if (sharedProducts.length === 0) return result

  const validProducts = sharedProducts.filter((product) => {
    const valid =
      typeof product.source_product_id === 'string' &&
      product.source_product_id.length > 0 &&
      typeof product.name_ar === 'string' &&
      typeof product.sku === 'string' &&
      typeof product.unit_name === 'string' &&
      typeof product.unit_symbol === 'string' &&
      Number.isFinite(Number(product.cost_price)) &&
      Number(product.cost_price) >= 0 &&
      Number.isFinite(Number(product.selling_price)) &&
      Number(product.selling_price) >= 0 &&
      Number.isFinite(Number(product.wholesale_price)) &&
      Number(product.wholesale_price) >= 0 &&
      Number(product.wholesale_price) <= Number(product.selling_price)
    if (!valid) result.skipped.push(product.name_ar || product.source_product_id || 'منتج غير معروف')
    return valid
  })
  if (validProducts.length === 0) return result

  await db.exec('BEGIN;')
  try {
    const payload = JSON.stringify(validProducts.map((product) => ({
      source_product_id: product.source_product_id,
      name_ar: product.name_ar,
      sku: product.sku,
      barcode: product.barcode?.trim() || null,
    })))
    const conflicts = await db.query(
      `WITH incoming AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(
           source_product_id TEXT, name_ar TEXT, sku TEXT, barcode TEXT
         )
       )
       SELECT DISTINCT i.source_product_id, i.name_ar
       FROM incoming i
       JOIN products p
         ON (p.sku = i.sku OR (
           i.barcode IS NOT NULL AND TRIM(i.barcode) <> ''
           AND p.barcode IS NOT NULL AND TRIM(p.barcode) = TRIM(i.barcode)
         ))
       WHERE p.shared_source_id IS DISTINCT FROM i.source_product_id;`,
      [payload]
    )
    const conflictsBySource = new Map(
      (conflicts.rows as Array<{ source_product_id: string; name_ar: string }>)
        .map((row) => [row.source_product_id, row.name_ar])
    )
    result.skipped.push(...conflictsBySource.values())
    const importable = validProducts.filter((product) => !conflictsBySource.has(product.source_product_id))
    if (importable.length === 0) {
      await db.exec('COMMIT;')
      return result
    }

    const categoryRows = await db.query('SELECT id, name_ar FROM categories;')
    const categoryIds = new Map(
      (categoryRows.rows as Array<{ id: string; name_ar: string }>)
        .map((row) => [row.name_ar.trim().toLocaleLowerCase(), row.id])
    )
    const unitRows = await db.query('SELECT id, name_ar, symbol FROM units;')
    const unitIds = new Map<string, string>()
    for (const unit of unitRows.rows as Array<{ id: string; name_ar: string; symbol: string }>) {
      unitIds.set(`${unit.name_ar.trim().toLocaleLowerCase()}|${unit.symbol.trim().toLocaleLowerCase()}`, unit.id)
    }

    const prepared = importable.map((product) => {
      const categoryName = product.category_name?.trim() || 'عام'
      const categoryKey = categoryName.toLocaleLowerCase()
      let categoryId = categoryIds.get(categoryKey)
      if (!categoryId) {
        categoryId = `shared-cat-${crypto.randomUUID()}`
        categoryIds.set(categoryKey, categoryId)
      }

      const unitName = product.unit_name.trim()
      const unitSymbol = product.unit_symbol.trim()
      const unitKey = `${unitName.toLocaleLowerCase()}|${unitSymbol.toLocaleLowerCase()}`
      let unitId = unitIds.get(unitKey)
      if (!unitId) {
        unitId = `shared-unit-${crypto.randomUUID()}`
        unitIds.set(unitKey, unitId)
      }
      return { ...product, category_id: categoryId, unit_id: unitId, category_name: categoryName }
    })

    const preparedCategoryKeys = new Set<string>()
    for (const product of prepared) {
      const key = product.category_name.toLocaleLowerCase()
      if (preparedCategoryKeys.has(key)) continue
      preparedCategoryKeys.add(key)
      const categoryId = categoryIds.get(key)
      if (categoryId?.startsWith('shared-cat-')) {
        await db.query(
          `INSERT INTO categories (id, name_ar) VALUES ($1, $2) ON CONFLICT DO NOTHING;`,
          [categoryId, product.category_name]
        )
      }
    }

    const preparedUnitKeys = new Set<string>()
    for (const product of prepared) {
      const key = `${product.unit_name.trim().toLocaleLowerCase()}|${product.unit_symbol.trim().toLocaleLowerCase()}`
      if (preparedUnitKeys.has(key)) continue
      preparedUnitKeys.add(key)
      const unitId = unitIds.get(key)
      if (unitId?.startsWith('shared-unit-')) {
        await db.query(
          `INSERT INTO units (id, name_ar, symbol) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;`,
          [unitId, product.unit_name.trim(), product.unit_symbol.trim()]
        )
      }
    }

    const existingShared = await db.query(
      `SELECT COUNT(*) AS count FROM products
       WHERE shared_source_id = ANY($1::text[]);`,
      [prepared.map((product) => product.source_product_id)]
    )
    const existingCount = Number((existingShared.rows[0] as { count: string | number }).count)

    await db.query(
      `INSERT INTO products (
         id, shared_source_id, category_id, unit_id, name_ar, name_en, sku, barcode,
         cost_price, selling_price, wholesale_price, tax_rate, min_stock, image_url, is_active
       )
       SELECT
         'shared-' || gen_random_uuid()::text, p.source_product_id, p.category_id, p.unit_id,
         p.name_ar, p.name_en, p.sku, NULLIF(TRIM(p.barcode), ''),
         p.cost_price, p.selling_price, p.wholesale_price, p.tax_rate, p.min_stock, p.image_url, true
       FROM jsonb_to_recordset($1::jsonb) AS p(
         source_product_id TEXT, category_id TEXT, unit_id TEXT, name_ar TEXT,
         name_en TEXT, sku TEXT, barcode TEXT, cost_price NUMERIC, selling_price NUMERIC,
         wholesale_price NUMERIC, tax_rate NUMERIC, min_stock NUMERIC, image_url TEXT
       )
       ON CONFLICT (shared_source_id) WHERE shared_source_id IS NOT NULL DO UPDATE SET
         category_id = EXCLUDED.category_id,
         unit_id = EXCLUDED.unit_id,
         name_ar = EXCLUDED.name_ar,
         name_en = EXCLUDED.name_en,
         sku = EXCLUDED.sku,
         barcode = EXCLUDED.barcode,
         cost_price = EXCLUDED.cost_price,
         selling_price = EXCLUDED.selling_price,
         wholesale_price = EXCLUDED.wholesale_price,
         tax_rate = EXCLUDED.tax_rate,
         min_stock = EXCLUDED.min_stock,
         image_url = EXCLUDED.image_url,
         is_active = true,
         updated_at = now();`,
      [JSON.stringify(prepared)]
    )
    result.updated = existingCount
    result.created = prepared.length - existingCount
    await db.exec('COMMIT;')
    return result
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

export function importSharedProducts(
  sharedProducts: SharedProductCatalogItem[]
): Promise<SharedProductImportResult> {
  return withInventoryWriteLock(() => importSharedProductsTransaction(sharedProducts))
}

export interface StockMovementRecord {
  id:             string
  warehouse_id:   string
  warehouse_name: string
  product_id:     string | null
  product_name:   string
  movement_type:  'opening' | 'purchase_receipt' | 'sale' | 'adjustment_in' | 'adjustment_out' | 'transfer_in' | 'transfer_out' | 'month_checkpoint'
  quantity:       number
  unit_cost:      number
  total_cost:     number
  notes:          string | null
  created_at:     string
}

export interface CategoryItem {
  id:          string
  name_ar:     string
  description: string | null
}

export interface UnitItem {
  id:      string
  name_ar: string
  symbol:  string
}

export interface WarehouseItem {
  id:        string
  name_ar:   string
  is_active: boolean
}

export interface SaleItem {
  product_id:   string | null
  product_name: string
  quantity:     number
  unit_price:   number
  total_price:  number
}

export interface SaleRecord {
  id:             string
  receipt_number: string
  total_amount:   number
  discount_amount: number
  notes:          string | null
  created_at:     string
  items:          SaleItem[]
}

export async function fetchProducts(includeInactive = false): Promise<ProductWithStock[]> {
  const db = await getDb()
  const activeFilter = includeInactive ? '' : 'WHERE p.is_active = true'
  // POS view (includeInactive = false): hide products that were NEVER stocked,
  // but KEEP products that had stock before and ran out (shown as unavailable).
  const everStockedExpr = `EXISTS (
        SELECT 1 FROM stock_movements m2
        WHERE m2.product_id = p.id AND CAST(m2.quantity AS FLOAT) > 0
      )`
  const availableStockFilter = includeInactive
    ? ''
    : `HAVING COALESCE(SUM(CAST(m.quantity AS FLOAT)), 0) > 0 OR ${everStockedExpr}`
  const query = `
    SELECT 
      p.id,
      p.name_ar,
      p.name_en,
      p.sku,
      p.barcode,
      p.category_id,
      c.name_ar as category_name,
      p.unit_id,
      u.symbol as unit_symbol,
      CAST(p.cost_price AS FLOAT) as cost_price,
      CAST(p.selling_price AS FLOAT) as selling_price,
      CAST(p.wholesale_price AS FLOAT) as wholesale_price,
      CAST(p.tax_rate AS FLOAT) as tax_rate,
      CAST(p.min_stock AS FLOAT) as min_stock,
      p.image_url,
      p.is_active,
      COALESCE(SUM(CAST(m.quantity AS FLOAT)), 0) as current_stock,
      EXISTS (
        SELECT 1 FROM stock_movements m2
        WHERE m2.product_id = p.id AND CAST(m2.quantity AS FLOAT) > 0
      ) as ever_stocked,
      (COALESCE(SUM(CAST(m.quantity AS FLOAT)), 0) * CAST(p.cost_price AS FLOAT)) as total_valuation
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN stock_movements m ON p.id = m.product_id
    ${activeFilter}
    GROUP BY p.id, c.name_ar, u.symbol
    ${availableStockFilter}
    ORDER BY p.name_ar ASC;
  `
  const res = await db.query(query)
  return res.rows as unknown as ProductWithStock[]
}

export async function findProductByBarcode(barcode: string): Promise<ProductWithStock | null> {
  const db = await getDb()
  const query = `
    SELECT 
      p.id,
      p.name_ar,
      p.name_en,
      p.sku,
      p.barcode,
      p.category_id,
      c.name_ar as category_name,
      p.unit_id,
      u.symbol as unit_symbol,
      CAST(p.cost_price AS FLOAT) as cost_price,
      CAST(p.selling_price AS FLOAT) as selling_price,
      CAST(p.wholesale_price AS FLOAT) as wholesale_price,
      CAST(p.tax_rate AS FLOAT) as tax_rate,
      CAST(p.min_stock AS FLOAT) as min_stock,
      p.image_url,
      p.is_active,
      COALESCE(SUM(CAST(m.quantity AS FLOAT)), 0) as current_stock,
      EXISTS (
        SELECT 1 FROM stock_movements m2
        WHERE m2.product_id = p.id AND CAST(m2.quantity AS FLOAT) > 0
      ) as ever_stocked,
      (COALESCE(SUM(CAST(m.quantity AS FLOAT)), 0) * CAST(p.cost_price AS FLOAT)) as total_valuation
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN stock_movements m ON p.id = m.product_id
    WHERE p.is_active = true AND (TRIM(p.barcode) = TRIM($1) OR p.sku = TRIM($1))
    GROUP BY p.id, c.name_ar, u.symbol
    LIMIT 1;
  `
  const res = await db.query(query, [barcode])
  if (res.rows.length === 0) return null
  return res.rows[0] as unknown as ProductWithStock
}

export interface SalesProfitSummary {
  netProfit: number
  estimatedCostItems: number
  unknownCostItems: number
}

export interface LedgerMonthArchive {
  month: string
  closed_at: string
  movements_count: number
  added_quantity: number
  sold_quantity: number
  inventory_capital: number
  sales_profit: number
  estimated_cost_items: number
  unknown_cost_items: number
  movement_details_removed: boolean
}

export async function fetchSalesProfitSummary(
  startAt?: string,
  endAt?: string
): Promise<SalesProfitSummary> {
  const db = await getDb()
  const conditions: string[] = []
  const params: string[] = []

  if (startAt) {
    params.push(startAt)
    conditions.push(`s.created_at >= $${params.length}::timestamptz`)
  }
  if (endAt) {
    params.push(endAt)
    conditions.push(`s.created_at <= $${params.length}::timestamptz`)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await db.query(
    `SELECT
       CAST(COALESCE(SUM(
         CASE WHEN si.cost_price_snapshot IS NOT NULL THEN
           si.total_price
           - CASE WHEN s.total_amount > 0
               THEN s.discount_amount * si.total_price / s.total_amount
               ELSE 0
             END
           - si.quantity * si.cost_price_snapshot
         ELSE 0 END
       ), 0) AS FLOAT) AS net_profit,
       COUNT(*) FILTER (WHERE si.cost_price_is_estimate = true) AS estimated_cost_items,
       COUNT(*) FILTER (WHERE si.cost_price_snapshot IS NULL) AS unknown_cost_items
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     ${whereClause};`,
    params
  )

  const row = result.rows[0] as {
    net_profit?: number | string
    estimated_cost_items?: number | string
    unknown_cost_items?: number | string
  } | undefined

  return {
    netProfit: Number(row?.net_profit ?? 0),
    estimatedCostItems: Number(row?.estimated_cost_items ?? 0),
    unknownCostItems: Number(row?.unknown_cost_items ?? 0),
  }
}

export async function fetchInventoryCapital(): Promise<number> {
  const db = await getDb()
  const result = await db.query(`
    SELECT CAST(COALESCE(SUM(
      GREATEST(COALESCE(stock.current_stock, 0), 0) * p.cost_price
    ), 0) AS FLOAT) AS inventory_capital
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(quantity) AS current_stock
      FROM stock_movements
      WHERE product_id IS NOT NULL
      GROUP BY product_id
    ) stock ON stock.product_id = p.id
    WHERE p.is_active = true;
  `)
  const row = result.rows[0] as { inventory_capital?: number | string } | undefined
  return Number(row?.inventory_capital ?? 0)
}

export async function fetchLedgerMonthArchives(): Promise<LedgerMonthArchive[]> {
  const db = await getDb()
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_month_closures (
      month TEXT PRIMARY KEY,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      movements_count INTEGER NOT NULL,
      added_quantity NUMERIC(19,4) NOT NULL,
      sold_quantity NUMERIC(19,4) NOT NULL,
      inventory_capital NUMERIC(19,4) NOT NULL,
      sales_profit NUMERIC(19,4) NOT NULL,
      estimated_cost_items INTEGER NOT NULL,
      unknown_cost_items INTEGER NOT NULL,
      movement_details_removed BOOLEAN NOT NULL DEFAULT false,
      stock_snapshot JSONB NOT NULL
    );
    ALTER TABLE ledger_month_closures
      ADD COLUMN IF NOT EXISTS movement_details_removed BOOLEAN NOT NULL DEFAULT false;
  `)
  const result = await db.query(`
    SELECT month, closed_at, movements_count,
      CAST(added_quantity AS FLOAT) AS added_quantity,
      CAST(sold_quantity AS FLOAT) AS sold_quantity,
      CAST(inventory_capital AS FLOAT) AS inventory_capital,
      CAST(sales_profit AS FLOAT) AS sales_profit,
      estimated_cost_items, unknown_cost_items, movement_details_removed
    FROM ledger_month_closures
    ORDER BY month DESC;
  `)
  return result.rows as unknown as LedgerMonthArchive[]
}

async function clearLedgerMonthArchivesTransaction(): Promise<number> {
  const db = await getDb()
  await db.exec('BEGIN;')
  try {
    await db.query('SELECT pg_advisory_xact_lock(72816449);')
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_month_closures (
        month TEXT PRIMARY KEY,
        closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        movements_count INTEGER NOT NULL,
        added_quantity NUMERIC(19,4) NOT NULL,
        sold_quantity NUMERIC(19,4) NOT NULL,
        inventory_capital NUMERIC(19,4) NOT NULL,
        sales_profit NUMERIC(19,4) NOT NULL,
        estimated_cost_items INTEGER NOT NULL,
        unknown_cost_items INTEGER NOT NULL,
        movement_details_removed BOOLEAN NOT NULL DEFAULT false,
        stock_snapshot JSONB NOT NULL
      );
      ALTER TABLE ledger_month_closures
        ADD COLUMN IF NOT EXISTS movement_details_removed BOOLEAN NOT NULL DEFAULT false;
    `)
    const compacted = await db.query(
      `SELECT month FROM ledger_month_closures
       WHERE movement_details_removed = true
       ORDER BY month LIMIT 1;`
    )
    if (compacted.rows.length > 0) {
      const row = compacted.rows[0] as { month: string }
      throw new Error(
        `لا يمكن مسح الأرشيف بالكامل؛ تفاصيل شهر ${row.month} مضغوطة ولا يمكن استعادة لقطة أرصدته وملخصه.`
      )
    }
    const deleted = await db.query('DELETE FROM ledger_month_closures RETURNING month;')
    await db.exec('COMMIT;')
    return deleted.rows.length
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

export function clearLedgerMonthArchives(): Promise<number> {
  return withInventoryWriteLock(clearLedgerMonthArchivesTransaction)
}

async function archiveLedgerMonthTransaction(input: {
  month: string
}): Promise<LedgerMonthArchive> {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error('اختر شهرًا صالحًا للأرشفة.')
  const monthNumber = Number(input.month.slice(5, 7))
  if (monthNumber < 1 || monthNumber > 12) throw new Error('اختر شهرًا صالحًا للأرشفة.')
  if (input.month >= currentLocalMonthKey()) throw new Error('لا يمكن أرشفة شهر لم يكتمل بعد.')
  const { startAt, endAt } = localMonthBounds(input.month)

  const db = await getDb()
  await db.exec('BEGIN;')
  try {
    await db.query('SELECT pg_advisory_xact_lock(72816449);')
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_month_closures (
        month TEXT PRIMARY KEY,
        closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        movements_count INTEGER NOT NULL,
        added_quantity NUMERIC(19,4) NOT NULL,
        sold_quantity NUMERIC(19,4) NOT NULL,
        inventory_capital NUMERIC(19,4) NOT NULL,
        sales_profit NUMERIC(19,4) NOT NULL,
        estimated_cost_items INTEGER NOT NULL,
        unknown_cost_items INTEGER NOT NULL,
        movement_details_removed BOOLEAN NOT NULL DEFAULT false,
        stock_snapshot JSONB NOT NULL
      );
      ALTER TABLE ledger_month_closures
        ADD COLUMN IF NOT EXISTS movement_details_removed BOOLEAN NOT NULL DEFAULT false;
    `)
    const existing = await db.query('SELECT month FROM ledger_month_closures WHERE month = $1;', [
      input.month,
    ])
    if (existing.rows.length) throw new Error('تمت أرشفة هذا الشهر مسبقًا.')

    const movementResult = await db.query(
      `SELECT
         COUNT(*) AS movements_count,
         COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END), 0) AS added_quantity,
         COALESCE(SUM(CASE WHEN movement_type = 'sale' THEN ABS(quantity) ELSE 0 END), 0) AS sold_quantity
       FROM stock_movements
       WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz;`,
      [startAt, endAt]
    )
    const profitResult = await db.query(
      `SELECT
         COALESCE(SUM(
           CASE WHEN si.cost_price_snapshot IS NOT NULL THEN
             si.total_price
             - CASE WHEN s.total_amount > 0
                 THEN s.discount_amount * si.total_price / s.total_amount
                 ELSE 0
               END
             - si.quantity * si.cost_price_snapshot
           ELSE 0 END
         ), 0) AS sales_profit,
         COUNT(*) FILTER (WHERE si.cost_price_is_estimate = true) AS estimated_cost_items,
         COUNT(*) FILTER (WHERE si.cost_price_snapshot IS NULL) AS unknown_cost_items
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       WHERE s.created_at >= $1::timestamptz AND s.created_at <= $2::timestamptz;`,
      [startAt, endAt]
    )
    const stockResult = await db.query(
      `SELECT p.id, p.name_ar, p.sku, p.barcode,
         m.warehouse_id, w.name_ar AS warehouse_name,
         CAST(p.cost_price AS FLOAT) AS cost_price,
         CAST(COALESCE(SUM(m.quantity), 0) AS FLOAT) AS stock_quantity
       FROM products p
       LEFT JOIN stock_movements m
         ON m.product_id = p.id AND m.created_at <= $1::timestamptz
       LEFT JOIN warehouses w ON w.id = m.warehouse_id
       GROUP BY p.id, m.warehouse_id, w.name_ar
       ORDER BY p.name_ar, w.name_ar;`,
      [endAt]
    )

    const movement = movementResult.rows[0] as Record<string, number | string>
    const profit = profitResult.rows[0] as Record<string, number | string>
    const stockSnapshot = stockResult.rows as Array<Record<string, string | number | null>>
    const inventoryCapital = stockSnapshot.reduce((total, product) => {
      const quantity = Math.max(0, Number(product.stock_quantity ?? 0))
      return total + quantity * Number(product.cost_price ?? 0)
    }, 0)

    const result = await db.query(
      `INSERT INTO ledger_month_closures (
         month, movements_count, added_quantity, sold_quantity, inventory_capital,
         sales_profit, estimated_cost_items, unknown_cost_items, stock_snapshot
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING month, closed_at, movements_count,
         CAST(added_quantity AS FLOAT) AS added_quantity,
         CAST(sold_quantity AS FLOAT) AS sold_quantity,
         CAST(inventory_capital AS FLOAT) AS inventory_capital,
         CAST(sales_profit AS FLOAT) AS sales_profit,
         estimated_cost_items, unknown_cost_items, movement_details_removed;`,
      [
        input.month,
        Number(movement.movements_count ?? 0),
        Number(movement.added_quantity ?? 0),
        Number(movement.sold_quantity ?? 0),
        inventoryCapital,
        Number(profit.sales_profit ?? 0),
        Number(profit.estimated_cost_items ?? 0),
        Number(profit.unknown_cost_items ?? 0),
        JSON.stringify(stockSnapshot),
      ]
    )
    await db.exec('COMMIT;')
    return result.rows[0] as unknown as LedgerMonthArchive
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

export function archiveLedgerMonth(
  input: Parameters<typeof archiveLedgerMonthTransaction>[0]
): Promise<LedgerMonthArchive> {
  return withInventoryWriteLock(() => archiveLedgerMonthTransaction(input))
}

async function compactArchivedLedgerMonthTransaction(input: { month: string }): Promise<number> {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error('اختر شهرًا صالحًا.')
  const monthNumber = Number(input.month.slice(5, 7))
  if (monthNumber < 1 || monthNumber > 12 || input.month >= currentLocalMonthKey()) {
    throw new Error('يمكن ضغط تفاصيل شهر مكتمل ومؤرشف فقط.')
  }
  const { startAt, endAt } = localMonthBounds(input.month)
  const db = await getDb()
  await db.exec('BEGIN;')
  try {
    await db.query('SELECT pg_advisory_xact_lock(72816449);')
    const archived = await db.query(
      `SELECT movement_details_removed
       FROM ledger_month_closures
       WHERE month = $1
       FOR UPDATE;`,
      [input.month]
    )
    const archive = archived.rows[0] as { movement_details_removed?: boolean } | undefined
    if (!archive) throw new Error('يجب حفظ أرشيف الشهر ولقطة المخزون أولاً.')
    if (archive.movement_details_removed) {
      throw new Error('تم ضغط تفاصيل حركات هذا الشهر مسبقًا.')
    }

    const aggregates = await db.query(
      `SELECT
         m.warehouse_id,
         m.product_id,
         CASE WHEN m.product_id IS NOT NULL THEN COALESCE(p.name_ar, m.product_name)
              ELSE m.product_name END AS product_name,
         COALESCE(p.cost_price, 0) AS unit_cost,
         SUM(m.quantity) AS net_quantity
       FROM stock_movements m
       LEFT JOIN products p ON p.id = m.product_id
       WHERE m.created_at >= $1::timestamptz AND m.created_at <= $2::timestamptz
       GROUP BY m.warehouse_id, m.product_id,
         CASE WHEN m.product_id IS NOT NULL THEN COALESCE(p.name_ar, m.product_name)
              ELSE m.product_name END,
         p.cost_price
       HAVING SUM(m.quantity) <> 0
       ORDER BY m.warehouse_id, m.product_id, product_name;`,
      [startAt, endAt]
    )
    const deleted = await db.query(
      `DELETE FROM stock_movements
       WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       RETURNING id;`,
      [startAt, endAt]
    )

    const checkpointTimestamp = new Date(endAt)
    for (const [index, row] of aggregates.rows.entries()) {
      const aggregate = row as {
        warehouse_id: string
        product_id: string | null
        product_name: string
        unit_cost: number | string
        net_quantity: number | string
      }
      const quantity = Number(aggregate.net_quantity)
      const unitCost = Number(aggregate.unit_cost)
      await db.query(
        `INSERT INTO stock_movements (
           id, warehouse_id, product_id, product_name, movement_type,
           quantity, unit_cost, total_cost, reference_type, notes, created_at
         )
         VALUES ($1,$2,$3,$4,'month_checkpoint',$5,$6,$7,'month_archive',$8,$9);`,
        [
          `month-${input.month}-${Date.now()}-${index}`,
          aggregate.warehouse_id,
          aggregate.product_id,
          aggregate.product_name,
          quantity,
          unitCost,
          quantity * unitCost,
          `رصيد مجمع بعد أرشفة ${input.month}؛ تفاصيل الحركات في الأرشيف.`,
          checkpointTimestamp.toISOString(),
        ]
      )
    }

    await db.query(
      `UPDATE ledger_month_closures
       SET movement_details_removed = true
       WHERE month = $1;`,
      [input.month]
    )
    await db.exec('COMMIT;')
    return deleted.rows.length
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

export function compactArchivedLedgerMonth(
  input: Parameters<typeof compactArchivedLedgerMonthTransaction>[0]
): Promise<number> {
  return withInventoryWriteLock(() => compactArchivedLedgerMonthTransaction(input))
}

export async function fetchStockMovements(productId?: string, limit = 1000): Promise<StockMovementRecord[]> {
  const db = await getDb()
  let query = `
    SELECT 
      m.id,
      m.warehouse_id,
      w.name_ar as warehouse_name,
      m.product_id,
      COALESCE(p.name_ar, m.product_name) as product_name,
      m.movement_type,
      CAST(m.quantity AS FLOAT) as quantity,
      CAST(m.unit_cost AS FLOAT) as unit_cost,
      CAST(m.total_cost AS FLOAT) as total_cost,
      m.notes,
      m.created_at
    FROM stock_movements m
    JOIN warehouses w ON m.warehouse_id = w.id
    LEFT JOIN products p ON m.product_id = p.id
  `
  const params: unknown[] = []
  if (productId) {
    query += ` WHERE m.product_id = $1`
    params.push(productId)
  }
  query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1};`
  params.push(limit)

  const res = await db.query(query, params)
  return res.rows as unknown as StockMovementRecord[]
}

async function createProductTransaction(input: {
  name_ar:         string
  name_en?:        string
  sku:             string
  barcode?:        string
  category_id:     string
  unit_id:         string
  cost_price:      number
  selling_price:   number
  wholesale_price?: number
  min_stock?:      number
  initial_stock?:  number
  warehouse_id?:   string
  image_url?:      string
}): Promise<string> {
  if (input.initial_stock !== undefined && input.initial_stock < 0) {
    throw new Error('لا يمكن أن تكون كمية المخزون سالبة.')
  }
  if ((input.wholesale_price || 0) > input.selling_price) {
    throw new Error('لا يمكن أن يكون سعر الجملة أكبر من سعر القطعة (يمكن أن يساويه).')
  }
  const db = await getDb()
  const id = `p-${Date.now()}`
  const barcode = input.barcode?.trim() || null

  await db.exec('BEGIN;')
  try {
    if (barcode) {
      const duplicateBarcode = await db.query(
        `SELECT id FROM products WHERE TRIM(barcode) = $1 LIMIT 1;`,
        [barcode]
      )
      if (duplicateBarcode.rows.length > 0) {
        throw new Error('هذا الباركود مسجل مسبقاً لمنتج آخر.')
      }
    }

    await db.query(
      `INSERT INTO products (id, category_id, unit_id, name_ar, name_en, sku, barcode, cost_price, selling_price, wholesale_price, min_stock, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`,
      [
        id,
        input.category_id,
        input.unit_id,
        input.name_ar,
        input.name_en || null,
        input.sku,
        barcode,
        input.cost_price,
        input.selling_price,
        input.wholesale_price || 0,
        input.min_stock || 0,
        input.image_url || null,
      ]
    )

    if (input.initial_stock && input.initial_stock > 0 && input.warehouse_id) {
      const totalCost = input.initial_stock * input.cost_price
      const movId = `mov-${Date.now()}`
      await db.query(
        `INSERT INTO stock_movements (id, warehouse_id, product_id, product_name, movement_type, quantity, unit_cost, total_cost, notes)
         VALUES ($1, $2, $3, $4, 'opening', $5, $6, $7, 'رصيد افتتاحي عند إنشاء المنتج');`,
        [movId, input.warehouse_id, id, input.name_ar, input.initial_stock, input.cost_price, totalCost]
      )
    }

    await db.exec('COMMIT;')
    return id
  } catch (err) {
    await db.exec('ROLLBACK;')
    const databaseError = err as { code?: unknown; constraint?: unknown }
    if (
      databaseError.code === '23505' &&
      databaseError.constraint === 'products_barcode_trim_unique_idx'
    ) {
      throw new Error('هذا الباركود مسجل مسبقاً لمنتج آخر.')
    }
    throw err
  }
}

export function createProduct(
  input: Parameters<typeof createProductTransaction>[0]
): Promise<string> {
  return withInventoryWriteLock(() => createProductTransaction(input))
}

async function deleteProductTransaction(productId: string): Promise<void> {
  const db = await getDb()
  await db.exec('BEGIN;')
  try {
    const result = await db.query(
      `DELETE FROM products WHERE id = $1 RETURNING id;`,
      [productId]
    )
    if (result.rows.length === 0) {
      throw new Error('المنتج غير موجود أو تم حذفه مسبقاً.')
    }

    await db.exec('COMMIT;')
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

export function deleteProduct(productId: string): Promise<void> {
  return withInventoryWriteLock(() => deleteProductTransaction(productId))
}

async function createSaleTransaction(input: {
  items: Array<{
    product_id:   string
    product_name: string
    quantity:     number
    unit_price:   number
  }>
  warehouse_id: string
  discount_amount?: number
  notes?: string
}): Promise<SaleRecord> {
  const db = await getDb()
  const saleId = `sale-${Date.now()}`
  const receiptNumber = `RCP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`
  const totalAmount = input.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const discountAmount = input.discount_amount || 0
  if (
    input.items.some(
      (item) => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0
    )
  ) {
    throw new Error('يجب أن تكون كمية وسعر كل منتج صالحين وغير سالبين.')
  }
  if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > totalAmount) {
    throw new Error('قيمة الخصم غير صالحة.')
  }

  await db.exec('BEGIN;')
  try {
    await db.query('SELECT pg_advisory_xact_lock(72816449);')
    // Insert sale header
    await db.query(
      `INSERT INTO sales (id, receipt_number, total_amount, discount_amount, notes)
       VALUES ($1, $2, $3, $4, $5);`,
      [saleId, receiptNumber, totalAmount, discountAmount, input.notes || null]
    )

    // Insert sale items + deduct from stock
    for (const item of input.items) {
      const activeProduct = await db.query(
        `SELECT p.id, p.cost_price, COALESCE(SUM(m.quantity), 0) AS current_stock
         FROM products p
         LEFT JOIN stock_movements m ON m.product_id = p.id
         WHERE p.id = $1 AND p.is_active = true
         GROUP BY p.id;`,
        [item.product_id]
      )
      if (activeProduct.rows.length === 0) {
        throw new Error('Cannot sell an archived or missing product.')
      }
      const productCostPrice = Number(
        (activeProduct.rows[0] as { cost_price: number | string }).cost_price
      )
      const availableStock = Number(
        (activeProduct.rows[0] as { current_stock: number | string }).current_stock
      )
      if (item.quantity > availableStock) {
        throw new Error(`المخزون غير كافٍ للمنتج: ${item.product_name}. المتاح ${availableStock}.`)
      }

      const itemId = `si-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const totalPrice = item.quantity * item.unit_price

      await db.query(
        `INSERT INTO sale_items (
           id, sale_id, product_id, product_name, quantity, unit_price, total_price, cost_price_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
        [
          itemId,
          saleId,
          item.product_id,
          item.product_name,
          item.quantity,
          item.unit_price,
          totalPrice,
          productCostPrice,
        ]
      )

      // Deduct from stock movements
      const movId = `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await db.query(
        `INSERT INTO stock_movements (id, warehouse_id, product_id, product_name, movement_type, quantity, unit_cost, total_cost, reference_type, notes)
         VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7, 'sale', $8);`,
        [movId, input.warehouse_id, item.product_id, item.product_name, -item.quantity, item.unit_price, totalPrice, `مبيعات - وصل ${receiptNumber}`]
      )
    }

    await db.exec('COMMIT;')

    return {
      id: saleId,
      receipt_number: receiptNumber,
      total_amount: totalAmount,
      discount_amount: discountAmount,
      notes: input.notes || null,
      created_at: new Date().toISOString(),
      items: input.items.map(item => ({
        product_id:   item.product_id,
        product_name: item.product_name,
        quantity:     item.quantity,
        unit_price:   item.unit_price,
        total_price:  item.quantity * item.unit_price,
      })),
    }
  } catch (err) {
    await db.exec('ROLLBACK;')
    throw err
  }
}

export function createSale(
  input: Parameters<typeof createSaleTransaction>[0]
): Promise<SaleRecord> {
  return withInventoryWriteLock(() => createSaleTransaction(input))
}

async function updateProductImageTransaction(productId: string, imageUrl: string | null): Promise<void> {
  const db = await getDb()
  await db.query(
    `UPDATE products SET image_url = $1, updated_at = now() WHERE id = $2;`,
    [imageUrl, productId]
  )
}

export function updateProductImage(productId: string, imageUrl: string | null): Promise<void> {
  return withInventoryWriteLock(() => updateProductImageTransaction(productId, imageUrl))
}

async function addStockAdjustmentTransaction(input: {
  product_id:   string
  warehouse_id: string
  movement_type: 'adjustment_in' | 'adjustment_out'
  quantity:     number
  unit_cost:    number
  notes:        string
}): Promise<void> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('يجب أن تكون كمية التسوية أكبر من صفر.')
  }
  const db = await getDb()
  const signedQty = input.movement_type === 'adjustment_in' ? Math.abs(input.quantity) : -Math.abs(input.quantity)
  const totalCost = Math.abs(input.quantity) * input.unit_cost
  const id = `mov-${Date.now()}`
  await db.exec('BEGIN;')
  try {
    await db.query('SELECT pg_advisory_xact_lock(72816449);')
    const product = await db.query(
      `SELECT p.name_ar, COALESCE(SUM(m.quantity), 0) AS current_stock
       FROM products p
       LEFT JOIN stock_movements m ON m.product_id = p.id
       WHERE p.id = $1 AND p.is_active = true
       GROUP BY p.id;`,
      [input.product_id]
    )
    const productRow = product.rows[0] as
      | { name_ar?: unknown; current_stock?: number | string }
      | undefined
    if (typeof productRow?.name_ar !== 'string') {
      throw new Error('لا يمكن تعديل مخزون منتج محذوف أو غير نشط.')
    }
    const currentStock = Number(productRow.current_stock ?? 0)
    if (input.movement_type === 'adjustment_out' && input.quantity > currentStock) {
      throw new Error(`لا يمكن خصم كمية أكبر من المخزون المتاح (${currentStock}).`)
    }

    await db.query(
      `INSERT INTO stock_movements (id, warehouse_id, product_id, product_name, movement_type, quantity, unit_cost, total_cost, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [id, input.warehouse_id, input.product_id, productRow.name_ar, input.movement_type, signedQty, input.unit_cost, totalCost, input.notes]
    )
    await db.exec('COMMIT;')
  } catch (error) {
    await db.exec('ROLLBACK;')
    throw error
  }
}

export function addStockAdjustment(
  input: Parameters<typeof addStockAdjustmentTransaction>[0]
): Promise<void> {
  return withInventoryWriteLock(() => addStockAdjustmentTransaction(input))
}

export async function fetchCategories(): Promise<CategoryItem[]> {
  const db = await getDb()
  const res = await db.query('SELECT * FROM categories ORDER BY name_ar ASC')
  return res.rows as unknown as CategoryItem[]
}

async function createCategoryTransaction(name: string): Promise<CategoryItem> {
  const normalizedName = name.trim()
  if (!normalizedName) {
    throw new Error('يرجى إدخال اسم التصنيف.')
  }

  const db = await getDb()
  const id = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await db.exec('BEGIN;')
  try {
    const duplicate = await db.query(
      `SELECT id FROM categories WHERE LOWER(TRIM(name_ar)) = LOWER($1) LIMIT 1;`,
      [normalizedName]
    )
    if (duplicate.rows.length > 0) {
      throw new Error('يوجد تصنيف بهذا الاسم بالفعل.')
    }

    await db.query(
      `INSERT INTO categories (id, name_ar) VALUES ($1, $2);`,
      [id, normalizedName]
    )
    await db.exec('COMMIT;')
    return { id, name_ar: normalizedName, description: null }
  } catch (error) {
    await db.exec('ROLLBACK;')
    const databaseError = error as { code?: unknown; constraint?: unknown }
    if (
      databaseError.code === '23505' &&
      databaseError.constraint === 'categories_name_normalized_unique_idx'
    ) {
      throw new Error('يوجد تصنيف بهذا الاسم بالفعل.')
    }
    throw error
  }
}

export function createCategory(name: string): Promise<CategoryItem> {
  return withInventoryWriteLock(() => createCategoryTransaction(name))
}

export async function fetchUnits(): Promise<UnitItem[]> {
  const db = await getDb()
  const res = await db.query('SELECT * FROM units ORDER BY name_ar ASC')
  return res.rows as unknown as UnitItem[]
}

async function createUnitTransaction(input: { name_ar: string; symbol: string }): Promise<UnitItem> {
  const name = input.name_ar.trim()
  const symbol = input.symbol.trim()
  if (!name || !symbol) throw new Error('أدخل اسم وحدة القياس ورمزها.')

  const db = await getDb()
  const duplicate = await db.query(
    'SELECT id FROM units WHERE LOWER(TRIM(name_ar)) = LOWER($1) OR LOWER(TRIM(symbol)) = LOWER($2) LIMIT 1;',
    [name, symbol]
  )
  if (duplicate.rows.length) throw new Error('اسم وحدة القياس أو رمزها مستخدم مسبقًا.')

  const unit: UnitItem = {
    id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name_ar: name,
    symbol,
  }
  await db.query('INSERT INTO units (id, name_ar, symbol) VALUES ($1, $2, $3);', [
    unit.id,
    unit.name_ar,
    unit.symbol,
  ])
  return unit
}

export function createUnit(input: { name_ar: string; symbol: string }): Promise<UnitItem> {
  return withInventoryWriteLock(() => createUnitTransaction(input))
}

export async function fetchWarehouses(): Promise<WarehouseItem[]> {
  const db = await getDb()
  const res = await db.query('SELECT * FROM warehouses WHERE is_active = true ORDER BY name_ar ASC')
  return res.rows as unknown as WarehouseItem[]
}
