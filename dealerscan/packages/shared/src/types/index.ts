export interface Deal {
  id: string
  user_id: string
  deal_name: string | null
  status: 'pending' | 'processing' | 'review' | 'completed' | 'archived'
  merged_data: Record<string, any>
  vin: string | null
  year: number | null
  make: string | null
  model: string | null
  owner_name: string | null
  deal_date: string | null
  sale_price: number | null
  total_pages: number
  pages_extracted: number
  pages_needing_review: number
  created_at: string
  updated_at: string
}

export interface DocumentPage {
  id: string
  deal_id: string
  user_id: string
  storage_path: string
  original_filename: string | null
  page_number: number
  document_type: string | null
  document_type_confidence: number
  extracted_data: Record<string, any>
  confidences: Record<string, number>
  raw_ocr_text: string | null
  extraction_provider: string | null
  extraction_model: string | null
  needs_review: boolean
  review_status: 'pending' | 'auto_accepted' | 'user_reviewed' | 'user_rejected'
  user_edits: Record<string, any>
  uploaded_at: string
  extracted_at: string | null
}

export interface CreditSummary {
  free_remaining: number
  free_limit: number
  paid_remaining: number
  total_available: number
}

export interface CreditTransaction {
  id: string
  amount: number
  transaction_type: string
  description: string | null
  balance_after: number
  created_at: string
}

export interface ExtractionResult {
  page_id: string
  document_type: string
  needs_review: boolean
  review_reasons: string[]
  credits_remaining: number
  credit_source: string
  extracted_data: Record<string, any>
  confidences: Record<string, number>
}

export interface DealMessage {
  id: string
  deal_id: string
  source: 'imessage' | 'sms' | 'android'
  sender: string
  recipient: string
  message_text: string
  sent_at: string
  matched_fields: string[]
  match_confidence: number
  conversation_id: string | null
  created_at: string
}

export interface OllamaModel {
  name: string
  size: number
  modified_at: string
  supportsVision: boolean
}

export type ExtractionMode = 'cloud' | 'local' | 'hybrid'

/** Per-deal summary of document types for display (e.g. "Title (1), Bill of sale (2)") */
export interface DocumentTypeSummary {
  total: number
  byType: Record<string, number>
}
