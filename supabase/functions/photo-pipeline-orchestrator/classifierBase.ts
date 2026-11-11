// Classifier primitives (budget, error class, bounded body reader, stand-in result). Leaf below classifierImage/classifier/classifierProvider.
import { type ClassificationResult, type ClassifierReceipt } from "./classifierTypes.ts";

export function UNCLASSIFIED_FALLBACK(receipt: ClassifierReceipt): ClassificationResult {
  return {
    image_type: "other",
    confidence: 0.2,
    is_automotive: true,
    description: "Unclassified — classifier unavailable; retained for review",
    classifier_ok: false,
    classifier_receipt: receipt,
  };
}

export const CLASSIFIER_BUDGET = Object.freeze({ image_bytes: 4 * 1024 * 1024,
  response_bytes: 65536, input_tokens: 16384, output_tokens: 768,
  image_ms: 10000, request_ms: 20000, attempts: 1 });

export class ClassifierError extends Error { constructor(public code: string, public status?: number) { super(code); } }

export async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    await response.body?.cancel(); throw new ClassifierError("payload_too_large");
  }
  if (!response.body) throw new ClassifierError("payload_empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new ClassifierError("payload_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new ClassifierError("payload_empty");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
