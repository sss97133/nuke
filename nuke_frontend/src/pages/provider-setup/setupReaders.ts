// Provider onboarding (/work/setup) over live readers and Signs, read from their bodies with
// pg_get_functiondef on 2026-10-19: my_suggested_provider_links, confirm_provider_record,
// set_provider_service_area, set_provider_availability, provider_profile_read; and the row writers the
// suggestions reader names (account_link_claims self_claim insert, organization_contributors pending
// insert) plus the account's own profiles and user_tools rows under their owner policies.
import { supabase } from '../../lib/supabase';
import { arr, day as dayOf, num, obj, sentence, str, strings, type JsonObject } from '../jobs/jobRead';
import { refusalText } from '../jobs/jobsReaders';

export type Result<T> = { data: T; refusal: null } | { data: null; refusal: string };

const ok = <T,>(data: T): Result<T> => ({ data, refusal: null });
const no = (error: { message?: string; code?: string } | null): Result<never> => ({ data: null, refusal: refusalText(error) });

export type ActorSuggestion = {
  actor: JsonObject | null;
  strength: string;
  evidence: { total: number; direct: number; corroborating: number; by_kind: Record<string, number> };
  your_claim: { claim_id: string; status: string; rung: string | null; filed_at: string | null } | null;
  linked_to_another_account: boolean;
  claimRow: Record<string, unknown> | null;
};

export type OrgSuggestion = {
  organization: { organization_id: string; name: string | null } | null;
  evidence: { photos_at_site: number; days: number; first_at: string | null; last_at: string | null; radius_m: number };
  joinRow: Record<string, unknown> | null;
};

export type RecordedContribution = {
  source_kind: 'contractor_work_contribution' | 'technician';
  source_id: string;
  snapshot_hash: string;
  title: string;
  detail: string;
  confirmation: string;
};

export type Suggestions = {
  as_of: string | null;
  actors: ActorSuggestion[];
  organizations: OrgSuggestion[];
  records: RecordedContribution[];
  never: string[];
};

/** The suggestions reader's own shape, narrowed to what the page says. Rates and names on records are not carried. */
export function suggestionsFrom(raw: JsonObject): Suggestions {
  const actors = arr(raw.actor_links).map(obj).filter((o): o is JsonObject => !!o).map(o => {
    const ev = obj(o.evidence);
    const byKind = obj(ev?.by_kind) ?? {};
    const claim = obj(o.your_claim);
    const action = arr(o.actions).map(obj).find(a => str(a?.action) === 'claim');
    return {
      actor: obj(o.actor),
      strength: str(o.strength) ?? 'corroborating',
      evidence: {
        total: num(ev?.total) ?? 0, direct: num(ev?.direct) ?? 0, corroborating: num(ev?.corroborating) ?? 0,
        by_kind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, typeof v === 'number' ? v : 0])),
      },
      your_claim: claim ? { claim_id: str(claim.claim_id) ?? '', status: str(claim.status) ?? 'pending', rung: str(claim.rung), filed_at: str(claim.filed_at) } : null,
      linked_to_another_account: o.linked_to_another_account === true,
      claimRow: obj(action?.row),
    };
  });
  const organizations = arr(raw.organizations).map(obj).filter((o): o is JsonObject => !!o).map(o => {
    const org = obj(o.organization);
    const ev = obj(o.evidence);
    const action = arr(o.actions).map(obj).find(a => str(a?.action) === 'ask_to_join');
    return {
      organization: org && str(org.organization_id) ? { organization_id: str(org.organization_id)!, name: str(org.name) } : null,
      evidence: { photos_at_site: num(ev?.photos_at_site) ?? 0, days: num(ev?.days) ?? 0, first_at: str(ev?.first_at), last_at: str(ev?.last_at), radius_m: num(ev?.radius_m) ?? 150 },
      joinRow: obj(action?.row),
    };
  });
  const rc = obj(raw.recorded_contributions);
  const records: RecordedContribution[] = [];
  for (const c of arr(rc?.contractor_work).map(obj)) {
    if (!c || !str(c.source_id) || !str(c.snapshot_hash)) continue;
    const hours = num(c.labor_hours);
    records.push({
      source_kind: 'contractor_work_contribution', source_id: str(c.source_id)!, snapshot_hash: str(c.snapshot_hash)!,
      title: str(c.work_description) ?? (str(c.work_category) ? sentence(str(c.work_category)!) : 'Recorded work'),
      detail: [str(obj(c.organization)?.name), dayOf(str(c.work_date)), hours !== null ? `${hours} h recorded` : null,
        c.verified_by_shop === true ? 'verified by the shop' : null].filter(Boolean).join(' · '),
      confirmation: str(obj(c.confirmation)?.state) ?? 'unconfirmed',
    });
  }
  for (const t of arr(rc?.technician_records).map(obj)) {
    if (!t || !str(t.source_id) || !str(t.snapshot_hash)) continue;
    const years = num(t.experience_years);
    const specs = strings(t.specializations);
    records.push({
      source_kind: 'technician', source_id: str(t.source_id)!, snapshot_hash: str(t.snapshot_hash)!,
      title: 'Technician record' + (str(t.certification_level) ? ` · ${sentence(str(t.certification_level)!)}` : ''),
      detail: [str(obj(t.organization)?.name), specs.length ? specs.map(sentence).join(', ') : null, years !== null ? `${years} years` : null]
        .filter(Boolean).join(' · '),
      confirmation: str(obj(t.confirmation)?.state) ?? 'unconfirmed',
    });
  }
  return { as_of: str(raw.as_of), actors, organizations, records, never: strings(obj(raw.coverage)?.never) };
}

