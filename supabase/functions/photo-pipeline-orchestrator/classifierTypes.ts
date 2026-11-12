// Types shared by the classifier modules (leaf; no runtime code). Split from the v101 bundle to remove the classifier <-> provider module cycle.


/** Existing classifier, isolated for failure/receipt assays without hosted calls. */
export interface ClassifierReceipt {
  model: string | null;
  attempts: number;
  failure_phase?: string;
  error_class?: string;
  http_status?: number;
  image_bytes?: number;
  image_sha256?: string;
  input_sha256?: string;
  counted_input_tokens?: number;
  usage?: { prompt_tokens: number; output_tokens: number; thinking_tokens: number; total_tokens: number };
  estimated_cost_usd?: number;
  reserved_cost_usd?: number;
  model_version?: string;
  token_count_attempts?: number;
  quota?: { violations: Array<{ quota_metric: string | null; quota_id: string | null; quota_value: number | null; model: string | null; location: string | null }>; retry_delay_seconds: number | null };
  prompt_version?: string;
  retries?: number;
  retry_after_seconds?: number;
  image_resized?: string;
  fallback_error_class?: string;
  fallback_http_status?: number;
  timing_ms?: { image_download: number; token_count: number; generation: number; total: number };
}

// Image type classification categories
export type ImageType =
  | "vehicle_exterior"
  | "vehicle_interior"
  | "engine_bay"
  | "undercarriage"
  | "detail_closeup"
  | "vin_plate"
  | "part_closeup"
  | "receipt_document"
  | "progress_shot"
  | "other";

export type ImageMedium = 'photograph' | 'render' | 'drawing' | 'screenshot';

export interface ClassificationResult {
  image_type: ImageType;
  confidence: number;
  is_automotive: boolean;
  description: string;
  detected_text?: string[];
  vin_detected?: string;
  image_medium?: ImageMedium;
  medium_context?: string;
  vehicle_hints?: {
    make?: string;
    model?: string;
    year_range?: string;
    color?: string;
  };
  /**
   * false = this is NOT a real Gemini verdict — it's a stand-in produced because
   * the classifier was rate-limited, errored, or unconfigured. Root-cause fix
   * (2026-07-06, the 429/hollow-completion incident): this flag is what lets
   * Step 7 stop lying with ai_processing_status='completed'. Absent/true = a
   * real classification (or no classifier condition applies).
   */
  classifier_ok?: boolean;
  classifier_receipt?: ClassifierReceipt;
  /** v98: validated extras from the manifest-driven prompt (document/angle/VIN/text lines). Absent when the legacy prompt answered. */
  v2?: V2Extras;
}

export interface V2Extras {
  prompt_version: "v98";
  is_document: boolean;
  document_category: string | null;
  document_kind: string | null;
  document_type: string | null;
  angle: { value: string; confidence: number | null } | null;
  vin: { value: string; confidence: number | null; checksum_ok: boolean | null; evidence: string | null;
    evidence_role?: "vehicle_vin_plate" | "vehicle_vin_stamp" | "body_tag" | "engine_stamp" | "transmission_stamp" | "sticker" | "document" | "unknown" } | null;
  text_lines: Array<{ text: string; confidence: number; region: number[] | null }>;
  vehicle_fields: Array<{ field_name: string; value: string; confidence: number | null; evidence: string | null }>;
  document: { fields: Record<string, unknown>; field_confidence: Record<string, number> } | null;
}
