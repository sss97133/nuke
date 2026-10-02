/** Existing classifier, isolated for failure/receipt assays without hosted calls. */
export interface ClassifierReceipt {
  model: string | null;
  attempts: number;
  failure_phase?: string;
  error_class?: string;
  http_status?: number;
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
}

function UNCLASSIFIED_FALLBACK(receipt: ClassifierReceipt): ClassificationResult {
  return {
    image_type: "other",
    confidence: 0.2,
    is_automotive: true,
    description: "Unclassified — classifier unavailable; retained for review",
    classifier_ok: false,
    classifier_receipt: receipt,
  };
}

export async function classifyImage(
  imageUrl: string,
  geminiKey: string | undefined,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  pause: (ms: number) => Promise<void> = (ms) => new Promise(r => setTimeout(r, ms)),
): Promise<ClassificationResult> {
  const receipt: ClassifierReceipt = { model: null, attempts: 0 };
  if (!geminiKey) {
    return UNCLASSIFIED_FALLBACK({ ...receipt, failure_phase: "configuration", error_class: "classifier_key_missing" });
  }

  let base64Image: string;
  let mimeType: string;
  try {
    const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
    if (!imageResponse.ok) {
      return UNCLASSIFIED_FALLBACK({ ...receipt, failure_phase: "image_download", error_class: "image_http_error", http_status: imageResponse.status });
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    base64Image = btoa(new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""));
    mimeType = imageResponse.headers.get("content-type") || "image/jpeg";
  } catch (error) {
    return UNCLASSIFIED_FALLBACK({ ...receipt, failure_phase: "image_download", error_class: error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError") ? "image_download_timeout" : "image_download_error" });
  }

  // Root-cause note (2026-07-06 429/hollow-completion incident): this per-invocation
  // backoff can't fix a THUNDERING HERD — the orchestrator is a per-row pg_net trigger
  // (AFTER INSERT ... FOR EACH ROW), so a single bulk photo sync (hundreds of rows in
  // one INSERT batch) fires hundreds of concurrent invocations that each independently
  // hit the same Gemini key's RPM quota at once. Fixed exponential delays (1s/2s/4s in
  // lockstep across every concurrent invocation) synchronize the retries right back
  // into the same collision. MAX_RETRIES 3->5 + a delay cap + +/-30% jitter de-syncs
  // the herd (textbook thundering-herd mitigation) — it reduces, but cannot alone
  // eliminate, collisions under a large burst. The real backstop is Step 7 below no
  // longer lying about 'completed' when this budget is exhausted.
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 1000;
  const MAX_DELAY_MS = 8000;
  const jitteredDelay = (attempt: number) => {
    const capped = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
    return Math.round(capped * (0.7 + Math.random() * 0.6)); // +/-30% jitter
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      receipt.model = "gemini-2.5-flash";
      receipt.attempts = attempt + 1;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  text: `Classify this automotive image. Respond in JSON only:
{
  "image_type": one of ["vehicle_exterior", "vehicle_interior", "engine_bay", "undercarriage", "detail_closeup", "vin_plate", "part_closeup", "receipt_document", "progress_shot", "other"],
  "image_medium": one of ["photograph", "render", "drawing", "screenshot"],
  "medium_context": "brief explanation (e.g. '3D render of planned build', 'pencil sketch', 'screenshot from parts catalog', 'real photograph')",
  "confidence": 0.0-1.0,
  "is_automotive": true/false,
  "description": "brief description",
  "detected_text": ["any visible text/numbers"],
  "vin_detected": "17-char VIN if visible or null",
  "vehicle_hints": {"make": "...", "model": "...", "year_range": "...", "color": "..."}
}

image_medium definitions:
- "photograph": real camera photo of a physical vehicle
- "render": 3D render, CGI, digital mockup, or AI-generated image of a vehicle
- "drawing": hand-drawn sketch, pencil drawing, technical illustration, blueprint
- "screenshot": screenshot from a website, app, parts catalog, or software`,
                },
                {
                  inlineData: { mimeType, data: base64Image },
                },
              ],
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
              responseMimeType: "application/json",
              // Disable thinking for classification — it's unnecessary and consumes output tokens
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );

      // Rate limited — retry with capped exponential backoff + jitter (de-syncs
      // concurrent invocations from the same bulk-insert burst; see note above)
      if (response.status === 429) {
        const delay = jitteredDelay(attempt);
        console.warn(`[photo-pipeline] Gemini 429 (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms`);
        await pause(delay);
        continue;
      }

      if (!response.ok) {
        return UNCLASSIFIED_FALLBACK({ ...receipt, failure_phase: "classification", error_class: "classifier_http_error", http_status: response.status });
      }

      const result = await response.json();
      // Gemini 2.5+ may include thinking parts before the actual response
      // Find the last text part (thinking parts come first, JSON response last)
      const parts = result.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p: any) => p.text && !p.thought).pop()?.text
        || parts[parts.length - 1]?.text;

      if (!text) return UNCLASSIFIED_FALLBACK({ ...receipt, failure_phase: "response", error_class: "classifier_response_empty" });

      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError("invalid classifier object");
      const imageTypes: ImageType[] = ["vehicle_exterior", "vehicle_interior", "engine_bay", "undercarriage", "detail_closeup", "vin_plate", "part_closeup", "receipt_document", "progress_shot", "other"];
      if (!imageTypes.includes(parsed.image_type) || typeof parsed.is_automotive !== "boolean" ||
        typeof parsed.description !== "string" || typeof parsed.confidence !== "number" ||
        !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1) {
        throw new SyntaxError("invalid classifier fields");
      }
      return {
        image_type: parsed.image_type || "other",
        confidence: parsed.confidence,
        is_automotive: parsed.is_automotive !== false,
        description: parsed.description || "",
        detected_text: parsed.detected_text,
        vin_detected: parsed.vin_detected,
        image_medium: parsed.image_medium || "photograph",
        medium_context: parsed.medium_context,
        vehicle_hints: parsed.vehicle_hints,
        classifier_ok: true,
        classifier_receipt: { ...receipt },
      };
    } catch (error: any) {
      // Classifier failure must NOT churn the row itself (this function still never
      // throws — the caller always gets a usable ClassificationResult so downstream
      // resolveVehicle/routeByType/enqueueDeepByok/createObservation keep running).
      // What changed 2026-07-06: churn is no longer avoided by mislabeling the row
      // 'completed'. classifier_ok:false tells Step 7 to write 'failed' instead, and
      // reset_stuck_photo_pipeline_images() (hourly cron) already sweeps 'failed' with
      // a retry budget (ai_retry_count < 3 -> reset to 'pending' for a fresh pass with
      // new jittered backoff; >= 3 -> stays 'failed', honest terminal) — verified live
      // against the deployed function, so this does not reopen an infinite-loop.
      return UNCLASSIFIED_FALLBACK({ ...receipt, failure_phase: "classification", error_class: error instanceof SyntaxError ? "classifier_response_invalid" : error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError") ? "classifier_timeout" : "classifier_request_error" });
    }
  }

  // All retries exhausted on 429 — classifier_ok:false routes this to 'failed'
  // (Step 7's honest terminal state), not a silent fake 'completed'.
  return UNCLASSIFIED_FALLBACK({ ...receipt, failure_phase: "classification", error_class: "classifier_rate_limited", http_status: 429 });
}
