import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { usePageTitle } from '../../hooks/usePageTitle';
import { PrefetchLink } from '../../components/PrefetchLink';
import { Masthead, Row, Rows, Section, Text, type Coverage } from '../../kit';
import { JobStageRail } from '../jobs/JobStageRail';
import { readJob, type Load } from '../jobs/readJob';
import { arr, day, num, obj, parseActions, personLabel, sentence, slotWord, str, strings, vehicleText, type JsonObject, type StageKey } from '../jobs/jobRead';
import {
  capabilities, capabilityLabel, claimRows, evidenceLine, place, seenCoverage, showsShops, strengthWord, subjectName,
  technicianLinkOf, toolCategories,
} from './providerRead';
import { ContactViaNuke } from './ContactViaNuke';
import { SignActions } from '../jobs/SignAction';
import { VouchSheet } from '../jobs/PeopleSheets';
import { setupIncomplete } from '../provider-setup/setupReaders';
import '../jobs/job-page.css';

type Subject = { p_user_id: string } | { p_actor_id: string };

const cov = (n: number, of: number, grain: string, asOf: unknown): Coverage => ({ n, of: Math.max(of, n), grain, as_of: str(asOf) });
const count = (n: number | null) => (n ?? 0).toLocaleString('en-US');

function SaysSection({ p, isSelf }: { p: JsonObject; isSelf: boolean }) {
  const rows = claimRows(obj(p.claims), isSelf);
  if (!rows.length) return null;
  return <Section title={isSelf ? 'What you say' : 'What they say'} coverage={cov(rows.length, rows.length, 'self-described statements, unchecked', p.as_of)}>
    <Rows title="Self-described">{rows.map(r => <Row key={r.label} label={r.label}>{r.value} <Text role="caption">· {r.basis}</Text></Row>)}</Rows>
    <Text role="caption" as="p">Self-described. Nuke hasn't checked it, and it never counts toward what the record shows.</Text>
  </Section>;
}

function RecordSection({ p }: { p: JsonObject }) {
  const caps = capabilities(p);
  if (!caps.length) return null;
  const derived = caps.filter(c => c.derived);
  const legacy = caps.filter(c => !c.derived);
  return <Section title="What the record shows" coverage={cov(derived.length, caps.length, 'capability rows derived from evidence', p.as_of)}>
    <Rows title="Derived from evidence" count={derived.length}>
      {derived.map((c, i) => <Row key={`d${i}`} label={capabilityLabel(c)}>
        {strengthWord(c.strength)} · {evidenceLine(c)}{day(c.last) ? ` · last shown ${day(c.last)}` : ''}
      </Row>)}
    </Rows>
    <Rows title="Older records, basis not kept" count={legacy.length}>
      {legacy.map((c, i) => <Row key={`l${i}`} label={capabilityLabel(c)}>{evidenceLine(c)} · entered by hand{day(c.last) ? ` · ${day(c.last)}` : ''}</Row>)}
    </Rows>
    <Text role="caption" as="p">Worked out from evidence of work. Self-claims, profile expertise, vouches, co-signs and offers are never counted here.</Text>
  </Section>;
}

function ToolsSection({ p, isSelf }: { p: JsonObject; isSelf: boolean }) {
  const tools = obj(p.tools);
  const seen = obj(tools?.seen_in_frame);
  const owned = obj(tools?.claimed_owned);
  const coSigned = obj(tools?.co_signed);
  const seenOn = seen && seen.state !== 'not_assessed';
  const ownedOn = owned && owned.state !== 'not_assessed';
  const categories = ownedOn ? toolCategories(owned) : [];
  const supporting = num(coSigned?.supporting_attestations) ?? 0;
  if (!seenOn && !categories.length && !supporting) return null;
  const labels = arr(seen?.top_labels).map(obj).filter((o): o is JsonObject => !!o);
  return <Section title="Tools, by how they're known" coverage={cov(num(seen?.frames_with_tools) ?? 0, num(seen?.frames_analyzed) ?? 0, 'analysed photos with tools', p.as_of)}>
    {seenOn && <Rows title={isSelf ? 'Seen in your photos · attributed' : 'Seen in their photos · attributed'} count={num(seen?.occurrences)}>
      {labels.map((l, i) => <Row key={i} label={sentence(str(l.label) ?? 'tool')} role="measure">seen {count(num(l.occurrences))}×</Row>)}
    </Rows>}
    {seenOn && <Text role="caption" as="p">Sightings, not a count of distinct tools{seenCoverage(seen) ? `: ${seenCoverage(seen)}` : ''}.</Text>}
    <Rows title={isSelf ? 'You say you own · self-described' : 'They say they own · self-described'} count={categories.length}>
      {categories.map(c => <Row key={c.category} label={c.category} role="measure">{c.records === 1 ? '1 record' : `${count(c.records)} records`}</Row>)}
    </Rows>
    {categories.length > 0 && <Text role="caption" as="p">From receipts and inventory {isSelf ? 'you keep' : 'they keep'}. Not checked in person; values are not shown.</Text>}
    <Rows title="Co-signed on jobs · stated by others">
      {supporting > 0 && <Row label="Co-signs" role="measure">{count(supporting)} · {count(num(coSigned?.authenticated_attestations))} signed through Nuke</Row>}
    </Rows>
  </Section>;
}

