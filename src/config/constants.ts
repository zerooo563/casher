// Application-wide constants
// Business values (currency, etc.) come from tenant settings — never from here

export const APP_NAME = 'كاشر' as const
export const APP_NAME_EN = 'Casher' as const

// Eastern Arabic numeral map for display formatting
export const ARABIC_NUMERALS = '٠١٢٣٤٥٦٧٨٩' as const

// Supported locales
export const LOCALE_AR = 'ar' as const
export const LOCALE_EN = 'en' as const

// Route paths
export const ROUTES = {
  LOGIN:     '/login',
  DASHBOARD: '/',
  // Future phases will add routes here
} as const
