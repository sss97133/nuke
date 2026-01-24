/**
 * Extraction Health Logging Utility
 *
 * Provides field-level extraction logging for the self-healing system.
 * Import this in extractors to log each field extraction attempt.
 *
 * Usage:
 *   const logger = new ExtractionLogger(supabase, {
 *     source: 'bat',
 *     extractorName: 'bat-simple-extract',
 *     extractorVersion: '1.0',
 *     sourceUrl: 'https://bringatrailer.com/...',
 *     vehicleId: 'uuid...',
 *   });
 *
 *   logger.logField('vin', result.vin, 0.95);  // extracted with confidence
 *   logger.logField('price', null);             // not found
 *   logger.logFieldError('mileage', 'PARSE_ERROR', 'Could not parse value');
 *
 *   await logger.flush();  // Send all logs to database
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ExtractionStatus =
  | "extracted"
  | "not_found"
  | "parse_error"
  | "validation_fail"
  | "low_confidence";

export interface FieldLog {
  vehicle_id: string | null;
  extraction_run_id: string;
  source: string;
  source_url: string | null;
  extractor_name: string;
  extractor_version: string | null;
  field_name: string;
  extraction_status: ExtractionStatus;
  extracted_value: string | null;
  confidence_score: number | null;
  error_code: string | null;
  error_details: any;
  extraction_time_ms: number | null;
}

export interface ExtractionLoggerConfig {
  source: string;
  extractorName: string;
  extractorVersion?: string;
  sourceUrl?: string;
  vehicleId?: string;
  /** Confidence threshold below which status becomes 'low_confidence' */
  lowConfidenceThreshold?: number;
}

/**
 * Collects field extraction logs and batch-inserts them to field_extraction_log
 */
export class ExtractionLogger {
  private supabase: SupabaseClient;
  private config: ExtractionLoggerConfig;
  private extractionRunId: string;
  private logs: Partial<FieldLog>[] = [];
  private startTime: number;
  private fieldTimers: Map<string, number> = new Map();

  constructor(supabase: SupabaseClient, config: ExtractionLoggerConfig) {
    this.supabase = supabase;
    this.config = config;
    this.extractionRunId = crypto.randomUUID();
    this.startTime = Date.now();
  }

  /**
   * Start timing a field extraction
   */
  startField(fieldName: string): void {
    this.fieldTimers.set(fieldName, Date.now());
  }

  /**
   * Log a successful field extraction
   */
  logField(
    fieldName: string,
    value: any,
    confidence: number = 1.0,
    options?: { expectedValue?: string }
  ): void {
    const extractionTimeMs = this.getFieldTime(fieldName);

    // Determine status based on value and confidence
    let status: ExtractionStatus = "extracted";
    if (value === null || value === undefined || value === "") {
      status = "not_found";
    } else if (
      confidence < (this.config.lowConfidenceThreshold ?? 0.5)
    ) {
      status = "low_confidence";
    }

    this.logs.push({
      vehicle_id: this.config.vehicleId ?? null,
      extraction_run_id: this.extractionRunId,
      source: this.config.source,
      source_url: this.config.sourceUrl ?? null,
      extractor_name: this.config.extractorName,
      extractor_version: this.config.extractorVersion ?? null,
      field_name: fieldName,
      extraction_status: status,
      extracted_value: value !== null && value !== undefined ? String(value) : null,
      confidence_score: confidence,
      error_code: null,
      error_details: null,
      extraction_time_ms: extractionTimeMs,
    });
  }

  /**
   * Log multiple fields at once (convenience method)
   */
  logFields(
    fields: Record<string, any>,
    confidence: number = 1.0
  ): void {
    for (const [fieldName, value] of Object.entries(fields)) {
      this.logField(fieldName, value, confidence);
    }
  }