export function actorName(a: JsonObject | null): string {
  const handle = str(a?.handle);
  if (handle) return '@' + handle;
  const role = str(a?.role);
  return role ? `Unnamed ${sentence(role).toLowerCase()} record` : 'Unnamed technician record';
}

const KIND_WORD: Record<string, string> = { work_session: 'work days of yours', observation: 'photos or records of yours', org_membership: 'shop memberships' };

/** "2 direct, 35 corroborating — 2 work days of yours, 35 photos or records of yours". */
export function evidenceWords(e: ActorSuggestion['evidence']): string {
  const strength = [e.direct ? `${e.direct} direct` : null, e.corroborating ? `${e.corroborating} corroborating` : null].filter(Boolean).join(', ');
  const kinds = Object.entries(e.by_kind).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${KIND_WORD[k] ?? sentence(k).toLowerCase()}`).join(', ');
  return [strength, kinds].filter(Boolean).join(' — ') || 'no evidence counted';
}

export function claimStatusWords(c: ActorSuggestion['your_claim']): string | null {
  if (!c) return null;
  const when = dayOf(c.filed_at);
  if (c.status === 'approved') return `Linked${c.rung === 'self_claim' ? ' (self-claimed)' : ', backed by your work'}${when ? ` · claimed ${when}` : ''}`;
  if (c.status === 'rejected') return `Your claim was not approved${when ? ` · claimed ${when}` : ''}`;
  return `You claimed this${when ? ` on ${when}` : ''} — waiting for review`;
}

export function confirmationWords(state: string): string {
  if (state === 'confirmed') return 'You confirmed this record';
  if (state === 'changed_since_confirmed') return 'Changed since you confirmed it';
  return 'Not confirmed by you yet';
}

export function orgEvidenceWords(e: OrgSuggestion['evidence']): string {
  const span = [dayOf(e.first_at), dayOf(e.last_at)].filter(Boolean);
  return `${e.photos_at_site.toLocaleString('en-US')} of your photos on ${e.days} day${e.days === 1 ? '' : 's'} within ${e.radius_m} m`
    + (span.length === 2 && span[0] !== span[1] ? ` · ${span[0]} – ${span[1]}` : span.length ? ` · ${span[0]}` : '');
}

// ── Profile read (the provider face) ───────────────────────────────────────

export type Band = { declared: boolean; city: string | null; state: string | null; radius: number | null; mobile: boolean | null; declaredAt: string | null };
export type Window = { dow: number; start: string; end: string };
export type Availability = { declared: boolean; timezone: string | null; weekly: Window[]; exceptions: JsonObject[] };

export function bandOf(profile: JsonObject | null): Band {
  const s = obj(profile?.service_area);
  return { declared: str(s?.state) === 'declared', city: str(s?.city), state: str(s?.state_code), radius: num(s?.radius_miles),
    mobile: typeof s?.mobile === 'boolean' ? s.mobile : null, declaredAt: str(s?.declared_at) };
}

export function availabilityOf(profile: JsonObject | null): Availability {
  const a = obj(profile?.availability);
  const weekly = arr(a?.weekly).map(obj).filter((w): w is JsonObject => !!w && num(w.dow) !== null)
    .map(w => ({ dow: num(w.dow)!, start: str(w.start) ?? '', end: str(w.end) ?? '' }));
  return { declared: str(a?.state) === 'declared', timezone: str(a?.timezone), weekly, exceptions: arr(a?.exceptions_upcoming).map(obj).filter((x): x is JsonObject => !!x) };
}

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function bandWords(b: Band): string | null {
  if (!b.declared || !b.city || !b.state) return null;
  return `${b.city}, ${b.state} within ${b.radius ?? '?'} miles${b.mobile ? ', travels to the vehicle' : ''}`;
}

export function weeklyWords(a: Availability): string | null {
  if (!a.declared) return null;
  if (a.weekly.length === 0) return `No weekly windows${a.timezone ? ` (${a.timezone})` : ''}`;
  return a.weekly.map(w => `${DAYS[w.dow]} ${w.start}–${w.end}`).join(', ') + (a.timezone ? ` (${a.timezone})` : '');
}

export function identityState(profile: JsonObject | null): string {
  return str(obj(profile?.identity_bridge)?.state) ?? 'none';
}

export type OwnProfile = { username: string | null; is_public: boolean | null; profession: string | null; expertise_areas: string[] };

export type ChecklistItem = { key: string; label: string; state: 'done' | 'partial' | 'missing' | 'optional'; words: string; step: number };

const TRADE_DEFAULT = 'enthusiast';

export function hasTrade(own: OwnProfile | null): boolean {
  return !!own && (own.expertise_areas.length > 0 || (!!own.profession && own.profession !== TRADE_DEFAULT));
}

export function claimedToolCount(profile: JsonObject | null): number {
  const owned = obj(obj(profile?.tools)?.claimed_owned);
  return [...arr(owned?.user_tools), ...arr(owned?.tool_inventory)].map(obj).reduce((n, c) => n + (num(c?.records) ?? 0), 0);
}

export function vouchCount(profile: JsonObject | null): number {
  return arr(obj(profile?.vouched_for_by)?.items).length;
}

function accountTrade(profile: JsonObject | null): OwnProfile {
  const account = obj(obj(profile?.claims)?.account);
  return { username: null, is_public: null, profession: str(account?.profession), expertise_areas: strings(account?.expertise_areas) };
}

/** What is done and what is missing, in the words a client would need explained. Steps are 1-based. */
export function checklist(profile: JsonObject | null, own: OwnProfile | null): ChecklistItem[] {
  const bridge = identityState(profile);
  const band = bandOf(profile);
  const avail = availabilityOf(profile);
  const tools = claimedToolCount(profile);
  const vouches = vouchCount(profile);
  const handle = own?.username?.trim() || null;
  const items: ChecklistItem[] = [
    bridge === 'evidenced'
      ? { key: 'link', label: 'Technician link', state: 'done', words: 'Linked to your technician record and backed by your work.', step: 1 }
      : bridge === 'claimed'
        ? { key: 'link', label: 'Technician link', state: 'partial', words: 'Your link is self-claimed — Nuke confirms it when your work backs it up.', step: 1 }
        : { key: 'link', label: 'Technician link', state: 'missing', words: 'Not linked. If a technician record in step 1 is yours, claim it.', step: 1 },
    handle && own?.is_public
      ? { key: 'public', label: 'Public page', state: 'done', words: `Clients can open your page at /providers/${handle}.`, step: 5 }
      : { key: 'public', label: 'Public page', state: 'missing', words: 'Set a username and make your profile public in your profile settings so clients can open your page.', step: 5 },
    hasTrade(own)
      ? { key: 'trade', label: 'Trade', state: 'done', words: 'Your trade is on your page, labelled self-described.', step: 2 }
      : { key: 'trade', label: 'Trade', state: 'missing', words: 'Say what you do. It is shown as self-described.', step: 2 },
    band.declared
      ? { key: 'area', label: 'Service area', state: 'done', words: `${bandWords(band)}.`, step: 3 }
      : { key: 'area', label: 'Service area', state: 'missing', words: 'No service area yet, so matching cannot tell whether a job is near you.', step: 3 },
    avail.declared
      ? { key: 'availability', label: 'Availability', state: 'done', words: `${weeklyWords(avail)}.`, step: 3 }
      : { key: 'availability', label: 'Availability', state: 'missing', words: "No availability yet; jobs show it as unknown.", step: 3 },
    tools > 0
      ? { key: 'tools', label: 'Tools', state: 'done', words: `${tools} tool record${tools === 1 ? '' : 's'} you say you own. Not checked in person.`, step: 4 }
      : { key: 'tools', label: 'Tools', state: 'missing', words: 'No tools claimed; requests that need a tool will say a backup supplier is needed.', step: 4 },
    vouches > 0
      ? { key: 'vouches', label: 'Vouches', state: 'done', words: `${vouches} vouch${vouches === 1 ? '' : 'es'} from people or shops you worked with.`, step: 4 }
      : { key: 'vouches', label: 'Vouches', state: 'optional', words: 'Ask a shop or tool owner you have worked with to vouch for you or co-sign an offer.', step: 4 },
  ];
  return items;
}

/** The provider page's self face links here while any required item is missing or only self-claimed. */
export function setupIncomplete(profile: JsonObject | null): boolean {
  if (!profile) return false;
  const bridge = identityState(profile);
  return bridge !== 'evidenced' || !bandOf(profile).declared || !availabilityOf(profile).declared || claimedToolCount(profile) === 0
    || !hasTrade(accountTrade(profile));
}

// ── Builders (pure; the page sends exactly these) ──────────────────────────

const CONTACT = /(@|\d{3}[-. )]*\d{3}[-. ]*\d{4})/;

export const PROFESSIONS: Array<{ key: string; title: string }> = [
  { key: 'mechanic', title: 'Mechanic or technician' },
  { key: 'dealer', title: 'Dealer' },
  { key: 'collector', title: 'Collector' },
  { key: 'enthusiast', title: 'Enthusiast' },
  { key: 'other', title: 'Other' },
];

export function tradeUpdate(profession: string, expertiseText: string): { row: { profession: string; expertise_areas: string[] } } | { error: string } {
  if (!PROFESSIONS.some(p => p.key === profession)) return { error: 'Pick what best describes you.' };
  const items = Array.from(new Set(expertiseText.split(/[,\n]/).map(s => s.trim()).filter(Boolean)));
  if (items.length > 12) return { error: 'Up to 12 areas of expertise.' };
  if (items.some(s => s.length < 2 || s.length > 40)) return { error: 'Each area is 2 to 40 characters.' };
  if (items.some(s => CONTACT.test(s))) return { error: 'Take out phone numbers and emails.' };
  return { row: { profession, expertise_areas: items } };
}

export function serviceAreaArgs(city: string, state: string, radius: string, mobile: boolean):
  { args: { p_city: string; p_state: string; p_radius_miles: number; p_mobile: boolean } } | { error: string } {
  const c = city.trim().replace(/\s+/g, ' ');
  const s = state.trim().toUpperCase();
  const r = Number(radius);
  if (c.length < 2 || c.length > 60 || /[0-9@,;]/.test(c)) return { error: 'A city name only (no street address, numbers or contact details).' };
  if (!/^[A-Z]{2}$/.test(s)) return { error: 'A two-letter state code, like NV.' };
  if (!Number.isInteger(r) || r < 1 || r > 500) return { error: 'Radius is 1 to 500 miles.' };
  return { args: { p_city: c, p_state: s, p_radius_miles: r, p_mobile: mobile } };
}

export type DayDraft = { on: boolean; start: string; end: string };

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function availabilityArgs(timezone: string, days: DayDraft[], keepExceptions: JsonObject[]):
  { args: { p_windows: { timezone: string; weekly: Window[]; exceptions: JsonObject[] } } } | { error: string } {
  if (!timezone.trim()) return { error: 'Pick your timezone.' };
  const weekly: Window[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (!d.on) continue;
    if (!HHMM.test(d.start) || !(HHMM.test(d.end) || d.end === '24:00') || d.start >= d.end) return { error: `${DAYS[i]}: start before end, as HH:MM.` };
    weekly.push({ dow: i, start: d.start, end: d.end });
  }
  const exceptions = keepExceptions.map(x => {
    const out: JsonObject = { date: str(x.date), available: x.available === true };
    if (str(x.start) && str(x.end)) { out.start = str(x.start); out.end = str(x.end); }
    return out;
  }).filter(x => typeof x.date === 'string');
  return { args: { p_windows: { timezone: timezone.trim(), weekly, exceptions } } };
}

export type ToolKey = { source_kind: string; source_key: string; requirement_key: string };

export function toolInsert(userId: string, description: string, category: string | null):
  { row: { user_id: string; description: string; category: string | null; metadata: Record<string, string> } } | { error: string } {
  const d = description.trim().replace(/\s+/g, ' ');
  if (d.length < 2 || d.length > 120) return { error: 'Name the tool in 2 to 120 characters.' };
  if (CONTACT.test(d)) return { error: 'Take out phone numbers and emails.' };
  return { row: { user_id: userId, description: d, category: category?.trim() || null, metadata: { source: 'provider_setup', claim_basis: 'self_claim' } } };
}

/** Requirement keys a tool name meets through the reviewed map (exact terms and categories only). */
export function keysFor(map: ToolKey[], description: string, category: string | null): string[] {
  const text = description.toLowerCase();
  const keys = new Set<string>();
  for (const m of map) {
    if (m.source_kind === 'tool_term' && new RegExp(`\\b${m.source_key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) keys.add(m.requirement_key);
    if (m.source_kind === 'tool_category' && category && m.source_key === category.toLowerCase().trim()) keys.add(m.requirement_key);
  }
  return [...keys].sort();
}

