import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { ARABIC_NUMERALS } from '@/config/constants'

/**
 * Merge Tailwind classes with conflict resolution.
 * Standard shadcn/ui utility.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Convert Western Arabic numerals (0-9) to Eastern Arabic numerals (٠-٩).
 *
 * Use for: prices, quantities, dates, totals displayed to users.
 * Do NOT use for: SKUs, barcodes, IDs, technical identifiers.
 *
 * @example toArabicNumerals(1234) → "١٢٣٤"
 * @example toArabicNumerals("2026-09-21") → "٢٠٢٦-٠٩-٢١"
 */
export function toArabicNumerals(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => ARABIC_NUMERALS[parseInt(d)])
}

/**
 * Format a monetary amount for display.
 * Currency symbol and locale come from tenant settings — never hardcoded.
 *
 * @param amount    - The numeric amount (stored as number/string from DB)
 * @param currency  - ISO 4217 currency code (e.g. 'ILS', 'USD')
 * @param symbol    - Currency symbol for display (e.g. '₪', '$')
 * @param arabicNumerals - Whether to convert to Eastern Arabic numerals
 *
 * @example formatCurrency(1234.5, 'ILS', '₪') → "١٬٢٣٤٫٥٠ ₪"
 */
export function formatCurrency(
  amount: number | string,
  _currency: string,
  symbol: string,
  arabicNumerals = true
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount

  if (isNaN(num)) return arabicNumerals ? `٠٫٠٠ ${symbol}` : `0.00 ${symbol}`

  // Format with 2 decimal places and thousands separator
  const formatted = new Intl.NumberFormat('ar-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(num)

  // Intl.NumberFormat with ar-SA already returns Eastern Arabic numerals.
  // If Western numerals are explicitly requested, convert back.
  const display = arabicNumerals ? formatted : formatted.replace(/[٠-٩]/g, (d) =>
    String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  )

  return `${display} ${symbol}`
}

/**
 * Safely parse a UUID from a JWT claim.
 * Returns null if the value is missing or not a valid UUID.
 */
export function parseUUID(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(value) ? value : null
}