function vouchLine(v: JsonObject): string {
  return [strings(v.kinds).map(k => sentence(k).toLowerCase()).join(', '), str(v.scope), day(str(v.vouched_at ?? v.signed_at)) ? `vouched ${day(str(v.vouched_at ?? v.signed_at))}` : null,
    day(str(v.expires_at)) ? `until ${day(str(v.expires_at))}` : null].filter(Boolean).join(' · ');
}

function VouchSection({ p, canVouch, name, onChanged }: { p: JsonObject; canVouch: boolean; name: string; onChanged: () => void }) {
  const [vouching, setVouching] = useState(false);
  const items = arr(obj(p.vouched_for_by)?.items).map(obj).filter((o): o is JsonObject => !!o);
  const s = obj(p.subject);
  const subject = s?.kind === 'actor' ? { userId: null, actorId: str(s.actor_id) } : { userId: str(s?.profile_id), actorId: null };
  if (!items.length && !canVouch) return null;
  return <Section title="Vouched for by" coverage={cov(items.length, items.length, 'standing vouches', p.as_of)}>
    <Rows title="Vouches">
      {items.map((v, i) => {
        const voucher = obj(v.voucher);
        const handle = str(voucher?.handle);
        const who = handle ? '@' + handle : voucher?.kind === 'organization' && str(voucher?.name) ? str(voucher?.name)! : 'Unnamed party';
        return <Row key={str(v.vouch_id) ?? i} label={who + (v.is_mine === true ? ' · yours' : '')}>{vouchLine(v)}</Row>;
      })}
    </Rows>
    <SignActions actions={items.flatMap(v => parseActions(v.actions))} onSigned={onChanged} />
    <Text role="caption" as="p">A vouch is someone's signed word about this person. It isn't counted as skill.</Text>
    {canVouch && <button type="button" className="job-button" onClick={() => setVouching(true)}><Text role="label">Vouch for this person</Text></button>}
    {vouching && <VouchSheet subject={subject} name={name} onClose={() => setVouching(false)} onDone={onChanged} />}
  </Section>;
}

/** The person's own vouches (my_vouches_read), each withdrawable while active. Self face only. */
function MyVouchesSection({ onChanged }: { onChanged: () => void }) {
  const [read, setRead] = useState<Load>({ status: 'loading' });
  useEffect(() => { readJob('my_vouches_read', {}).then(setRead); }, []);
  if (read.status !== 'loaded') return read.status === 'failed' ? <section className="k-section job-block"><Text role="body" as="p">{`Your vouches: ${read.reason}`}</Text></section> : null;
  const items = arr(read.data.items).map(obj).filter((o): o is JsonObject => !!o);
  if (!items.length) return null;
  return <Section title="Your vouches" coverage={cov(items.length, items.length, 'vouches you manage', read.data.as_of)}>
    <Rows title="Vouches you signed">
      {items.map((v, i) => <Row key={str(v.vouch_id) ?? i} label={`${personLabel(v.subject)} · ${sentence(str(v.status) ?? 'active').toLowerCase()}`}>{vouchLine(v)}</Row>)}
    </Rows>
    <SignActions actions={items.flatMap(v => parseActions(v.actions))} onSigned={() => { readJob('my_vouches_read', {}).then(setRead); onChanged(); }} />
  </Section>;
}

function ShopsSection({ p }: { p: JsonObject }) {
  const shops = arr(p.facilities).map(obj).filter((o): o is JsonObject => !!o)
    .filter(f => f.relation_kind === 'ownership' || ['live', 'stalling'].includes(str(obj(f.relation)?.state) ?? ''));
  if (!shops.length) return null;
  return <Section title="Your shops" coverage={cov(shops.length, arr(p.facilities).length, 'shops with recent activity or owned', p.as_of)}>
    <Rows title="Shops">{shops.map((f, i) => <Row key={i} label={str(f.name) ?? 'Unnamed shop'}>
      {f.relation_kind === 'ownership' ? 'Owner' : sentence(str(f.role) ?? 'member')}
    </Row>)}</Rows>
    <Text role="caption" as="p">Shown only to you. Visitors don't see shops on a profile.</Text>
  </Section>;
}