export function keyWords(key: string): string {
  return key.split('.').map(p => p.replace(/_/g, ' ')).join(' · ');
}

// ── Reads and writes ───────────────────────────────────────────────────────

export const SetupReaders = {
  async suggestions(): Promise<Result<Suggestions>> {
    const { data, error } = await supabase.rpc('my_suggested_provider_links');
    return error ? no(error) : ok(suggestionsFrom((data ?? {}) as JsonObject));
  },
  async profile(userId: string): Promise<Result<JsonObject>> {
    const { data, error } = await supabase.rpc('provider_profile_read', { p_user_id: userId, p_actor_id: null });
    return error ? no(error) : ok((data ?? {}) as JsonObject);
  },
  async own(userId: string): Promise<Result<OwnProfile>> {
    const { data, error } = await supabase.from('profiles').select('username, is_public, profession, expertise_areas').eq('id', userId).maybeSingle();
    if (error) return no(error);
    const d = (data ?? {}) as JsonObject;
    return ok({ username: str(d.username), is_public: typeof d.is_public === 'boolean' ? d.is_public : null, profession: str(d.profession), expertise_areas: strings(d.expertise_areas) });
  },
  async toolKeys(): Promise<Result<ToolKey[]>> {
    const { data, error } = await supabase.from('tool_requirement_key_map').select('source_kind, source_key, requirement_key');
    return error ? no(error) : ok(((data ?? []) as ToolKey[]).filter(k => k.source_kind === 'tool_term' || k.source_kind === 'tool_category'));
  },
};