  /**
   * Log a field extraction error
   */
  logFieldError(
    fieldName: string,
    errorCode: string,
    errorDetails?: any,
    options?: { attemptedValue?: string }
  ): void {
    const extractionTimeMs = this.getFieldTime(fieldName);

    this.logs.push({
      vehicle_id: this.config.vehicleId ?? null,
      extraction_run_id: this.extractionRunId,
      source: this.config.source,
      source_url: this.config.sourceUrl ?? null,
      extractor_name: this.config.extractorName,
      extractor_version: this.config.extractorVersion ?? null,
      field_name: fieldName,
      extraction_status: "parse_error",
      extracted_value: options?.attemptedValue ?? null,
      confidence_score: null,
      error_code: errorCode,
      error_details: errorDetails ? JSON.stringify(errorDetails) : null,
      extraction_time_ms: extractionTimeMs,
    });
  }

  /**
   * Log a validation failure (value extracted but failed validation)
   */
  logValidationFail(
    fieldName: string,
    value: any,
    errorCode: string,
    errorDetails?: any
  ): void {
    const extractionTimeMs = this.getFieldTime(fieldName);

    this.logs.push({
      vehicle_id: this.config.vehicleId ?? null,
      extraction_run_id: this.extractionRunId,
      source: this.config.source,
      source_url: this.config.sourceUrl ?? null,
      extractor_name: this.config.extractorName,
      extractor_version: this.config.extractorVersion ?? null,
      field_name: fieldName,
      extraction_status: "validation_fail",
      extracted_value: value !== null ? String(value) : null,
      confidence_score: null,
      error_code: errorCode,
      error_details: errorDetails ? JSON.stringify(errorDetails) : null,
      extraction_time_ms: extractionTimeMs,
    });
  }

  /**
   * Update the vehicle ID (useful when vehicle is created after extraction starts)
   */
  setVehicleId(vehicleId: string): void {
    this.config.vehicleId = vehicleId;
    // Update all pending logs
    for (const log of this.logs) {
      log.vehicle_id = vehicleId;
    }
  }

  /**
   * Get the extraction run ID (for linking to other tables)
   */
  getRunId(): string {
    return this.extractionRunId;
  }

  /**
   * Get extraction summary stats
   */
  getSummary(): {
    totalFields: number;
    extracted: number;
    notFound: number;
    errors: number;
    avgConfidence: number;
    totalTimeMs: number;
  } {
    const extracted = this.logs.filter(l => l.extraction_status === "extracted").length;
    const notFound = this.logs.filter(l => l.extraction_status === "not_found").length;
    const errors = this.logs.filter(l =>
      l.extraction_status === "parse_error" ||
      l.extraction_status === "validation_fail"
    ).length;

    const confidences = this.logs
      .filter(l => l.confidence_score !== null)
      .map(l => l.confidence_score as number);
    const avgConfidence = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

    return {
      totalFields: this.logs.length,
      extracted,
      notFound,
      errors,
      avgConfidence,
      totalTimeMs: Date.now() - this.startTime,
    };
  }

  /**
   * Flush all logs to the database
   */
  async flush(): Promise<{ success: boolean; count: number; error?: string }> {
    if (this.logs.length === 0) {
      return { success: true, count: 0 };
    }

    try {
      // Prepare logs with created_at
      const logsToInsert = this.logs.map(log => ({
        ...log,
        created_at: new Date().toISOString(),
      }));

      const { error } = await this.supabase
        .from("field_extraction_log")
        .insert(logsToInsert);

      if (error) {
        console.error("Failed to insert extraction logs:", error);
        return { success: false, count: 0, error: error.message };
      }

      const count = this.logs.length;
      this.logs = []; // Clear after successful insert
      return { success: true, count };
    } catch (err: any) {
      console.error("Exception inserting extraction logs:", err);
      return { success: false, count: 0, error: err.message };
    }
  }

  private getFieldTime(fieldName: string): number | null {
    const startTime = this.fieldTimers.get(fieldName);
    if (startTime) {
      this.fieldTimers.delete(fieldName);
      return Date.now() - startTime;
    }
    return null;
  }
}

/**
 * Quick helper to log extraction results without the full class
 * Useful for simple extractors or one-off logging
 */
