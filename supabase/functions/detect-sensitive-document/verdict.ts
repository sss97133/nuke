// Pure helpers for detect-sensitive-document: no network, no Deno APIs, so they can be tested directly.

export interface Verdict {
  is_sensitive: boolean;
  document_type: 'title' | 'registration' | 'bill_of_sale' | 'insurance' | 'inspection' | 'spid' | 'other' | null;
  confidence: number;
  extracted_data: any;
  raw_text: string;
}

/**
 * Text from a provider -> verdict. Throws when nothing was read: an empty reply, a reply that is not JSON, or
 * JSON without a boolean is_sensitive. "Not sensitive" is a reading, and these are not one, so the caller
 * must fail over to the next provider (or fail) instead of reporting the image clean.
 * JSON inside a markdown fence or wrapped in prose still parses.
 */
export function parseVerdict(text: string | null | undefined, label = 'provider', detail = ''): Verdict {
  const suffix = detail ? ` (${detail})` : '';
  const content = typeof text === 'string' ? text : '';
  if (!content.trim()) {
    throw new Error(`${label} returned no text${suffix}`);
  }
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  let result: any;
  try {
    result = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch {
    throw new Error(`${label} answer was not JSON${suffix}`);
  }
  if (typeof result?.is_sensitive !== 'boolean') {
    throw new Error(`${label} answer has no is_sensitive verdict`);
  }
  return {
    is_sensitive: result.is_sensitive,
    document_type: result.document_type || null,
    confidence: result.confidence || 0,
    extracted_data: result.extracted_data || {},
    raw_text: result.raw_text || '',
  };
}

/**
 * The address a model should fetch. A photo in public storage is asked for as a 1,600 px JPEG render
 * (a model cannot read a HEIC original). An address that already has a query string, or is not public
 * storage, is returned unchanged.
 */
export function toModelImageUrl(imageUrl: string): string {
  return imageUrl.includes('/storage/v1/object/public/') && !imageUrl.includes('?')
    ? imageUrl.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
      '?width=1600&height=1600&resize=contain&quality=80'
    : imageUrl;
}
