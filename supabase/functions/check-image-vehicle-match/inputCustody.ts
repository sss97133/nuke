import { VisionProviderUnavailable, safeProviderDiagnostics, type ProviderDiagnostic, type ProviderAttemptCoverage } from "../_shared/providerDiagnostic.ts";

/** Binary image custody for this owner's comparison and grouping reads. This
 * fetches image objects, not HTML pages. No thumbnail is chosen automatically.
 * Provider selection, credentials and billing remain in visionFallback.ts.
 */
export interface VisionInputSource {
  key: string;
  image_id: string | null;
  source_url: string;
  storage_path?: string | null;
  expected_source_sha256?: string | null;
  representation: "source" | "derivative";
  input_url?: string;
  expected_input_sha256?: string | null;
  input_accept?: "image/jpeg";
  required?: boolean;
}

export const VISION_INPUT_LIMITS = Object.freeze({
  image_bytes: 4 * 1024 * 1024, total_bytes: 16 * 1024 * 1024,
  inputs: 14, image_ms: 10_000, total_ms: 30_000, output_tokens: 1600,
});
type Limits = { [Key in keyof typeof VISION_INPUT_LIMITS]: number };
export interface InputCustodyOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  limits?: Partial<Limits>;
  signal?: AbortSignal;
}

export interface VisionInputReceipt {
  key: string;
  image_id: string | null;
  source_url: string;
  input_url: string;
  representation: VisionInputSource["representation"];
  expected_source_sha256: string | null;
  expected_input_sha256: string | null;
  input_sha256: string;
  byte_length: number;
  mime_type: string;
  request_accept: "image/jpeg" | null;
  captured_at: string;
  source_qualified: boolean;
  source_sha256: string | null;
  source_bytes_qualified: boolean;
  derivation_qualified: boolean;
  derivation?: TrustedRenderDerivation;
}
export interface PinnedVisionInput { key: string; data_uri: string; receipt: VisionInputReceipt }
export interface UnavailableVisionInput {
  key: string;
  image_id: string | null;
  required: boolean;
  code: string;
  observed_input_sha256?: string;
}
export interface VisionInputCapture {
  inputs: PinnedVisionInput[];
  unavailable: UnavailableVisionInput[];
  required_available: boolean;
  bytes_read: number;
}

class InputRefusal extends Error {
  constructor(public code: string, public observed_input_sha256?: string) { super(code); }
}
const shaKey = (value: unknown): string | null =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
export const visionInputSHA256 = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))))
    .map(value => value.toString(16).padStart(2, "0")).join("");

function limitsFor(options: InputCustodyOptions): Limits {
  // Larger output is an explicit new-mode request. Existing comparisons retain400.
  const limits = { ...VISION_INPUT_LIMITS, output_tokens: 400, ...options.limits };
  for (const key of Object.keys(limits) as Array<keyof Limits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > VISION_INPUT_LIMITS[key]) {
      throw new InputRefusal("input_limit_invalid");
    }
  }
  return limits;
}