export async function logExtractionResults(
  supabase: SupabaseClient,
  config: {
    source: string;
    extractorName: string;
    sourceUrl?: string;
    vehicleId?: string;
  },
  results: Record<string, { value: any; confidence?: number; error?: string }>
): Promise<void> {
  const logger = new ExtractionLogger(supabase, {
    source: config.source,
    extractorName: config.extractorName,
    sourceUrl: config.sourceUrl,
    vehicleId: config.vehicleId,
  });

  for (const [fieldName, result] of Object.entries(results)) {
    if (result.error) {
      logger.logFieldError(fieldName, result.error);
    } else {
      logger.logField(fieldName, result.value, result.confidence ?? 1.0);
    }
  }

  await logger.flush();
}

/**
 * VIN validation helper
 */
export function validateVin(vin: string | null): {
  valid: boolean;
  errorCode?: string;
  errorDetails?: string;
} {
  if (!vin) {
    return { valid: false, errorCode: "VIN_MISSING" };
  }

  // Basic length check (modern VINs are 17 chars)
  if (vin.length === 17) {
    // Check for invalid characters (I, O, Q not allowed)
    if (/[IOQ]/i.test(vin)) {
      return {
        valid: false,
        errorCode: "INVALID_VIN_CHARS",
        errorDetails: "VIN contains I, O, or Q which are not allowed",
      };
    }

    // Basic format check
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) {
      return {
        valid: false,
        errorCode: "INVALID_VIN_FORMAT",
        errorDetails: "VIN contains invalid characters",
      };
    }

    return { valid: true };
  }

  // Pre-1981 vehicles may have shorter chassis numbers (6-13 chars typically)
  if (vin.length >= 6 && vin.length < 17) {
    if (/^[A-Z0-9*-]+$/i.test(vin)) {
      return { valid: true }; // Accept as chassis number
    }
    return {
      valid: false,
      errorCode: "INVALID_CHASSIS_FORMAT",
      errorDetails: "Chassis number contains invalid characters",
    };
  }

  return {
    valid: false,
    errorCode: "INVALID_VIN_LENGTH",
    errorDetails: `VIN length ${vin.length} is invalid`,
  };
}

/**
 * Price parsing helper with validation
 */
export function parsePrice(priceStr: string | null): {
  value: number | null;
  confidence: number;
  error?: string;
} {
  if (!priceStr) {
    return { value: null, confidence: 0 };
  }

  // Remove currency symbols and formatting
  const cleaned = priceStr
    .replace(/[$€£¥,\s]/g, "")
    .replace(/k$/i, "000") // Handle "27k" notation
    .trim();

  const value = parseFloat(cleaned);

  if (isNaN(value)) {
    return {
      value: null,
      confidence: 0,
      error: "PARSE_ERROR",
    };
  }

  // Sanity check for vehicle prices
  if (value < 0) {
    return {
      value: null,
      confidence: 0,
      error: "NEGATIVE_PRICE",
    };
  }

  if (value > 100000000) {
    // $100M seems unreasonable
    return {
      value,
      confidence: 0.5,
      error: "PRICE_TOO_HIGH",
    };
  }

  return { value, confidence: 1.0 };
}

/**
 * Mileage parsing helper with validation
 */
export function parseMileage(mileageStr: string | null): {
  value: number | null;
  confidence: number;
  error?: string;
} {
  if (!mileageStr) {
    return { value: null, confidence: 0 };
  }

  // Handle "TMU" (True Mileage Unknown)
  if (/tmu|unknown|exempt/i.test(mileageStr)) {
    return { value: null, confidence: 0.5 };
  }

  // Remove commas and units
  const cleaned = mileageStr
    .replace(/[,\s]/g, "")
    .replace(/k$/i, "000")
    .replace(/miles?|mi|km|kilometers?/gi, "")
    .trim();

  const value = parseInt(cleaned, 10);

  if (isNaN(value)) {
    return {
      value: null,
      confidence: 0,
      error: "PARSE_ERROR",
    };
  }

  if (value < 0) {
    return {
      value: null,
      confidence: 0,
      error: "NEGATIVE_MILEAGE",
    };
  }

  // Warn on very high mileage (but still accept)
  if (value > 500000) {
    return { value, confidence: 0.7 };
  }

  return { value, confidence: 1.0 };
}