function WorkRecordSection({ p, isSelf }: { p: JsonObject; isSelf: boolean }) {
  const record = obj(p.work_record);
  const days = obj(record?.days);
  const jobs = obj(record?.jobs);
  const daysOn = days && days.state !== 'not_assessed';
  if (!daysOn && !jobs) return null;
  const span = obj(days?.capture_span_hours);
  const byRole = obj(jobs?.by_role) ?? {};
  const completion = obj(jobs?.completion);
  return <Section title="Work record" coverage={cov(num(days?.signed_work_days) ?? 0, num(days?.days_with_capture) ?? 0, 'photo days signed as work days', p.as_of)}>
    {daysOn && <Rows title="Days">
      <Row label="Signed work days" role="measure">{count(num(days?.signed_work_days))}</Row>
      <Row label="Days with work photos" role="measure">{count(num(days?.days_with_capture))}</Row>
      {num(span?.value) !== null && <Row label="Photo time, not hours worked" role="measure">{count(Math.round(num(span?.value)!))} h</Row>}
      {(day(str(days?.first_day)) || day(str(days?.last_day))) && <Row label="Span">{[day(str(days?.first_day)), day(str(days?.last_day))].filter(Boolean).join(' – ')}</Row>}
    </Rows>}
    {daysOn && <Text role="caption" as="p">Signed means {isSelf ? 'you' : 'they'} confirmed the day from {isSelf ? 'your' : 'their'} photos; it is not the customer's acceptance. Photo time is the span between the first and last photo.</Text>}
    {jobs && <Rows title="Jobs" count={num(jobs.jobs)}>
      {Object.keys(byRole).sort().map(role => <Row key={role} label={`As ${slotWord(role)}`} role="measure">{count(num(byRole[role]))}</Row>)}
      <Row label="Completed, with a date" role="measure">{count(num(completion?.recorded))}</Row>
      <Row label="Marked done, no date" role="measure">{count(num(completion?.status_only))}</Row>
      {(num(jobs.in_progress) ?? 0) > 0 && <Row label="In progress" role="measure">{count(num(jobs.in_progress))}</Row>}
      {(num(jobs.inconsistencies) ?? 0) > 0 && <Row label="Records disagree" role="measure">{count(num(jobs.inconsistencies))}</Row>}
    </Rows>}
    {jobs && <Text role="caption" as="p">Completed means a completion date is on record, not that the customer approved the work.</Text>}
  </Section>;
}

function ProductivitySection({ d }: { d: JsonObject }) {
  const totals = obj(d.totals);
  const range = obj(d.range);
  const days = arr(d.days).map(obj).filter((o): o is JsonObject => !!o);
  const dayRate = arr(d.day_rate_jobs).map(obj).filter((o): o is JsonObject => !!o);
  const active = num(totals?.days_with_activity) ?? 0;
  if (!active && !dayRate.length) return null;
  const from = str(range?.from), to = str(range?.to);
  const spanDays = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : active;
  return <Section title="Productivity" coverage={cov(active, spanDays, 'days with activity', d.as_of)}>
    <Rows title={`${day(from) ?? '?'} – ${day(to) ?? '?'}`}>
      <Row label="Days with activity" role="measure">{count(active)}</Row>
      <Row label="Days they confirmed" role="measure">{count(num(totals?.self_confirmed_days))}</Row>
      <Row label="Days inside a customer-accepted job" role="measure">{count(num(totals?.customer_accepted_days))}</Row>
      <Row label="Operations completed" role="measure">{count(num(totals?.operations_completed))}</Row>
      <Row label="Completions the customer accepted" role="measure">{count(num(totals?.completions_accepted))}</Row>
    </Rows>
    <Rows title="Days" count={days.length}>
      {days.slice(0, 14).map((x, i) => {
        const signed = obj(x.signed);
        const mark = signed?.customer_accepted === true ? 'customer-accepted' : signed?.self_confirmed === true ? 'confirmed by them' : 'not signed';
        const photos = num(x.image_evidence) ?? 0;
        return <Row key={i} label={day(str(x.day)) ?? 'Day'}>{`${count(photos)} photo${photos === 1 ? '' : 's'} · ${mark}`}</Row>;
      })}
    </Rows>
    {dayRate.length > 0 && <Rows title="Day-rate jobs" count={dayRate.length}>
      {dayRate.map((j, i) => <Row key={i} label={str(j.display_title) ?? 'Job'}>{vehicleText(j.vehicle_label) ?? ''}</Row>)}
    </Rows>}
    <Text role="caption" as="p">Measured from signed days and completion evidence. No inferred minutes; photo spans are not labor time; totals, payouts and payments are never shown.</Text>
  </Section>;
}

function JobsSection({ page, onMore, loadingMore }: { page: JsonObject; onMore: () => void; loadingMore: boolean }) {
  const rows = arr(page.rows).map(obj).filter((o): o is JsonObject => !!o && !!str(o.work_order_id));
  const c = obj(page.coverage);
  if (!rows.length) return null;
  return <Section title="Jobs on record" coverage={cov(rows.length, num(c?.total_for_subject) ?? rows.length, 'jobs', page.as_of)}>
    {rows.map(r => {
      const states = obj(r.stage_states) ?? {};
      const ops = obj(r.operation_kinds) ?? {};
      const opsLine = Object.keys(ops).sort((a, b) => (num(ops[b]) ?? 0) - (num(ops[a]) ?? 0)).map(k => `${sentence(k).toLowerCase()} ${num(ops[k])}`).join(' · ');
      const dates = obj(r.dates);
      return <div key={str(r.work_order_id)!} className="job-row">
        <div className="job-row__main">
          <PrefetchLink className="job-link" to={`/jobs/${str(r.work_order_id)}`}>
            <Text role="entity" dense>{str(r.display_title) ?? vehicleText(r.vehicle_label) ?? 'Untitled job'}</Text>
          </PrefetchLink>
          <Text role="caption">{[vehicleText(r.vehicle_label), strings(r.subject_roles).map(slotWord).join(', '), opsLine,
            day(str(dates?.completion_clock)) ? `completed ${day(str(dates?.completion_clock))}` : null].filter(Boolean).join(' · ')}</Text>
        </div>
        <JobStageRail compact states={states as Partial<Record<StageKey, string | null>>} />
      </div>;
    })}
    {str(page.next_after) && <button type="button" className="job-button" disabled={loadingMore} onClick={onMore}>
      <Text role="label">{loadingMore ? 'Loading…' : 'More jobs'}</Text>
    </button>}
    <Text role="caption" as="p">Customer identity and payments are withheld. Stages show what's on record, not yet verified.</Text>
  </Section>;
}

export default function ProviderProfilePage() {
  const { handle, actorId } = useParams<{ handle?: string; actorId?: string }>();
  const { user } = useAuth();
  const [subject, setSubject] = useState<Subject | null | 'missing'>(null);
  const [profile, setProfile] = useState<Load>({ status: 'loading' });
  const [jobs, setJobs] = useState<Load>({ status: 'loading' });
  const [productivity, setProductivity] = useState<Load>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSubject(null);
    if (actorId) { setSubject({ p_actor_id: actorId }); return; }
    if (!handle) { setSubject('missing'); return; }
    supabase.from('profiles').select('id').eq('username', handle).maybeSingle()
      .then(({ data }: { data: { id?: string } | null }) => { if (!cancelled) setSubject(data?.id ? { p_user_id: data.id } : 'missing'); });
    return () => { cancelled = true; };
  }, [handle, actorId]);

  useEffect(() => {
    if (!subject || subject === 'missing') return;
    let cancelled = false;
    setProfile({ status: 'loading' }); setJobs({ status: 'loading' }); setProductivity({ status: 'loading' });
    const ids = { p_user_id: null, p_actor_id: null, ...subject };
    readJob('provider_profile_read', subject).then(l => { if (!cancelled) setProfile(l); });
    readJob('provider_job_record_read', { ...ids, p_after: null, p_limit: 10 }).then(l => { if (!cancelled) setJobs(l); });
    readJob('provider_productivity_read', subject).then(l => { if (!cancelled) setProductivity(l); });
    return () => { cancelled = true; };
  }, [subject, nonce]);

  const loadMore = useCallback(async () => {
    if (jobs.status !== 'loaded' || !subject || subject === 'missing') return;
    const after = str(jobs.data.next_after);
    if (!after) return;
    setLoadingMore(true);
    const next = await readJob('provider_job_record_read', { p_user_id: null, p_actor_id: null, ...subject, p_after: after, p_limit: 10 });
    setLoadingMore(false);
    if (next.status === 'loaded') {
      setJobs({ status: 'loaded', data: { ...next.data, rows: [...arr(jobs.data.rows), ...arr(next.data.rows)] } });
    }
  }, [jobs, subject]);

  const p = profile.status === 'loaded' ? profile.data : null;
  const s = obj(p?.subject);
  const name = p ? subjectName(s) : handle ? '@' + handle : 'Provider';
  usePageTitle(`${name} · work record`);

  if (subject === 'missing') {
    return <article className="job-page" aria-label="Provider unavailable">
      <Masthead><Text role="entity" as="h1">No public profile</Text></Masthead>
      <section className="k-section job-block"><Text role="body" as="p">No public profile has the handle {handle ? `@${handle}` : 'given'}. The link may be old, or mistyped.</Text></section>
    </article>;
  }
  if (profile.status === 'loading') {
    return <article className="job-page" aria-busy="true" aria-label={name}>
      <Masthead><Text role="entity" as="h1">{name}</Text></Masthead>
      <section className="k-section job-block"><Text role="caption" as="p">Loading their work record. A long record can take a few seconds the first time.</Text></section>
    </article>;
  }
  if (profile.status === 'failed') {
    return <article className="job-page" aria-label="Provider unavailable">
      <Masthead><Text role="entity" as="h1">{name}</Text></Masthead>
      <section className="k-section job-block">
        <Text role="body" as="p">{profile.reason}</Text>
        <button type="button" className="job-button" onClick={() => setNonce(n => n + 1)}><Text role="label">Try again</Text></button>
      </section>
    </article>;
  }

  const data = profile.data;
  const viewerContext = str(obj(data.viewer)?.context);
  const isSelf = viewerContext === 'self';
  const bridge = obj(data.identity_bridge);
  const evidencedHandle = s?.kind === 'actor' ? str(obj(s.display)?.handle) : null;
  const where = place(s);

  return <article className="job-page" aria-label={`${name}, work record`}>
    <Masthead result={<Text role="caption">{[where, day(str(s?.member_since)) ? `on Nuke since ${day(str(s?.member_since))}` : null].filter(Boolean).join(' · ')}</Text>}>
      <div className="job-masthead">
        <Text role="entity" as="h1">{name}</Text>
        <Text role="caption">{technicianLinkOf(str(bridge?.state), isSelf)}</Text>
        {evidencedHandle && <PrefetchLink className="job-link" to={`/providers/${encodeURIComponent(evidencedHandle)}`}><Text role="body">Open @{evidencedHandle}'s provider page</Text></PrefetchLink>}
        {s?.kind === 'user' && str(s.handle) && <PrefetchLink className="job-link" to={`/u/${encodeURIComponent(str(s.handle)!)}`}><Text role="body">Open their profile</Text></PrefetchLink>}
        {isSelf && setupIncomplete(data) && <PrefetchLink className="job-link" to="/work/setup"><Text role="body">Finish setting up your provider page</Text></PrefetchLink>}
      </div>
    </Masthead>

    <SaysSection p={data} isSelf={isSelf} />
    <RecordSection p={data} />
    <ToolsSection p={data} isSelf={isSelf} />
    <VouchSection p={data} name={name} onChanged={() => setNonce(n => n + 1)}
      canVouch={!!user && !isSelf && (s?.kind === 'actor' ? !!str(s.actor_id) : !!str(s?.profile_id))} />
    {isSelf && <MyVouchesSection onChanged={() => setNonce(n => n + 1)} />}
    {showsShops(viewerContext) && <ShopsSection p={data} />}
    <WorkRecordSection p={data} isSelf={isSelf} />
    {jobs.status === 'loaded' && <JobsSection page={jobs.data} onMore={loadMore} loadingMore={loadingMore} />}
    {productivity.status === 'loaded' && <ProductivitySection d={productivity.data} />}

    {(jobs.status === 'failed' || productivity.status === 'failed') && <section className="k-section job-block" aria-label="Not loaded">
      <Text role="label" as="h2">Not loaded</Text>
      {jobs.status === 'failed' && <Text role="body" as="p">Jobs on record: {jobs.reason}</Text>}
      {productivity.status === 'failed' && <Text role="body" as="p">Productivity: {productivity.reason}</Text>}
    </section>}

    {!isSelf && <section className="k-section job-block" aria-label="Contact via Nuke">
      <Text role="label" as="h2">Contact</Text>
      <ContactViaNuke contact={obj(data.contact)} signedIn={!!user} recipient={name} />
    </section>}
  </article>;
}
