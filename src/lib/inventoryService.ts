import { PGlite } from '@electric-sql/pglite'

let pgliteInstance: PGlite | null = null

export async function getDb(): Promise<PGlite> {
  if (!pgliteInstance) {
    pgliteInstance = new PGlite('idb://casher_local_v1')
    await pgliteInstance.waitReady
    await initSchema(pgliteInstance)
  }
  return pgliteInstance
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
      product_id TEXT NOT NULL REFERENCES products(id),
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
      product_id TEXT NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity NUMERIC(15,3) NOT NULL,
      unit_price NUMERIC(19,4) NOT NULL,
      total_price NUMERIC(19,4) NOT NULL
    );
  `)

  // Add image_url and wholesale_price column if they don't exist (for existing DBs)
  try {
    await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;`)
    await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(19,4) NOT NULL DEFAULT 0;`)

    // Populate clear default product images if missing
    await db.exec(`
      UPDATE products SET image_url = 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=500&auto=format&fit=crop&q=80' WHERE id = 'p-1' AND (image_url IS NULL OR image_url = '');
      UPDATE products SET image_url = 'https://images.unsplash.com/photo-1581441363689-1f3c3c414635?w=500&auto=format&fit=crop&q=80' WHERE id = 'p-2' AND (image_url IS NULL OR image_url = '');
      UPDATE products SET image_url = 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=500&auto=format&fit=crop&q=80' WHERE id = 'p-3' AND (image_url IS NULL OR image_url = '');
      UPDATE products SET image_url = 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=500&auto=format&fit=crop&q=80' WHERE id = 'p-4' AND (image_url IS NULL OR image_url = '');
      UPDATE products SET image_url = 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=500&auto=format&fit=crop&q=80' WHERE id = 'p-5' AND (image_url IS NULL OR image_url = '');
      UPDATE products SET image_url = 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=80' WHERE id = 'p-6' AND (image_url IS NULL OR image_url = '');
      UPDATE products SET image_url = 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=500&auto=format&fit=crop&q=80' WHERE id = 'p-7' AND (image_url IS NULL OR image_url = '');
      UPDATE products SET image_url = 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=500&auto=format&fit=crop&q=80' WHERE id = 'p-8' AND (image_url IS NULL OR image_url = '');
    `)
  } catch {
    // columns already exist, ignore
  }

  // Check if initial categories and products exist
  const catCheck = await db.query('SELECT count(*) as count FROM categories')
  const countVal = Number((catCheck.rows[0] as Record<string, unknown>)?.count ?? 0)
  if (countVal === 0) {
    await seedInitialInventory(db)
  }
}

async function seedInitialInventory(db: PGlite) {
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

    -- Products with realistic initial barcodes, images, prices in ILS (₪)
    INSERT INTO products (id, category_id, unit_id, name_ar, name_en, sku, barcode, cost_price, selling_price, wholesale_price, tax_rate, min_stock, image_url) VALUES
      ('p-1', 'cat-1', 'u-1', 'أرز بسمتي فاخر 5 كجم', 'Basmati Rice 5kg', 'SKU-1001', '729000100101', 28.50, 39.90, 34.00, 0.17, 10, 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=500&auto=format&fit=crop&q=80'),
      ('p-2', 'cat-1', 'u-1', 'سكر أبيض ناعم 1 كجم', 'White Sugar 1kg', 'SKU-1002', '729000100102', 3.20, 4.90, 4.20, 0.17, 25, 'https://images.unsplash.com/photo-1581441363689-1f3c3c414635?w=500&auto=format&fit=crop&q=80'),
      ('p-3', 'cat-1', 'u-4', 'زيت نباتي صافي 1.5 لتر', 'Vegetable Oil 1.5L', 'SKU-1003', '729000100103', 12.00, 16.50, 14.50, 0.17, 15, 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=500&auto=format&fit=crop&q=80'),
      ('p-4', 'cat-2', 'u-1', 'مياه معدنية 6 × 1.5 لتر', 'Mineral Water 6-pack', 'SKU-2001', '729000100201', 8.50, 13.00, 11.00, 0.17, 20, 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=500&auto=format&fit=crop&q=80'),
      ('p-5', 'cat-2', 'u-1', 'عصير برتقال طبيعي 1 لتر', 'Orange Juice 1L', 'SKU-2002', '729000100202', 6.00, 9.50, 8.00, 0.17, 12, 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=500&auto=format&fit=crop&q=80'),
      ('p-6', 'cat-3', 'u-1', 'حليب كامل الدسم 1 لتر', 'Full Cream Milk 1L', 'SKU-3001', '729000100301', 4.80, 6.90, 6.00, 0.17, 30, 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=500&auto=format&fit=crop&q=80'),
      ('p-7', 'cat-3', 'u-2', 'جبنة صفراء بلدية بالكيلو', 'Local Yellow Cheese', 'SKU-3002', '729000100302', 32.00, 45.00, 39.00, 0.17, 5, 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=500&auto=format&fit=crop&q=80'),
      ('p-8', 'cat-4', 'u-1', 'سائل غسيل الأطباق 750 مل', 'Dishwashing Liquid', 'SKU-4001', '729000100401', 7.20, 11.50, 9.50, 0.17, 15, 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=500&auto=format&fit=crop&q=80');

    -- Seed initial stock movements ledger (Opening Balance)
    INSERT INTO stock_movements (id, warehouse_id, product_id, movement_type, quantity, unit_cost, total_cost, reference_type, notes) VALUES
      ('mov-1', 'wh-1', 'p-1', 'opening', 65, 28.50, 1852.50, 'initial_count', 'رصيد افتتاحي للمستودع الرئيسي'),
      ('mov-2', 'wh-1', 'p-2', 'opening', 120, 3.20, 384.00, 'initial_count', 'رصيد افتتاحي للمستودع الرئيسي'),
      ('mov-3', 'wh-1', 'p-3', 'opening', 45, 12.00, 540.00, 'initial_count', 'رصيد افتتاحي للمستودع الرئيسي'),
      ('mov-4', 'wh-1', 'p-4', 'opening', 80, 8.50, 680.00, 'initial_count', 'رصيد افتتاحي للمستودع الرئيسي'),
      ('mov-5', 'wh-1', 'p-5', 'opening', 40, 6.00, 240.00, 'initial_count', 'رصيد افتتاحي للمستودع الرئيسي'),
      ('mov-6', 'wh-1', 'p-6', 'opening', 90, 4.80, 432.00, 'initial_count', 'رصيد افتتاحي للمستودع الرئيسي'),
      ('mov-7', 'wh-1', 'p-7', 'opening', 18, 32.00, 576.00, 'initial_count', 'رصيد افتتاحي للمستودع الرئيسي'),
      ('mov-8', 'wh-1', 'p-8', 'opening', 55, 7.20, 396.00, 'initial_count', 'رصيد افتتاحي للمستودع الرئيسي');
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
  total_valuation: number
  image_url:       string | null
  is_active:       boolean
}

export interface StockMovementRecord {
  id:             string
  warehouse_id:   string
  warehouse_name: string
  product_id:     string
  product_name:   string
  movement_type:  'opening' | 'purchase_receipt' | 'sale' | 'adjustment_in' | 'adjustment_out' | 'transfer_in' | 'transfer_out'
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
  product_id:   string
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

export async function fetchProducts(): Promise<ProductWithStock[]> {
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
      (COALESCE(SUM(CAST(m.quantity AS FLOAT)), 0) * CAST(p.cost_price AS FLOAT)) as total_valuation
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN stock_movements m ON p.id = m.product_id
    GROUP BY p.id, c.name_ar, u.symbol
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
      (COALESCE(SUM(CAST(m.quantity AS FLOAT)), 0) * CAST(p.cost_price AS FLOAT)) as total_valuation
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN units u ON p.unit_id = u.id
    LEFT JOIN stock_movements m ON p.id = m.product_id
    WHERE p.barcode = $1 OR p.sku = $1
    GROUP BY p.id, c.name_ar, u.symbol
    LIMIT 1;
  `
  const res = await db.query(query, [barcode])
  if (res.rows.length === 0) return null
  return res.rows[0] as unknown as ProductWithStock
}

