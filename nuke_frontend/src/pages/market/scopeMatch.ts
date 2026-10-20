/** A lot's identity as the live board sees it: enough to decide whether it sits in a drilled family. */
export interface ScopedLot { make?: string | null; model?: string | null; title?: string | null }

/** Whether a live lot belongs to the drilled family (the board's rule, moved out of MarketPulse so the critique script
 *  applies the same test to the Feed's lots). A family whose members are its name plus a number also matches:
 *  LC -> LC500, F-Series -> F-150, 3 Series -> 328i, C/K -> C10, K20. */
export function matchesFamilyScope(a: ScopedLot, familyName: string | null): boolean {
  if (!familyName) return true;
  const f = familyName.trim().toLowerCase();
  if (!f || f === 'other models') return true;
  const m = (a.model ?? '').trim().toLowerCase();
  const t = (a.title ?? '').trim().toLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp(`(^|[^a-z0-9])${esc(f)}($|[^a-z0-9])`, 'i');
  if (m === f || m.startsWith(`${f} `) || m.startsWith(`${f}-`) || wordRe.test(m) || wordRe.test(t)) return true;
  // A family whose members are its name plus a number: LC -> LC500, F-Series -> F-150, 3 Series -> 328i, C/K -> C10, K20.
  const stems = /^(.+?)[- ]series$/.test(f) ? [f.replace(/[- ]series$/, '')]
    : f.includes('/') ? f.split('/').map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 3)
      : /[a-z]$/.test(f) ? [f] : [];
  const make = (a.make ?? '').trim().toLowerCase();
  return stems.some((s) => new RegExp(`^${esc(s)}-?\\d`, 'i').test(m)
    || (!!make && new RegExp(`(^|\\s)${esc(make)}\\s+${esc(s)}-?\\d`, 'i').test(t)));
}
