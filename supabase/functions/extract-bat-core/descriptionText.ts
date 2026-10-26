// Full-length BaT description handling (v38).
// Before 4.5.8 the extractor stored a 480-char summary + "…" (481 chars) in vehicles.description,
// so text features could not tell a cut-off summary from a full post body.

/** Whitespace-normalized full post body; never truncated. */
export function fullDescriptionText(raw: string | null): string | null {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return s || null;
}

/** The exact summary form older extractor versions wrote (cleaned[:480].trim() + "…"). */
export function legacySummaryOf(full: string): string {
  return full.length <= 480 ? full : `${full.slice(0, 480).trim()}…`;
}

/** True when a stored text is the legacy 480-char cut (ends with "…", length ≤ 481). */
export function isLegacyTruncatedSummary(stored: string | null | undefined): boolean {
  const s = typeof stored === "string" ? stored : "";
  return s.length >= 400 && s.length <= 481 && s.endsWith("…");
}

/**
 * Replace a stored description only when it is the legacy cut of this exact page body:
 * never overwrite a longer or different text.
 */
export function shouldReplaceDescription(stored: string | null | undefined, full: string | null): boolean {
  if (!full) return false;
  if (!stored) return true;
  if (!isLegacyTruncatedSummary(stored)) return false;
  return full.length > stored.length && legacySummaryOf(full) === stored;
}
