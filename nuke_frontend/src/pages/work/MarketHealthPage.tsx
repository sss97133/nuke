/**
 * /work/market — the job marketplace forming, from job_market_health_read (anon; aggregates only: no ids, names, handles,
 * amounts or texts). Demand, supply, matching, flow and trust as plain counts with their population; a daily trend line
 * only once the server has kept two or more snapshots; step times only where the server gives a median (2+ samples).
 */
import React, { useEffect, useState } from 'react';
import { Masthead, Row, Rows, Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { usePageTitle } from '../../hooks/usePageTitle';
import { readJob, type Load } from '../jobs/readJob';
import { day, num, obj, str, type JsonObject } from '../jobs/jobRead';
import { FLOW_WORDS, STEP_WORDS, UNKNOWN_WORDS, count, hoursText, series, sparkPoints } from './marketWords';
import '../jobs/jobs.css';
import './market.css';

const W = 120, H = 24;

function Trend({ read, field, label }: { read: JsonObject; field: string; label: string }) {
  const s = series(read, field);
  if (s.length < 2) return null;
  const values = s.map(p => p.value);
  return <span className="mk-trend" role="img" aria-label={`${label}: ${values.join(', ')} from ${day(s[0].date)} to ${day(s[s.length - 1].date)}`}>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><polyline className="mk-trend__line" points={sparkPoints(values, W, H)} /></svg>
  </span>;
}

function Stat({ read, value, label, trend }: { read: JsonObject; value: string; label?: string; trend?: string }) {
  return <div className="mk-stat">
    <Text role="measure">{value}</Text>
    {trend && <Trend read={read} field={trend} label={label ?? value} />}
  </div>;
}

export default function MarketHealthPage() {
  usePageTitle('The job market on Nuke');
  const [read, setRead] = useState<Load>({ status: 'loading' });
  useEffect(() => { readJob('job_market_health_read', {}).then(setRead); }, []);

  if (read.status !== 'loaded') {
    return <article className="jb-page jb-scope" aria-label="The job market on Nuke">
      <Masthead><Text role="entity" as="h1">The job market on Nuke</Text></Masthead>
      <Text role="body">{read.status === 'loading' ? 'Counting…' : read.reason}</Text>
    </article>;
  }
  const d = read.data;
  const asOf = str(d.as_of);
  const demand = obj(d.demand) ?? {}, supply = obj(d.supply) ?? {}, matching = obj(d.matching) ?? {}, flow = obj(d.flow) ?? {}, trust = obj(d.trust) ?? {};
  const open = num(demand.open_requirements) ?? 0;
  const published = obj(demand.published) ?? {};
  const kinds = obj(demand.open_requirements_by_kind) ?? {};
  const fresh = obj(demand.new_requests) ?? {};
  const claimable = obj(supply.supply_organizations_claimable) ?? {};
  const unknown = obj(matching.unknown_for_all) ?? {};
  const counts = obj(flow.counts) ?? {};
  const steps = obj(flow.step_hours) ?? {};
  const historyDays = series(d, 'open_requirements').length;
  const flowTotal = FLOW_WORDS.reduce((n, [k]) => n + (num(counts[k]) ?? 0), 0);
  const medians = Object.keys(STEP_WORDS).map(k => ({ k, h: num(obj(steps[k])?.median_hours), n: num(obj(steps[k])?.samples) ?? 0 })).filter(x => x.h !== null);

  return <article className="jb-page jb-scope" aria-label="The job market on Nuke">
    <Masthead result={<Text role="caption">{asOf ? `as of ${day(asOf)}` : ''}</Text>}>
      <Text role="entity" as="h1">The job market on Nuke</Text>
    </Masthead>
    <div className="jb-intro">
      <Text role="body">Who needs work done, who can do it, and how far jobs get — counted from the record, not estimated. No names, amounts or job details here.</Text>
      <Text role="caption"><PrefetchLink to="/jobs">Open requests</PrefetchLink>{' · '}<PrefetchLink to="/work">Your work</PrefetchLink>
        {historyDays < 2 ? ` · Daily history starts ${day(series(d, 'open_requirements')[0]?.date ?? asOf)}; trend lines appear after the second day.` : ` · Trends over ${historyDays} days.`}</Text>
    </div>

    <Section title="Demand" coverage={{ n: open, of: open, grain: 'open requests on public, open jobs', as_of: asOf }}>
      <div className="mk-stats">
        <Stat read={d} value={count(open, 'open request', 'open requests')} trend="open_requirements" />
        <Stat read={d} value={count(num(published.open), 'job open to technicians', 'jobs open to technicians')} />
        <Stat read={d} value={count(num(fresh.published_open_last_7_days), 'job opened this week', 'jobs opened this week')} trend="new_requests_last_7_days" label="New requests per week" />
      </div>
      <Rows title="Open requests by kind">
        {Object.keys(kinds).sort((a, b) => (num(kinds[b]) ?? 0) - (num(kinds[a]) ?? 0)).map(k =>
          <Row key={k} label={k === 'facility' ? 'Shop space' : k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')} role="measure">{(num(kinds[k]) ?? 0).toLocaleString('en-US')}</Row>)}
      </Rows>
      <Text role="caption" as="p">{`${count(num(demand.jobs), 'job', 'jobs')} on record; ${count(num(published.invite_only), 'is', 'are')} invite only and ${count(num(published.unset), 'has', 'have')} not been published.`}</Text>
    </Section>

    <Section title="Supply" coverage={{ n: num(supply.provider_population) ?? 0, of: num(supply.provider_population) ?? 0, grain: 'accounts that can be matched', as_of: asOf }}>
      <div className="mk-stats">
        <Stat read={d} value={count(num(supply.accounts_with_evidenced_provider_links), 'technician linked by evidence', 'technicians linked by evidence')} trend="evidenced_provider_accounts" />
        <Stat read={d} value={num(supply.verified_claimant_organizations) ? count(num(supply.verified_claimant_organizations), 'business claimed', 'businesses claimed') : '0 businesses claimed yet'} trend="verified_claimant_organizations" label="Businesses claimed" />
        <Stat read={d} value={count(num(supply.organizations_with_supply_evidence), 'business with purchase records', 'businesses with purchase records')} />
      </div>
      <Rows title="Ready to join">
        <Row label="Businesses not on Nuke yet" role="measure">{(num(claimable.not_on_nuke_yet) ?? 0).toLocaleString('en-US')}</Row>
        <Row label="Can claim with a work e-mail" role="measure">{(num(claimable.by_domain_email) ?? 0).toLocaleString('en-US')}</Row>
        <Row label="Need a document to claim" role="measure">{(num(claimable.document_only) ?? 0).toLocaleString('en-US')}</Row>
      </Rows>
      <Rows title="What providers have told us">
        <Row label="With availability set" role="measure">{(num(supply.providers_with_availability) ?? 0).toLocaleString('en-US')}</Row>
        <Row label="With a service area" role="measure">{(num(supply.providers_with_service_area) ?? 0).toLocaleString('en-US')}</Row>
        <Row label="Shop spaces declared" role="measure">{(num(supply.declared_facility_assets) ?? 0).toLocaleString('en-US')}</Row>
      </Rows>
    </Section>

    <Section title="Matching" coverage={{ n: num(matching.with_plan_b_supplier) ?? 0, of: num(matching.open_requirements) ?? open, grain: 'open requests with a backup supplier', as_of: asOf }}>
      <div className="mk-stats">
        <Stat read={d} value={`${count(num(matching.with_plan_b_supplier), 'request has', 'requests have')} a backup supplier`} trend="with_plan_b_supplier" label="Requests with a backup supplier" />
        <Stat read={d} value={`${count(num(matching.with_evidenced_candidate), 'request has', 'requests have')} a technician who fits`} trend="with_evidenced_candidate" label="Requests with a fitting technician" />
        <Stat read={d} value={`${count(num(matching.with_reachable_plan_b_supplier), 'backup supplier', 'backup suppliers')} can take requests`} />
      </div>
      <Rows title="Not known for anyone yet">
        {Object.keys(unknown).filter(k => (num(unknown[k]) ?? 0) > 0).map(k =>
          <Row key={k} label={`No one has stated ${UNKNOWN_WORDS[k] ?? k.replace(/_/g, ' ')}`} role="measure">{count(num(unknown[k]), 'request', 'requests')}</Row>)}
      </Rows>
      <Text role="caption" as="p">{`${count(num(matching.with_no_provider_considered), 'request has', 'requests have')} no provider considered yet. Matching never counts the job's own customer.`}</Text>
    </Section>

    <Section title="Jobs moving" coverage={{ n: flowTotal, of: flowTotal, grain: 'signed steps on record', as_of: asOf }}>
      {flowTotal === 0 ? <Text role="body" as="p">No offers, quotes, starts, completions or invoices are on record yet. Each will show here as people sign them.</Text>
        : <Rows title="Signed steps">{FLOW_WORDS.map(([k, one, many]) => <Row key={k} label={(num(counts[k]) ?? 0) === 1 ? one : many} role="measure">{(num(counts[k]) ?? 0).toLocaleString('en-US')}</Row>)}</Rows>}
      {medians.length > 0 && <Rows title="Typical time between steps">
        {medians.map(m => <Row key={m.k} label={STEP_WORDS[m.k]} role="measure">{`${hoursText(m.h)} · ${m.n} jobs`}</Row>)}
      </Rows>}
      <Text role="caption" as="p">Nuke records payments; it doesn't move money.</Text>
    </Section>

    <Section title="Trust" coverage={{ n: num(trust.owner_delegated_signs) ?? 0, of: num(trust.owner_delegated_signs) ?? 0, grain: 'signs made on an owner’s behalf', as_of: asOf }}>
      <Rows title="Safeguards">
        <Row label="Signs made on an owner's behalf, last 30 days" role="measure">{(num(trust.owner_delegated_signs_last_30_days) ?? 0).toLocaleString('en-US')}</Row>
        <Row label="Known open access exposures" role="measure">{(num(trust.open_exposures_known) ?? 0).toLocaleString('en-US')}</Row>
      </Rows>
    </Section>
  </article>;
}
