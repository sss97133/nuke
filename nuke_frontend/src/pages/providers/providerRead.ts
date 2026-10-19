// The provider face of a profile, as provider_profile_read, provider_job_record_read and
// provider_productivity_read send it. What a person says about themself (account fields, their technician
// record) stays apart from what the record shows (capabilities derived from evidence, tool sightings in
// their photos, vouches, signed work days, jobs). None of these readers returns money or contact fields.
import { arr, num, obj, sentence, str, strings, type JsonObject } from '../jobs/jobRead';

export type ClaimRow = { label: string; value: string; basis: string };

/** role and user_type are account settings, not trades: a visitor never sees them; the person sees them labelled. */
export function claimRows(claims: JsonObject | null, isSelf: boolean): ClaimRow[] {
  const rows: ClaimRow[] = [];
  const account = obj(claims?.account);
  if (account) {
    const profession = str(account.profession);
    if (profession) rows.push({ label: 'Trade', value: sentence(profession), basis: 'self-described' });
    const expertise = strings(account.expertise_areas);
    if (expertise.length) rows.push({ label: 'Expertise', value: expertise.map(sentence).join(', '), basis: 'self-described' });
    if (isSelf) {
      if (str(account.role)) rows.push({ label: 'Account role', value: sentence(str(account.role)!), basis: 'account setting, not shown to visitors' });
      if (str(account.user_type)) rows.push({ label: 'Account type', value: sentence(str(account.user_type)!), basis: 'account setting, not shown to visitors' });
    }
  }
  const basis = isSelf ? 'stated on your technician profile' : 'stated on their technician profile';
  for (const r of arr(claims?.actor_records).map(obj)) {
    if (!r) continue;
    const add = (label: string, key: string) => {
      const list = strings(r[key]);
      if (list.length) rows.push({ label, value: list.map(sentence).join(', '), basis });
    };
    add('Specialties', 'specialties');
    add('Makes', 'specialty_makes');
    add('Eras', 'specialty_eras');
    add('Certifications', 'certifications');
    add('Licenses', 'licenses');
    add('Training', 'training');
    const years = num(r.years_experience);
    if (years !== null) rows.push({ label: 'Experience', value: `${years} years`, basis });
  }
  const seen = new Set<string>();
  return rows.filter(r => !seen.has(r.label) && seen.add(r.label));
}

export type Capability = { type: string; tier: string | null; strength: string; derived: boolean; evidence: number | null;
  counts: { direct: number; corroborating: number; against: number } | null; last: string | null };

export function capabilities(profile: JsonObject | null): Capability[] {
  return arr(obj(profile?.capabilities)?.items).map(obj).filter((o): o is JsonObject => !!o && !!str(o.capability_type)).map(o => {
    const c = obj(o.basis_counts);
    return {
      type: str(o.capability_type)!,
      tier: str(o.complexity_tier) ?? (num(o.complexity_tier) !== null ? String(num(o.complexity_tier)) : null),
      strength: str(o.strength) ?? 'not_assessed',
      derived: str(o.derivation) !== 'legacy_hand_entered',
      evidence: num(o.evidence_count),
      counts: c ? { direct: num(c.direct) ?? 0, corroborating: num(c.corroborating) ?? 0, against: num(c.against) ?? 0 } : null,
      last: str(o.last_demonstrated),
    };
  });
}

const STRENGTH: Record<string, string> = {
  direct: 'Direct evidence',
  corroborating: 'Corroborating records',
  not_assessed: 'Strength not assessed',
};
export const strengthWord = (s: string): string => STRENGTH[s] ?? sentence(s);

export function capabilityLabel(c: Capability): string {
  const base = sentence(c.type);
  return c.tier ? `${base} · ${sentence(c.tier).toLowerCase()}` : base;
}

/** "3 corroborating · 1 against", or the evidence count when the row carries no breakdown. */
export function evidenceLine(c: Capability): string {
  if (c.counts) {
    const parts = [c.counts.direct ? `${c.counts.direct} direct` : null, c.counts.corroborating ? `${c.counts.corroborating} corroborating` : null,
      c.counts.against ? `${c.counts.against} against` : null].filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  if (c.evidence === null) return 'Evidence not counted';
  return c.evidence === 1 ? '1 piece of evidence' : `${c.evidence.toLocaleString('en-US')} pieces of evidence`;
}

/** Shops stay off the visitor face (owner, 2026-06-13: organizations off the profile face). The person's own face keeps them. */
export const showsShops = (viewerContext: string | null | undefined): boolean => viewerContext === 'self';

/** "from 220 of 833 analysed photos · latest 1,000 of 1,538 photos". */
export function seenCoverage(seen: JsonObject | null): string | null {
  if (!seen) return null;
  const parts: string[] = [];
  const withTools = num(seen.frames_with_tools), analysed = num(seen.frames_analyzed);
  if (withTools !== null && analysed !== null) parts.push(`from ${withTools.toLocaleString('en-US')} of ${analysed.toLocaleString('en-US')} analysed photos`);
  const scanned = num(seen.images_scanned), eligible = num(seen.images_eligible);
  if (scanned !== null && eligible !== null && eligible > scanned) parts.push(`latest ${scanned.toLocaleString('en-US')} of ${eligible.toLocaleString('en-US')} photos`);
  return parts.length ? parts.join(' · ') : null;
}

/** Claimed tool categories, records summed across both record kinds, most first. */
export function toolCategories(owned: JsonObject | null): Array<{ category: string; records: number }> {
  const sums = new Map<string, number>();
  for (const c of [...arr(owned?.user_tools), ...arr(owned?.tool_inventory)].map(obj)) {
    const name = str(c?.category);
    if (name) sums.set(name, (sums.get(name) ?? 0) + (num(c?.records) ?? 0));
  }
  return [...sums.entries()].map(([category, records]) => ({ category, records }))
    .sort((a, b) => b.records - a.records || a.category.localeCompare(b.category));
}

export function technicianLinkOf(state: string | null, isSelf: boolean): string {
  if (state === 'evidenced') return isSelf ? 'Linked to your technician profile, backed by your work' : 'Linked to a technician profile, backed by their work';
  if (state === 'claimed') return isSelf ? 'Linked by you — not yet backed by work' : 'Linked by them — not yet backed by work';
  return isSelf ? "Your account isn't linked to a technician profile yet" : 'Not linked to a technician profile';
}

/** "@handle", or the evidenced handle an actor resolves to, or "Unnamed party". Never a private name. */
export function subjectName(subject: JsonObject | null): string {
  const handle = str(subject?.handle) ?? str(obj(subject?.display)?.handle);
  return handle ? '@' + handle : 'Unnamed party';
}

export function place(subject: JsonObject | null): string | null {
  const p = [str(subject?.city), str(subject?.state)].filter(Boolean);
  return p.length ? p.join(', ') : null;
}