export async function fetchStockMovements(productId?: string): Promise<StockMovementRecord[]> {
  const db = await getDb()
  let query = `
    SELECT 
      m.id,
      m.warehouse_id,
      w.name_ar as warehouse_name,
      m.product_id,
      p.name_ar as product_name,
      m.movement_type,
      CAST(m.quantity AS FLOAT) as quantity,
      CAST(m.unit_cost AS FLOAT) as unit_cost,
      CAST(m.total_cost AS FLOAT) as total_cost,
      m.notes,
      m.created_at
    FROM stock_movements m
    JOIN warehouses w ON m.warehouse_id = w.id
    JOIN products p ON m.product_id = p.id
  `
  const params: unknown[] = []
  if (productId) {
    query += ` WHERE m.product_id = $1`
    params.push(productId)
  }
  query += ` ORDER BY m.created_at DESC LIMIT 100;`

  const res = await db.query(query, params)
  return res.rows as unknown as StockMovementRecord[]
}

export async function createProduct(input: {
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
  const db = await getDb()
  const id = `p-${Date.now()}`

  await db.exec('BEGIN;')
  try {
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
        input.barcode || null,
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
        `INSERT INTO stock_movements (id, warehouse_id, product_id, movement_type, quantity, unit_cost, total_cost, notes)
         VALUES ($1, $2, $3, 'opening', $4, $5, $6, 'رصيد افتتاحي عند إنشاء المنتج');`,
        [movId, input.warehouse_id, id, input.initial_stock, input.cost_price, totalCost]
      )
    }

    await db.exec('COMMIT;')
    return id
  } catch (err) {
    await db.exec('ROLLBACK;')
    throw err
  }
}

