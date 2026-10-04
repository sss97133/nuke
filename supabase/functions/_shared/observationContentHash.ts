/** Preserve the canonical intake's JSON bytes, including omitted undefined keys. */
export interface ObservationHashInput {
  source_slug?: unknown; kind?: unknown; vehicle_id?: unknown; source_url?: unknown;
  source_identifier?: unknown; observed_at?: unknown; content_text?: unknown;
  structured_data?: unknown; observer_raw?: unknown; descriptor_key?: unknown;
  property_key?: unknown; source_comment_id?: unknown;
}

export function observationContentForHash(input: ObservationHashInput): string {
  return JSON.stringify({
    source: input.source_slug,
    kind: input.kind,
    vehicle_id: input.vehicle_id || "",
    source_url: input.source_url || "",
    source_identifier: input.source_identifier || "",
    observed_at: input.observed_at,
    text: input.content_text || "",
    data: input.structured_data || {},
    observer: input.observer_raw || {},
    descriptor: input.descriptor_key,
    property: input.property_key,
    source_comment: input.source_comment_id,
  });
}

export async function observationContentHash(input: ObservationHashInput): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(observationContentForHash(input)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Same microsecond comparison used by cached image projection. Never rewrite clock/hash bytes. */
export function observationClockMicroseconds(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/i.exec(value);
  if (!match) return null;
  const [,year,month,day,hour,minute,second,fraction,,zoneHour,zoneMinute] = match;
  if (+year < 1000 || +month < 1 || +month > 12 || +day < 1 ||
      +day > new Date(Date.UTC(+year,+month,0)).getUTCDate() ||
      +hour > 23 || +minute > 59 || +second > 59 || +(zoneHour || 0) > 15 || +(zoneMinute || 0) > 59) return null;
  const comparable = value.replace(' ','T').replace(/([+-]\d{2})$/,'$1:00').replace(/([+-]\d{2})(\d{2})$/,'$1:$2');
  const milliseconds = Date.parse(comparable);
  if (!Number.isFinite(milliseconds)) return null;
  return BigInt(milliseconds)*1000n + BigInt((fraction || '').padEnd(6,'0').slice(3));
}