function httpURL(value: string): string {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return value;
  } catch { throw new InputRefusal("input_url_invalid"); }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    return Promise.reject(new InputRefusal("input_aborted"));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new InputRefusal("input_aborted"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function signatureMatches(bytes: Uint8Array, mime: string): boolean {
  const starts = (...prefix: number[]) => prefix.every((value, i) => bytes[i] === value);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (mime === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (mime === "image/heic" || mime === "image/heif") return ascii(4, 8) === "ftyp" &&
    ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif", "heim", "heis", "hevm", "hevs"].includes(ascii(8, 12));
  return false;
}

function dataURI(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** One bounded snapshot per distinct input URL. Valid SHA256 expectations refuse
 * changed bytes; missing/legacy hashes retain measured input identity without
 * claiming an independently qualified source. Optional failures remain explicit.
 */
export async function captureVisionInputs(
  sources: VisionInputSource[], options: InputCustodyOptions = {},
): Promise<VisionInputCapture> {
  const limits = limitsFor(options);
  if (!sources.length || sources.length > limits.inputs || new Set(sources.map(source => source.key)).size !== sources.length ||
    sources.some(source => typeof source.key !== "string" || !source.key || source.key.length > 128)) {
    throw new InputRefusal("input_scope_invalid");
  }
  const inputs: PinnedVisionInput[] = [], unavailable: UnavailableVisionInput[] = [];
  const total = new AbortController();
  const timer = setTimeout(() => total.abort(), limits.total_ms);
  const stageSignal = options.signal ? AbortSignal.any([total.signal, options.signal]) : total.signal;
  const abortRefusal = () => new InputRefusal(total.signal.aborted ? "capture_deadline_exceeded"
    : options.signal?.aborted ? "capture_aborted" : "input_deadline_exceeded");
  let bytesRead = 0;
  type Snapshot = { bytes: Uint8Array; mime: string; sha256: string; captured_at: string; data_uri: string };
  const snapshots = new Map<string, Snapshot | InputRefusal>();
  try {
    // Required query/source images cannot be starved by optional references.
    for (const source of [...sources.filter(source => source.required), ...sources.filter(source => !source.required)]) {
      const signal = AbortSignal.any([stageSignal, AbortSignal.timeout(limits.image_ms)]);
      try {
        if (signal.aborted) throw abortRefusal();
        const sourceURL = httpURL(source.source_url);
        const inputURL = httpURL(source.input_url ?? sourceURL);
        if (source.input_accept !== undefined && source.input_accept !== "image/jpeg") throw new InputRefusal("input_accept_invalid");
        if (source.representation !== "source" && source.representation !== "derivative") throw new InputRefusal("input_representation_invalid");
        if (source.representation === "source" && inputURL !== sourceURL) throw new InputRefusal("source_representation_url_mismatch");
        const snapshotKey = `${inputURL}\n${source.input_accept ?? ""}`;
        let snapshot = snapshots.get(snapshotKey);
        if (snapshot instanceof InputRefusal) throw snapshot;
        if (!snapshot) {
          let response: Response | undefined;
          try {
            if (bytesRead >= limits.total_bytes) throw new InputRefusal("input_total_bytes_exhausted");
            response = await abortable((options.fetch ?? globalThis.fetch)(inputURL, { redirect: "error", signal,
              ...(source.input_accept ? { headers: { Accept: source.input_accept } } : {}) }), signal);
            if (response.redirected || (response.status >= 300 && response.status < 400)) throw new InputRefusal("input_redirect_refused");
            if (!response.ok) throw new InputRefusal("input_http_error");
            const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
            if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime)) throw new InputRefusal("input_mime_invalid");
            const remaining = limits.total_bytes - bytesRead;
            const declared = Number(response.headers.get("content-length"));
            if (Number.isFinite(declared) && declared > Math.min(limits.image_bytes, remaining)) throw new InputRefusal("input_bytes_exceeded");
            if (!response.body) throw new InputRefusal("input_empty");
            const reader = response.body.getReader(), chunks: Uint8Array[] = [];
            let size = 0;
            try {
              while (true) {
                const { done, value } = await abortable(reader.read(), signal);
                if (done) break;
                bytesRead += value.byteLength; size += value.byteLength;
                if (size > limits.image_bytes || bytesRead > limits.total_bytes) throw new InputRefusal("input_bytes_exceeded");
                chunks.push(value);
              }
            } catch (error) {
              void reader.cancel().catch(() => {});
              throw error;
            } finally { reader.releaseLock(); }
            if (!size) throw new InputRefusal("input_empty");
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            if (!signatureMatches(bytes, mime)) throw new InputRefusal("input_signature_invalid");
            snapshot = { bytes, mime, sha256: await visionInputSHA256(bytes),
              captured_at: (options.now ?? (() => new Date()))().toISOString(), data_uri: dataURI(bytes, mime) };
            snapshots.set(snapshotKey, snapshot);
          } catch (error) {
            void response?.body?.cancel().catch(() => {});
            const refusal = signal.aborted ? abortRefusal()
              : error instanceof InputRefusal ? error : new InputRefusal("input_fetch_failed");
            snapshots.set(snapshotKey, refusal);
            throw refusal;
          }
        }
        const expectedSource = shaKey(source.expected_source_sha256);
        const expectedInput = shaKey(source.expected_input_sha256);
        if ((expectedInput && expectedInput !== snapshot.sha256) ||
          (source.representation === "source" && expectedSource && expectedSource !== snapshot.sha256)) {
          throw new InputRefusal("input_sha256_mismatch", snapshot.sha256);
        }
        inputs.push({ key: source.key, data_uri: snapshot.data_uri, receipt: {
          key: source.key, image_id: source.image_id, source_url: sourceURL, input_url: inputURL,
          representation: source.representation, expected_source_sha256: expectedSource, expected_input_sha256: expectedInput,
          input_sha256: snapshot.sha256, byte_length: snapshot.bytes.byteLength, mime_type: snapshot.mime,
          captured_at: snapshot.captured_at, request_accept: source.input_accept ?? null,
          source_qualified: source.representation === "source" && expectedSource === snapshot.sha256,
          source_sha256: source.representation === "source" && expectedSource === snapshot.sha256 ? snapshot.sha256 : null,
          source_bytes_qualified: source.representation === "source" && expectedSource === snapshot.sha256,
          derivation_qualified: false,
        } });
      } catch (error) {
        const refusal = error instanceof InputRefusal ? error : new InputRefusal("input_fetch_failed");
        unavailable.push({ key: source.key, image_id: source.image_id, required: source.required === true,
          code: refusal.code, ...(refusal.observed_input_sha256 ? { observed_input_sha256: refusal.observed_input_sha256 } : {}) });
      }
    }
  } finally { clearTimeout(timer); }
  const order = new Map(sources.map((source, index) => [source.key, index]));
  inputs.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  return { inputs, unavailable, required_available: !unavailable.some(input => input.required), bytes_read: bytesRead };
}

export type CustodiedVisionPart = { text: string } | { image_key: string };
export interface PinnedModelResult { provider: string; model: string }

/** Parts name captured keys, so no raw URL can sneak into the provider helper.
 * The helper may locally decode data: URIs, but cannot refetch the source URL.
 * A result proves the exact bytes supplied to that helper, not provider internals.
 */
export async function runPinnedVision<Result extends PinnedModelResult>(
  sources: VisionInputSource[],
  buildParts: (capture: VisionInputCapture) => CustodiedVisionPart[],
  model: (options: { parts: Array<{ text: string } | { imageUrl: string }>; maxTokens: number }) => Promise<Result | null>,
  options: InputCustodyOptions = {},
) {
  const capture = await captureVisionInputs(sources, options);
  return runCapturedVision(sources, capture, buildParts, model, options);
}

/** Explicit prepared captures (including trusted normalization) enter the same
 * model boundary without refetching any original or derivative URL.
 */
export async function runCapturedVision<Result extends PinnedModelResult>(
  sources: VisionInputSource[], capture: VisionInputCapture,
  buildParts: (capture: VisionInputCapture) => CustodiedVisionPart[],
  model: (options: { parts: Array<{ text: string } | { imageUrl: string }>; maxTokens: number }) => Promise<Result | null>,
  options: InputCustodyOptions = {},
) {
  const limits = limitsFor(options);
  const result = (model_result: Result | null, refusal: string | null, submitted_keys: string[] = [],
    provider_diagnostics: ProviderDiagnostic[] = [], provider_attempt_coverage?: ProviderAttemptCoverage) =>
    ({ capture, model_result, refusal, submitted_keys, ...(provider_diagnostics.length ? { provider_diagnostics } : {}),
      ...(provider_attempt_coverage ? { provider_attempt_coverage } : {}) });
  if (!capture.required_available || !capture.inputs.length) return result(null, "required_input_unavailable");
  const inputs = new Map(capture.inputs.map(input => [input.key, input]));
  const parts: Array<{ text: string } | { imageUrl: string }> = [];
  const submitted: string[] = [];
  let submittedBytes = 0;
  for (const part of buildParts(capture)) {
    if ("text" in part) parts.push({ text: part.text });
    else {
      const input = inputs.get(part.image_key);
      if (!input) return result(null, "uncaptured_input_requested");
      if (submitted.includes(input.key)) return result(null, "input_repeated_in_submission");
      submittedBytes += input.receipt.byte_length;
      if (submitted.length >= limits.inputs || submittedBytes > limits.total_bytes) return result(null, "submission_bytes_exceeded");
      parts.push({ imageUrl: input.data_uri }); submitted.push(input.key);
    }
  }
  if (!submitted.length || sources.some(source => source.required && !submitted.includes(source.key))) {
    return result(null, "required_input_omitted");
  }
  try {
    const response = await model({ parts, maxTokens: limits.output_tokens });
    return result(response, response ? null : "provider_unavailable", submitted);
  } catch (error) {
    return error instanceof VisionProviderUnavailable
      ? result(null, "provider_unavailable", submitted, safeProviderDiagnostics(error.diagnostics), error.coverage)
      : result(null, "provider_call_failed", submitted);
  }
}

export const TRUSTED_RENDER_PARAMETERS = Object.freeze({ width: 1600, height: 1600, resize: "contain", quality: 85 });
export interface TrustedRenderDerivation {
  contract: "supabase_content_addressed_render_v1";
  trusted_origin: string;
  source_object_path: string;
  render_path: string;
  parameters: typeof TRUSTED_RENDER_PARAMETERS;
  request_accept: "image/jpeg";
  source_sha256: string;
  input_sha256: string;
  source_mime_type: string;
  source_byte_length: number;
  source_captured_at: string;
}

function trustedRenderRecipe(source: VisionInputSource, projectURL: string) {
  const trusted = new URL(projectURL);
  if (trusted.protocol !== "https:" || trusted.username || trusted.password || trusted.port || trusted.pathname !== "/" ||
    trusted.search || trusted.hash) throw new InputRefusal("normalization_origin_invalid");
  const expected = shaKey(source.expected_source_sha256);
  if (!expected || source.representation !== "source") throw new InputRefusal("normalization_source_unqualified");
  const path = source.storage_path;
  const match = typeof path === "string" && path.match(/^users\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/capture-relay\/([a-f0-9]{64})\/([A-Za-z0-9._-]+)$/);
  if (!match || match[1] !== expected || match[2] === "." || match[2] === "..") throw new InputRefusal("normalization_object_path_invalid");
  const sourceObjectPath = `vehicle-photos/${path}`;
  const expectedURL = `${trusted.origin}/storage/v1/object/public/${sourceObjectPath}`;
  if (source.source_url !== expectedURL || (source.input_url !== undefined && source.input_url !== expectedURL)) {
    throw new InputRefusal("normalization_source_url_invalid");
  }
  const renderPath = `/storage/v1/render/image/public/${sourceObjectPath}`;
  return { trusted_origin: trusted.origin, source_object_path: sourceObjectPath, render_path: renderPath,
    input_url: `${trusted.origin}${renderPath}?width=1600&height=1600&resize=contain&quality=85` };
}

/** Explicit trusted-service normalization, never a fallback. Both original and
 * derivative reads share the same byte/time budget. Qualification means: original
 * bytes matched the live SHA and the trusted renderer read that content-addressed
 * object path. It is not a claim of cryptographic local pixel equivalence.
 * Supabase documents HEIC input, format negotiation, contain and quality here:
 * https://supabase.com/docs/guides/storage/serving/image-transformations
 */
export async function captureTrustedJPEGInputs(
  sources: VisionInputSource[], projectURL: string, options: InputCustodyOptions = {},
): Promise<VisionInputCapture> {
  const limits = limitsFor(options), started = performance.now();
  if (!sources.length || sources.length > limits.inputs || new Set(sources.map(source => source.key)).size !== sources.length) {
    throw new InputRefusal("input_scope_invalid");
  }
  const unavailable: UnavailableVisionInput[] = [];
  const recipes = new Map<string, ReturnType<typeof trustedRenderRecipe>>();
  const refuse = (source: VisionInputSource, code: string) => unavailable.push({ key: source.key,
    image_id: source.image_id, required: source.required === true, code });
  for (const source of sources) {
    try { recipes.set(source.key, trustedRenderRecipe(source, projectURL)); }
    catch (error) { refuse(source, error instanceof InputRefusal ? error.code : "normalization_origin_invalid"); }
  }
  const usable = sources.filter(source => recipes.has(source.key));
  const empty = (bytes_read = 0): VisionInputCapture => ({ inputs: [], unavailable,
    required_available: !unavailable.some(input => input.required), bytes_read });
  if (!usable.length) return empty();
  const originals = await captureVisionInputs(usable, options);
  unavailable.push(...originals.unavailable);
  const remainingBytes = limits.total_bytes - originals.bytes_read;
  const remainingMs = limits.total_ms - Math.ceil(performance.now() - started);
  const originalByKey = new Map(originals.inputs.map(input => [input.key, input]));
  const derivativeSources = usable.filter(source => originalByKey.has(source.key)).map(source => ({
    ...source, representation: "derivative" as const, input_url: recipes.get(source.key)!.input_url,
    expected_input_sha256: null, input_accept: "image/jpeg" as const,
  }));
  if (!derivativeSources.length) return empty(originals.bytes_read);
  if (remainingBytes <= 0 || remainingMs <= 0) {
    for (const source of derivativeSources) refuse(source, remainingBytes <= 0 ? "input_total_bytes_exhausted" : "capture_deadline_exceeded");
    return empty(originals.bytes_read);
  }
  const derivatives = await captureVisionInputs(derivativeSources,
    { ...options, limits: { ...limits, total_bytes: remainingBytes, total_ms: remainingMs } });
  unavailable.push(...derivatives.unavailable);
  const inputs: PinnedVisionInput[] = [];
  for (const derivative of derivatives.inputs) {
    const original = originalByKey.get(derivative.key)!;
    if (derivative.receipt.mime_type !== "image/jpeg") {
      refuse(derivativeSources.find(source => source.key === derivative.key)!, "normalization_output_not_jpeg"); continue;
    }
    const recipe = recipes.get(derivative.key)!;
    const derivation: TrustedRenderDerivation = { contract: "supabase_content_addressed_render_v1",
      trusted_origin: recipe.trusted_origin, source_object_path: recipe.source_object_path, render_path: recipe.render_path,
      parameters: TRUSTED_RENDER_PARAMETERS, request_accept: "image/jpeg",
      source_sha256: original.receipt.input_sha256, input_sha256: derivative.receipt.input_sha256,
      source_mime_type: original.receipt.mime_type, source_byte_length: original.receipt.byte_length,
      source_captured_at: original.receipt.captured_at };
    inputs.push({ ...derivative, receipt: { ...derivative.receipt, source_qualified: true,
      source_sha256: original.receipt.input_sha256, derivation_qualified: true, derivation } });
  }
  return { inputs, unavailable, required_available: !unavailable.some(input => input.required),
    bytes_read: originals.bytes_read + derivatives.bytes_read };
}
