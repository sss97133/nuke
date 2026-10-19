/**
 * ProviderSetupPage — /work/setup, a provider's guided onboarding: join, let what you already logged
 * speak for you, say where and when you work, show your tools, and see what clients will see.
 *
 * Five skippable steps over live readers (my_suggested_provider_links, provider_profile_read) and Signs
 * (account_link_claims self_claim, organization_contributors pending request, confirm_provider_record,
 * profiles trade fields, set_provider_service_area, set_provider_availability, user_tools). Every write
 * runs only from a Sign sheet's confirm button, which states what it binds and what it does not.
 * Nothing here is approved, joined or evidenced automatically.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Row, Rows, Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { useAuthContext } from '../../contexts/AuthContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { SignSheet } from '../jobs/SignSheet';
import { arr, num, obj, str, type JsonObject } from '../jobs/jobRead';
import { capabilities, capabilityLabel, claimRows, evidenceLine, seenCoverage, technicianLinkOf, toolCategories } from '../providers/providerRead';
import {
  DAYS, PROFESSIONS, SetupReaders, SetupSigns, actorName, availabilityArgs, availabilityOf, bandOf, bandWords, checklist, claimStatusWords,
  confirmationWords, evidenceWords, identityState, keyWords, keysFor, orgEvidenceWords, serviceAreaArgs, toolInsert, tradeUpdate, weeklyWords,
  type DayDraft, type OwnProfile, type Result, type Suggestions, type ToolKey,
} from './setupReaders';
import '../jobs/jobs.css';

export type PendingSign = {
  title: string;
  says: string[];
  doesNotSay: string[];
  confirmLabel: string;
  run: () => Promise<Result<unknown>>;
  doneText: string;
};

const STEPS = ['Records that may be yours', 'Your trade', 'Where and when you work', 'Your tools', 'What clients will see'];

type Load<T> = { status: 'loading' } | { status: 'loaded'; data: T } | { status: 'failed'; reason: string };
const loaded = <T,>(r: Result<T>): Load<T> => (r.refusal ? { status: 'failed', reason: r.refusal } : { status: 'loaded', data: r.data as T });

function Failed({ what, reason }: { what: string; reason: string }) {
  return <Text role="body" className="jb-warn">{what} could not be read: {reason}</Text>;
}

// ── Step 1 ─────────────────────────────────────────────────────────────────

function RecordsStep({ s, onSign }: { s: Load<Suggestions>; onSign: (p: PendingSign) => void }) {
  if (s.status === 'loading') return <Text role="caption">Looking for records that name your work…</Text>;
  if (s.status === 'failed') return <Failed what="Suggestions" reason={s.reason} />;
  const { actors, organizations, records, never } = s.data;
  return <>
    <Section title="Technician records your work points to" coverage={{ n: actors.filter(a => a.evidence.direct > 0).length, of: actors.length, grain: 'with direct evidence', as_of: s.data.as_of }}>
      {actors.length === 0 && <Text role="body">No technician records point to your work yet. As you log work with photos, records can link to you.</Text>}
      <ul className="jb-list">{actors.map((a, i) => {
        const status = claimStatusWords(a.your_claim);
        return <li key={str(a.actor?.actor_id) ?? i} className="jb-row" aria-label={actorName(a.actor)}>
          <div className="jb-row__head"><Text role="entity" dense>{actorName(a.actor)}</Text><Text role="label">{a.strength === 'direct' ? 'Direct evidence' : 'Corroborating only'}</Text></div>
          <Text role="body">{evidenceWords(a.evidence)}</Text>
          {a.linked_to_another_account && <Text role="caption" className="jb-warn">Already linked to another account. Claim it only if it is really you; a reviewer will compare.</Text>}
          {status && <Text role="caption">{status}</Text>}
          {a.claimRow && <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={() => onSign({
            title: 'Claim this technician record', confirmLabel: 'Claim it',
            says: ['This technician record is you.', 'Nuke reviews the evidence above; a person other than you decides.'],
            doesNotSay: ['That Nuke has confirmed it', 'Any skill, rating or job', 'Anyone’s contact details'],
            run: () => SetupSigns.claimActor(a.claimRow!), doneText: 'Claim filed. It stays self-claimed until your work backs it up.',
          })}><Text role="label">Claim it</Text></button></div>}
        </li>;
      })}</ul>
    </Section>

    {records.length > 0 && <Section title="Work recorded under your account" coverage={{ n: records.filter(r => r.confirmation === 'confirmed').length, of: records.length, grain: 'confirmed by you', as_of: s.data.as_of }}>
      <ul className="jb-list">{records.map(r => <li key={`${r.source_kind}:${r.source_id}`} className="jb-row">
        <Text role="entity" dense>{r.title}</Text>
        {r.detail && <Text role="caption">{r.detail}</Text>}
        <Text role="caption">{confirmationWords(r.confirmation)}</Text>
        {r.confirmation !== 'confirmed' && <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-secondary" onClick={() => onSign({
          title: 'Confirm this record', confirmLabel: 'Confirm',
          says: ['This record of your work is accurate as shown.'],
          doesNotSay: ['Skill evidence — skills come only from attributed work and accepted completions', 'Any rate or payment'],
          run: () => SetupSigns.confirmRecord(r), doneText: 'Confirmed, as your own statement.',
        })}><Text role="label">Confirm</Text></button></div>}
      </li>)}</ul>
    </Section>}

    <Section title="Shops near your photos" coverage={{ n: organizations.length, of: organizations.length, grain: 'shops within 150 m of your photos', as_of: s.data.as_of }}>
      {organizations.length === 0 && <Text role="body">No public shops found near your recent geotagged photos.</Text>}
      <ul className="jb-list">{organizations.map((o, i) => <li key={o.organization?.organization_id ?? i} className="jb-row">
        <Text role="entity" dense>{o.organization?.name ?? 'Unnamed shop'}</Text>
        <Text role="caption">{orgEvidenceWords(o.evidence)}</Text>
        {o.joinRow && <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-secondary" onClick={() => onSign({
          title: 'Ask to join this shop', confirmLabel: 'Send request',
          says: [`You ask to join ${o.organization?.name ?? 'this shop'} as a contributor.`, "The shop's owner or an admin decides."],
          doesNotSay: ['That you are a member until they accept', "Access to the shop's vehicles or records"],
          run: () => SetupSigns.askToJoin(o.joinRow!), doneText: 'Request sent. It is pending until the shop decides.',
        })}><Text role="label">Ask to join</Text></button></div>}
      </li>)}</ul>
    </Section>
    {never.length > 0 && <Text role="caption">Never used to suggest: {never.join('; ')}.</Text>}
  </>;
}

// ── Step 2 ─────────────────────────────────────────────────────────────────

function TradeStep({ own, userId, onSign }: { own: Load<OwnProfile>; userId: string; onSign: (p: PendingSign) => void }) {
  const [profession, setProfession] = useState('mechanic');
  const [expertise, setExpertise] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (own.status !== 'loaded') return;
    if (own.data.profession) setProfession(own.data.profession);
    setExpertise(own.data.expertise_areas.join(', '));
  }, [own]);
  if (own.status === 'loading') return <Text role="caption">Reading your profile…</Text>;
  if (own.status === 'failed') return <Failed what="Your profile" reason={own.reason} />;
  const save = () => {
    setError(null);
    const built = tradeUpdate(profession, expertise);
    if ('error' in built) { setError(built.error); return; }
    onSign({
      title: 'Save your trade', confirmLabel: 'Save',
      says: ['Your trade and expertise appear on your provider page, labelled self-described.'],
      doesNotSay: ['That Nuke checked it', 'Skill evidence — the record shows skills only from work it can see'],
      run: () => SetupSigns.saveTrade(userId, built.row), doneText: 'Saved as self-described.',
    });
  };
  return <Section title="Your trade" coverage={{ n: own.data.expertise_areas.length, of: own.data.expertise_areas.length, grain: 'self-described areas', as_of: null }}>
    <Text role="body">What you say you do. Clients see it marked self-described, apart from what your work record shows.</Text>
    <label className="jb-field"><Text role="label">What best describes you</Text>
      <select className="jb-input k-body" value={profession} onChange={e => setProfession(e.target.value)}>
        {PROFESSIONS.map(p => <option key={p.key} value={p.key}>{p.title}</option>)}
      </select></label>
    <label className="jb-field"><Text role="label">Expertise, separated by commas</Text>
      <input className="jb-input k-body" value={expertise} placeholder="TIG welding, exhaust fabrication, Square-body Chevrolet" onChange={e => setExpertise(e.target.value)} /></label>
    {error && <Text role="body" className="jb-warn">{error}</Text>}
    <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={save}><Text role="label">Save your trade</Text></button></div>
  </Section>;
}

// ── Step 3 ─────────────────────────────────────────────────────────────────

const defaultZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'; } catch { return 'America/Los_Angeles'; } };

function WhereWhenStep({ profile, onSign }: { profile: Load<JsonObject>; onSign: (p: PendingSign) => void }) {
  const p = profile.status === 'loaded' ? profile.data : null;
  const band = useMemo(() => bandOf(p), [p]);
  const avail = useMemo(() => availabilityOf(p), [p]);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [radius, setRadius] = useState('25');
  const [mobile, setMobile] = useState(false);
  const [zone, setZone] = useState(defaultZone());
  const [days, setDays] = useState<DayDraft[]>(DAYS.map((_, i) => ({ on: i >= 1 && i <= 5, start: '08:00', end: '17:00' })));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (band.declared) { setCity(band.city ?? ''); setState(band.state ?? ''); setRadius(String(band.radius ?? 25)); setMobile(!!band.mobile); }
    if (avail.declared) {
      if (avail.timezone) setZone(avail.timezone);
      setDays(DAYS.map((_, i) => { const w = avail.weekly.find(x => x.dow === i); return w ? { on: true, start: w.start, end: w.end } : { on: false, start: '08:00', end: '17:00' }; }));
    }
  }, [band, avail]);
  if (profile.status === 'loading') return <Text role="caption">Reading your provider page…</Text>;
  if (profile.status === 'failed') return <Failed what="Your provider page" reason={profile.reason} />;

  const saveArea = () => {
    setError(null);
    const built = serviceAreaArgs(city, state, radius, mobile);
    if ('error' in built) { setError(built.error); return; }
    const a = built.args;
    onSign({
      title: 'Set your service area', confirmLabel: 'Set service area',
      says: [`Clients and matching see a city-level band: ${a.p_city}, ${a.p_state} within ${a.p_radius_miles} miles${a.p_mobile ? ', and that you travel to the vehicle' : ''}.`],
      doesNotSay: ['Your street address or coordinates', 'A promise to take any job'],
      run: () => SetupSigns.serviceArea(a), doneText: 'Service area set. It replaces any earlier one.',
    });
  };
  const saveAvailability = () => {
    setError(null);
    const built = availabilityArgs(zone, days, avail.exceptions);
    if ('error' in built) { setError(built.error); return; }
    const w = built.args.p_windows;
    onSign({
      title: 'Set your availability', confirmLabel: 'Set availability',
      says: [w.weekly.length ? `You are usually available ${w.weekly.map(x => `${DAYS[x.dow]} ${x.start}–${x.end}`).join(', ')} (${w.timezone}).` : `You have no standing weekly hours (${w.timezone}).`],
      doesNotSay: ['A booking or a promise for any date', 'Changes to date exceptions you already set'],
      run: () => SetupSigns.availability(built.args), doneText: 'Availability set. It replaces any earlier hours.',
    });
  };
  return <>
    <Section title="Where you work" coverage={{ n: band.declared ? 1 : 0, of: 1, grain: 'service area stated', as_of: band.declaredAt }}>
      <Text role="body">{bandWords(band) ? `Now: ${bandWords(band)}.` : 'No service area yet.'} A city and a radius only; never a street address.</Text>
      <div className="jb-field--row">
        <label className="jb-field"><Text role="label">City</Text><input className="jb-input k-body" value={city} maxLength={60} onChange={e => setCity(e.target.value)} /></label>
        <label className="jb-field"><Text role="label">State</Text><input className="jb-input jb-input--short k-body" value={state} maxLength={2} onChange={e => setState(e.target.value)} /></label>
        <label className="jb-field"><Text role="label">Radius, miles</Text><input className="jb-input jb-input--short k-body" inputMode="numeric" value={radius} onChange={e => setRadius(e.target.value)} /></label>
      </div>
      <label className="jb-choice"><span><input type="checkbox" checked={mobile} onChange={e => setMobile(e.target.checked)} /> <Text role="body">I travel to the vehicle (mobile)</Text></span></label>
      <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={saveArea}><Text role="label">Set service area</Text></button></div>
    </Section>
    <Section title="When you work" coverage={{ n: avail.weekly.length, of: 7, grain: 'days with standing hours', as_of: null }}>
      <Text role="body">{weeklyWords(avail) ? `Now: ${weeklyWords(avail)}.` : 'No availability yet.'}</Text>
      <label className="jb-field"><Text role="label">Timezone</Text><input className="jb-input k-body" value={zone} onChange={e => setZone(e.target.value)} /></label>
      {days.map((d, i) => <div key={DAYS[i]} className="jb-field--row" role="group" aria-label={DAYS[i]}>
        <label className="jb-choice"><span><input type="checkbox" checked={d.on} onChange={e => setDays(ds => ds.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} /> <Text role="body">{DAYS[i]}</Text></span></label>
        {d.on && <>
          <input type="time" aria-label={`${DAYS[i]} start`} className="jb-input k-body jb-input--time" value={d.start} onChange={e => setDays(ds => ds.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <input type="time" aria-label={`${DAYS[i]} end`} className="jb-input k-body jb-input--time" value={d.end} onChange={e => setDays(ds => ds.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
        </>}
      </div>)}
      <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={saveAvailability}><Text role="label">Set availability</Text></button></div>
    </Section>
    {error && <Text role="body" className="jb-warn">{error}</Text>}
  </>;
}

// ── Step 4 ─────────────────────────────────────────────────────────────────

function ToolsStep({ profile, keys, userId, onSign }: { profile: Load<JsonObject>; keys: Load<ToolKey[]>; userId: string; onSign: (p: PendingSign) => void }) {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (profile.status === 'loading') return <Text role="caption">Reading your tools…</Text>;
  if (profile.status === 'failed') return <Failed what="Your tools" reason={profile.reason} />;
  const tools = obj(profile.data.tools);
  const seen = obj(tools?.seen_in_frame);
  const labels = arr(seen?.top_labels).map(obj).filter((o): o is JsonObject => !!o);
  const owned = toolCategories(obj(tools?.claimed_owned));
  const supporting = num(obj(tools?.co_signed)?.supporting_attestations) ?? 0;
  const map = keys.status === 'loaded' ? keys.data : [];
  const terms = Array.from(new Set(map.filter(k => k.source_kind === 'tool_term').map(k => k.source_key))).sort();
  const categories = Array.from(new Set(map.filter(k => k.source_kind === 'tool_category').map(k => k.source_key))).sort();
  const meets = description.trim() ? keysFor(map, description, category || null) : [];

  const add = () => {
    setError(null);
    const built = toolInsert(userId, description, category || null);
    if ('error' in built) { setError(built.error); return; }
    onSign({
      title: 'Add a tool you own', confirmLabel: 'Add tool',
      says: [`You own: ${built.row.description}${built.row.category ? ` (${built.row.category})` : ''}.`, 'It shows on your page as a tool you say you own.'],
      doesNotSay: ['That anyone checked it in person', 'Its value or condition'],
      run: () => SetupSigns.addTool(built.row), doneText: 'Added as a tool you say you own.',
    });
  };
  return <>
    <Section title="Seen in your photos" coverage={{ n: num(seen?.frames_with_tools) ?? 0, of: num(seen?.frames_analyzed) ?? 0, grain: 'analysed photos show tools', as_of: str(profile.data.as_of) }}>
      {labels.length === 0
        ? <Text role="body">No tools seen in your analysed photos yet. Photos of your work in progress let Nuke see them.</Text>
        : <Rows title="Tools seen · attributed to your photos">{labels.map(l => <Row key={str(l.label) ?? ''} label={str(l.label) ?? 'tool'} role="measure">{num(l.occurrences) ?? 0}</Row>)}</Rows>}
      {seenCoverage(seen) && <Text role="caption">{seenCoverage(seen)}. Counts are sightings, not distinct tools.</Text>}
    </Section>
    <Section title="Tools you say you own" coverage={{ n: owned.length, of: owned.length, grain: 'categories', as_of: str(profile.data.as_of) }}>
      {owned.length === 0
        ? <Text role="body">None yet.</Text>
        : <Rows title="Self-described">{owned.map(c => <Row key={c.category} label={c.category} role="measure">{c.records}</Row>)}</Rows>}
      <label className="jb-field"><Text role="label">Tool</Text>
        <input className="jb-input k-body" list="jb-tool-terms" value={description} maxLength={120} placeholder="tig welder" onChange={e => setDescription(e.target.value)} />
        <datalist id="jb-tool-terms">{terms.map(t => <option key={t} value={t} />)}</datalist></label>
      <label className="jb-field"><Text role="label">Category (optional)</Text>
        <select className="jb-input k-body" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">None</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select></label>
      {description.trim() && <Text role="caption">{meets.length
        ? `Counts for requests that need: ${meets.map(keyWords).join('; ')}.`
        : 'Not in the reviewed tool list yet; it is kept as you wrote it.'}</Text>}
      {error && <Text role="body" className="jb-warn">{error}</Text>}
      <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={add}><Text role="label">Add tool</Text></button></div>
    </Section>
    <Section title="Make it stronger" coverage={{ n: supporting, of: supporting, grain: 'supporting statements from others', as_of: str(profile.data.as_of) }}>
      <Text role="body">A tool you say you own is your word. A shop or tool owner you have worked with can vouch for you, or co-sign an offer you make on a job; their signed word is shown beside yours and counts for more.</Text>
    </Section>
  </>;
}

// ── Step 5 ─────────────────────────────────────────────────────────────────

function PreviewStep({ profile, own }: { profile: Load<JsonObject>; own: Load<OwnProfile> }) {
  if (profile.status === 'loading' || own.status === 'loading') return <Text role="caption">Building the preview…</Text>;
  if (profile.status === 'failed') return <Failed what="Your provider page" reason={profile.reason} />;
  if (own.status === 'failed') return <Failed what="Your profile" reason={own.reason} />;
  const p = profile.data;
  const items = checklist(p, own.data);
  const says = claimRows(obj(p.claims), false);
  const caps = capabilities(p);
  const owned = toolCategories(obj(obj(p.tools)?.claimed_owned));
  const days = obj(obj(p.work_record)?.days);
  const jobs = obj(obj(p.work_record)?.jobs);
  const handle = own.data.username?.trim();
  const done = items.filter(i => i.state === 'done').length;
  return <>
    <Section title="Checklist" coverage={{ n: done, of: items.length, grain: 'done', as_of: str(p.as_of) }}>
      <ul className="jb-match" aria-label="Checklist">{items.map(i => <li key={i.key} aria-label={`${i.label}: ${i.state}`}>
        <Text role="measure" dense className={`jb-mark${i.state === 'done' ? ' jb-mark--pass' : ''}`} aria-hidden>{i.state === 'done' ? '✓' : i.state === 'partial' ? '~' : i.state === 'optional' ? '·' : '–'}</Text>
        <Text role="body">{i.label} — {i.words}</Text>
      </li>)}</ul>
    </Section>
    <Section title="What a visitor sees" coverage={{ n: caps.length, of: caps.length, grain: 'capability rows from evidence', as_of: str(p.as_of) }}>
      <Text role="entity" dense>{handle ? '@' + handle : 'Unnamed party'}</Text>
      <Text role="caption">{technicianLinkOf(identityState(p), false)}</Text>
      <Rows title="They say · self-described">{says.map(r => <Row key={r.label} label={r.label}>{r.value}</Row>)}</Rows>
      <Rows title="The record shows · from evidence">{caps.map((c, i) => <Row key={i} label={capabilityLabel(c)}>{evidenceLine(c)}</Row>)}</Rows>
      <Rows title="Tools they say they own">{owned.map(c => <Row key={c.category} label={c.category} role="measure">{c.records}</Row>)}</Rows>
      <Rows title="Where and when">
        {bandWords(bandOf(p)) && <Row label="Service area">{bandWords(bandOf(p))}</Row>}
        {weeklyWords(availabilityOf(p)) && <Row label="Usually available">{weeklyWords(availabilityOf(p))}</Row>}
      </Rows>
      <Rows title="Work record">
        {num(days?.days_with_capture) !== null && <Row label="Days with photos of work" role="measure">{num(days?.days_with_capture)}</Row>}
        {num(days?.signed_work_days) !== null && <Row label="Days they confirmed" role="measure">{num(days?.signed_work_days)}</Row>}
        {num(jobs?.jobs) !== null && <Row label="Jobs on record" role="measure">{num(jobs?.jobs)}</Row>}
      </Rows>
      <Text role="caption">Read from your own view: tool sightings and work days here include photos on your private vehicles, which visitors do not see. Shops and contact details are never on the visitor face.</Text>
      {handle && own.data.is_public && <PrefetchLink to={`/providers/${encodeURIComponent(handle)}`}><Text role="body">Open your provider page</Text></PrefetchLink>}
    </Section>
  </>;
}

// ── Page ───────────────────────────────────────────────────────────────────

const ProviderSetupPage: React.FC = () => {
  usePageTitle('Set up your provider page');
  const { session } = useAuthContext();
  const userId: string | null = session?.user?.id ?? null;
  const [step, setStep] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [suggestions, setSuggestions] = useState<Load<Suggestions>>({ status: 'loading' });
  const [profile, setProfile] = useState<Load<JsonObject>>({ status: 'loading' });
  const [own, setOwn] = useState<Load<OwnProfile>>({ status: 'loading' });
  const [keys, setKeys] = useState<Load<ToolKey[]>>({ status: 'loading' });
  const [sign, setSign] = useState<PendingSign | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void SetupReaders.suggestions().then(r => { if (!cancelled) setSuggestions(loaded(r)); });
    void SetupReaders.profile(userId).then(r => { if (!cancelled) setProfile(loaded(r)); });
    void SetupReaders.own(userId).then(r => { if (!cancelled) setOwn(loaded(r)); });
    return () => { cancelled = true; };
  }, [userId, nonce]);
  useEffect(() => { void SetupReaders.toolKeys().then(r => setKeys(loaded(r))); }, []);

  const openSign = useCallback((p: PendingSign) => { setSign(p); setFailure(null); setDone(null); }, []);
  const confirm = async () => {
    if (!sign) return;
    setBusy(true);
    setFailure(null);
    const r = await sign.run();
    setBusy(false);
    if (r.refusal) { setFailure(`Not saved. ${r.refusal}`); return; }
    setDone(sign.doneText);
    setNonce(n => n + 1);
  };

  const items = profile.status === 'loaded' && own.status === 'loaded' ? checklist(profile.data, own.data) : [];
  const stepState = (i: number) => {
    const mine = items.filter(it => it.step === i + 1 && it.state !== 'optional');
    if (!mine.length) return null;
    return mine.every(it => it.state === 'done') ? 'done' : 'to do';
  };

  if (!userId) return <main className="jb-page jb-scope"><Text role="body">Sign in to set up your provider page.</Text></main>;

  return <main className="jb-page jb-scope">
    <div className="jb-intro">
      <Text role="entity" as="h1">Set up your provider page</Text>
      <Text role="body">Join, keep logging what you do with photos, and Nuke sends you jobs that fit. Each step is optional; skip any of them and come back later.</Text>
    </div>
    <nav aria-label="Setup steps" className="jb-steps">
      <ol className="jb-ol">{STEPS.map((t, i) => <li key={t}>
        <button type="button" className={`btn-base btn-xs ${i === step ? 'btn-primary' : 'btn-ghost'}`} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>
          <Text role="label">{t}</Text></button>
        {stepState(i) && <Text role="caption"> {stepState(i)}</Text>}
      </li>)}</ol>
    </nav>
    <div aria-label={STEPS[step]}>
      {step === 0 && <RecordsStep s={suggestions} onSign={openSign} />}
      {step === 1 && <TradeStep own={own} userId={userId} onSign={openSign} />}
      {step === 2 && <WhereWhenStep profile={profile} onSign={openSign} />}
      {step === 3 && <ToolsStep profile={profile} keys={keys} userId={userId} onSign={openSign} />}
      {step === 4 && <PreviewStep profile={profile} own={own} />}
    </div>
    <div className="jb-actions jb-more">
      {step > 0 && <button type="button" className="btn-base btn-sm btn-secondary" onClick={() => setStep(s => s - 1)}><Text role="label">Back</Text></button>}
      {step < STEPS.length - 1
        ? <button type="button" className="btn-base btn-sm btn-secondary" onClick={() => setStep(s => s + 1)}><Text role="label">{stepState(step) === 'done' ? 'Next' : 'Skip for now'}</Text></button>
        : <PrefetchLink to="/work"><Text role="body">Back to Work</Text></PrefetchLink>}
    </div>
    {sign && <SignSheet title={sign.title} says={sign.says} doesNotSay={sign.doesNotSay} confirmLabel={sign.confirmLabel} onConfirm={confirm}
      onClose={() => setSign(null)} busy={busy} failure={failure} done={done && <Text role="body" className="jb-done">{done}</Text>} />}
  </main>;
};

export default ProviderSetupPage;