export async function createSale(input: {
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

  await db.exec('BEGIN;')
  try {
    // Insert sale header
    await db.query(
      `INSERT INTO sales (id, receipt_number, total_amount, discount_amount, notes)
       VALUES ($1, $2, $3, $4, $5);`,
      [saleId, receiptNumber, totalAmount, discountAmount, input.notes || null]
    )

    // Insert sale items + deduct from stock
    for (const item of input.items) {
      const itemId = `si-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const totalPrice = item.quantity * item.unit_price

      await db.query(
        `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [itemId, saleId, item.product_id, item.product_name, item.quantity, item.unit_price, totalPrice]
      )

      // Deduct from stock movements
      const movId = `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await db.query(
        `INSERT INTO stock_movements (id, warehouse_id, product_id, movement_type, quantity, unit_cost, total_cost, reference_type, notes)
         VALUES ($1, $2, $3, 'sale', $4, $5, $6, 'sale', $7);`,
        [movId, input.warehouse_id, item.product_id, -item.quantity, item.unit_price, totalPrice, `مبيعات - وصل ${receiptNumber}`]
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

export async function updateProductImage(productId: string, imageUrl: string | null): Promise<void> {
  const db = await getDb()
  await db.query(
    `UPDATE products SET image_url = $1, updated_at = now() WHERE id = $2;`,
    [imageUrl, productId]
  )
}

export async function addStockAdjustment(input: {
  product_id:   string
  warehouse_id: string
  movement_type: 'adjustment_in' | 'adjustment_out'
  quantity:     number
  unit_cost:    number
  notes:        string
}): Promise<void> {
  const db = await getDb()
  const signedQty = input.movement_type === 'adjustment_in' ? Math.abs(input.quantity) : -Math.abs(input.quantity)
  const totalCost = Math.abs(input.quantity) * input.unit_cost
  const id = `mov-${Date.now()}`

  await db.query(
    `INSERT INTO stock_movements (id, warehouse_id, product_id, movement_type, quantity, unit_cost, total_cost, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
    [id, input.warehouse_id, input.product_id, input.movement_type, signedQty, input.unit_cost, totalCost, input.notes]
  )
}

export async function fetchCategories(): Promise<CategoryItem[]> {
  const db = await getDb()
  const res = await db.query('SELECT * FROM categories ORDER BY name_ar ASC')
  return res.rows as unknown as CategoryItem[]
}

export async function fetchUnits(): Promise<UnitItem[]> {
  const db = await getDb()
  const res = await db.query('SELECT * FROM units ORDER BY name_ar ASC')
  return res.rows as unknown as UnitItem[]
}

export async function fetchWarehouses(): Promise<WarehouseItem[]> {
  const db = await getDb()
  const res = await db.query('SELECT * FROM warehouses WHERE is_active = true ORDER BY name_ar ASC')
  return res.rows as unknown as WarehouseItem[]
}
