// Lib
export { initSupabase, getSupabase, getSupabaseUrl } from './lib/supabase'
export type { SupabaseConfig } from './lib/supabase'

// Types
export type {
  Deal,
  DocumentPage,
  CreditSummary,
  CreditTransaction,
  ExtractionResult,
  DealMessage,
  OllamaModel,
  ExtractionMode,
} from './types'

// Services
export {
  createDeal,
  getDeals,
  getDeal,
  getDealPages,
  uploadAndExtract,
  updatePageReview,
  getPageSignedUrl,
  mergeDeal,
  archiveDeal,
  exportDealAsJson,
  exportDealAsCsv,
} from './services/extractionService'

export {
  createCheckout,
  getTransactions,
} from './services/billingService'

// Hooks
export { useAuth } from './hooks/useAuth'
export { useCredits } from './hooks/useCredits'