export const SetupSigns = {
  async claimActor(row: Record<string, unknown>): Promise<Result<{ id: string }>> {
    const { data, error } = await supabase.from('account_link_claims').insert(row).select('id').single();
    return error ? no(error) : ok(data as { id: string });
  },
  async askToJoin(row: Record<string, unknown>): Promise<Result<true>> {
    const { error } = await supabase.from('organization_contributors').insert(row);
    return error ? no(error) : ok(true);
  },
  async confirmRecord(r: RecordedContribution): Promise<Result<JsonObject>> {
    const { data, error } = await supabase.rpc('confirm_provider_record', { p_source_kind: r.source_kind, p_source_id: r.source_id, p_snapshot_hash: r.snapshot_hash });
    return error ? no(error) : ok(data as JsonObject);
  },
  async saveTrade(userId: string, row: { profession: string; expertise_areas: string[] }): Promise<Result<true>> {
    const { error } = await supabase.from('profiles').update(row).eq('id', userId);
    return error ? no(error) : ok(true);
  },
  async serviceArea(args: { p_city: string; p_state: string; p_radius_miles: number; p_mobile: boolean }): Promise<Result<JsonObject>> {
    const { data, error } = await supabase.rpc('set_provider_service_area', args);
    return error ? no(error) : ok(data as JsonObject);
  },
  async availability(args: { p_windows: unknown }): Promise<Result<JsonObject>> {
    const { data, error } = await supabase.rpc('set_provider_availability', args);
    return error ? no(error) : ok(data as JsonObject);
  },
  async addTool(row: Record<string, unknown>): Promise<Result<true>> {
    const { error } = await supabase.from('user_tools').insert(row);
    return error ? no(error) : ok(true);
  },
};
