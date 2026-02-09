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
  DocumentTypeSummary,
} from './types'

// Services
export {
  createDeal,
  getDeals,
  getDeal,
  getDealPages,
  getDealExternalImages,
  getDocumentTypeCountsForUser,
  uploadAndExtract,
  updatePageReview,
  getPageSignedUrl,
  mergeDeal,
  connectPhotos,
  archiveDeal,
  exportDealAsJson,
  exportDealAsCsv,
  exportAllDealsAsJson,
  formatDealDisplayName,
  formatDocumentType,
  formatDocumentTypeSummary,
} from './services/extractionService'
export type { DealExternalImage } from './services/extractionService'

export {
  createCheckout,
  getTransactions,
} from './services/billingService'

// Hooks
export { useAuth } from './hooks/useAuth'
export { useCredits } from './hooks/useCredits'
