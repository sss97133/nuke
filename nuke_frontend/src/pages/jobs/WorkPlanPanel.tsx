/**
 * WorkPlanPanel — "Plan the work" for a listed vehicle (listing_work_plan_read).
 *
 * What checking this car would cover, not a restoration price: identity checks first; the listing's
 * claims as quoted testimony with their source, date and confidence; likely work as rough hour
 * ranges; parts only where a name matched (fit unverified); and the pre-purchase checklist an
 * inspection would answer. No labor rate is shown: the reader returns a placeholder, and the owner's
 * decision is hours only until a technician quotes. "Order an inspection" is the request_inspection
 * Sign with the reader's own inspection_scope.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Section, Text, Rows, Row } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { SignSheet } from './SignSheet';
import {
  IDENTITY_FIELDS, JobReaders, JobSigns, NO_SHOP_RATE, PLAN_HEADLINE, ROUGH_GUIDE, claimKindWord, claimSourceLine, hostOf, identityFieldLabel,
  identityStatusWord, identityValues, isExactQuote, jobHref, sentence, systemWord, targetHours, vehicleText, vinDecodeLine, type WorkPlan,
} from './jobsReaders';
import './jobs.css';

const CLAIMS_SHOWN = 6;

function OrderInspectionSheet({ vehicleId, plan, onClose }: { vehicleId: string; plan: WorkPlan; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [ordered, setOrdered] = useState<{ work_order_id: string; duplicate: boolean } | null>(null);
  const n = plan.inspection_scope?.ppi_checklist?.length ?? 0;
  const order = async () => {
    setFailure(null);
    setBusy(true);
    const r = await JobSigns.requestInspection(vehicleId, plan.inspection_scope);
    setBusy(false);
    if (r.refusal) setFailure(`Not ordered. ${r.refusal.message}`);
    else setOrdered({ work_order_id: r.data.work_order_id, duplicate: !!r.data.duplicate });
  };
  return <SignSheet title="Order an inspection" confirmLabel="Order inspection" onConfirm={order} onClose={onClose} busy={busy} failure={failure}
    says={[`You're asking for a pre-purchase inspection of this vehicle against ${n} checklist item${n === 1 ? '' : 's'}.`,
      'Inspectors can offer to do it; you choose whom to accept.']}
    doesNotSay={["The seller's permission or access to the vehicle", 'Any payment', 'That anyone is booked']}
    done={ordered && <div className="jb-says">
      <Text role="body" className="jb-done">{ordered.duplicate ? 'You already ordered this inspection.' : 'Inspection ordered.'}</Text>
      <PrefetchLink to={jobHref(ordered.work_order_id)}><Text role="body">Open the inspection job</Text></PrefetchLink>
    </div>}>
    <div className="jb-field"><Text role="label">Vehicle</Text><Text role="body">{vehicleText(plan.vehicle_label) ?? plan.record_label ?? 'This vehicle'}</Text></div>
  </SignSheet>;
}

export function WorkPlanView({ vehicleId, plan, signedIn }: { vehicleId: string; plan: WorkPlan; signedIn: boolean }) {
  const [allClaims, setAllClaims] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const fields = plan.identity?.fields ?? {};
  const flagged = [...(plan.identity?.conflicts ?? []), ...(plan.identity?.unresolved_specificity ?? [])];
  const agreeing = IDENTITY_FIELDS.filter(f => fields[f] && ['agree', 'single_source'].includes(fields[f].status)).length;
  const stated = IDENTITY_FIELDS.filter(f => fields[f] && fields[f].status !== 'absent' && (fields[f].values?.length ?? 0) > 0).length;
  const claims = allClaims ? plan.claims : plan.claims.slice(0, CLAIMS_SHOWN);
  const exact = plan.claims.filter(isExactQuote).length;
  const priced = plan.parts.flatMap(p => p.rows.map(r => ({ ...r, term: p.term })));
  const host = hostOf(plan.listing_url);
  const asOf = plan.as_of;
  const vinState = plan.identity?.vin_decode?.state;

  return <div aria-label="Plan the work">
    <Section title="Plan the work" coverage={{ n: plan.claims.length, of: plan.claims.length, grain: 'listing claims read', as_of: asOf }}>
      <Text role="body">{PLAN_HEADLINE}</Text>
      {plan.listing_url && host && <Text role="caption">Listing: <a href={plan.listing_url} target="_blank" rel="noreferrer">{host} ↗</a></Text>}
    </Section>

    <Section title="Check the identity first" coverage={{ n: agreeing, of: stated, grain: 'stated fields agree', as_of: asOf }}>
      {flagged.length === 0
        ? <Text role="body">{stated === 0 ? 'No identity fields were available to compare. Agreement is unassessed.' : `The details agree across sources (${agreeing} checked).`}</Text>
        : <Rows title="Differences">{flagged.map(f => <Row key={f} label={`${identityFieldLabel(f)} · ${identityStatusWord(fields[f]?.status)}`}>{identityValues(fields[f])}</Row>)}</Rows>}
      {vinState && vinState !== 'usable' && <Text role="caption">{vinDecodeLine(vinState)}</Text>}
      <Text role="caption">A difference doesn't say which source is right. The inspection does.</Text>
    </Section>

    <Section title="What the listing claims" coverage={{ n: exact, of: plan.claims.length, grain: 'claims quoted exactly', as_of: asOf }}>
      {plan.claims.length === 0 && <Text role="body">No claims read from the listing.</Text>}
      <ul className="jb-list">{claims.map(c => <li key={c.claim_id} className="jb-row">
        <Text role="label">{claimKindWord(c.kind)}</Text>
        {isExactQuote(c)
          ? <blockquote className="jb-quote"><Text role="body">“{c.verbatim_excerpt!.quote.trim()}”</Text></blockquote>
          : <Text role="body">{c.text}</Text>}
        <Text role="caption">{claimSourceLine(c)}</Text>
      </li>)}</ul>
      {plan.claims.length > CLAIMS_SHOWN && <div className="jb-more"><button type="button" className="btn-base btn-xs btn-secondary" onClick={() => setAllClaims(v => !v)}>
        <Text role="label">{allClaims ? 'Fewer claims' : `${plan.claims.length - CLAIMS_SHOWN} more claims`}</Text></button></div>}
      <Text role="caption">What the seller says, not checked.</Text>
    </Section>

    <Section title="Likely work" coverage={{ n: plan.operation_coverage?.matched_claims ?? 0, of: plan.operation_coverage?.eligible_claims ?? 0, grain: 'claims matched a known operation', as_of: asOf }}>
      {plan.candidate_operations.length === 0 && <Text role="body">No known operations matched the listing's claims.</Text>}
      {plan.candidate_operations.map(op => <Rows key={op.operation_id} title={`${systemWord(op.system)} · ${sentence(op.keyword_entry_id ?? op.operation_id.replace(/^op:/, ''))}`}>
        {op.targets.map((t, i) => <Row key={`${t.code ?? t.name ?? i}`} label={t.name ?? 'Operation'} role="measure">{targetHours(t)}</Row>)}
      </Rows>)}
      {plan.candidate_operations.length > 0 && <Text role="caption">Hours are a {ROUGH_GUIDE}, and are not multiplied into a price.</Text>}
      <Text role="body">{NO_SHOP_RATE}</Text>
    </Section>

    {priced.length > 0 && <Section title="Parts" coverage={{ n: priced.length, of: priced.length, grain: 'parts matched by name', as_of: asOf }}>
      <Rows title="Matched by name only. Fit isn't checked.">{priced.map(p => <Row key={p.catalog_part_id ?? `${p.term}:${p.part_number}`}
        label={`${p.name ?? p.term}${p.part_number ? ` · ${p.part_number}` : ''} · unverified fit`}>{p.manufacturer ?? sentence(p.term)}</Row>)}</Rows>
    </Section>}

    <Section title="Inspection checklist" coverage={{ n: plan.ppi_checklist.length, of: plan.ppi_checklist.length, grain: 'items', as_of: asOf }}>
      <ol className="jb-ol">{plan.ppi_checklist.map(i => <li key={i.item_id}><Text role="body">{i.question}</Text></li>)}</ol>
      <Text role="caption">An inspection answers each item with what it found.</Text>
      <div className="jb-actions">
        {signedIn
          ? <button type="button" className="btn-base btn-sm btn-primary" disabled={plan.ppi_checklist.length === 0} onClick={() => setOrdering(true)}><Text role="label">Order an inspection</Text></button>
          : <PrefetchLink to="/login"><Text role="body">Sign in to order an inspection</Text></PrefetchLink>}
      </div>
      {plan.model_calls === 0 && plan.database_writes === 0 &&
        <Text role="caption">Read from the listing and Nuke's records. Nothing was saved and no AI was used to make this plan.</Text>}
    </Section>
    {ordering && <OrderInspectionSheet vehicleId={vehicleId} plan={plan} onClose={() => setOrdering(false)} />}
  </div>;
}

export default function WorkPlanPanel({ vehicleId, signedIn }: { vehicleId: string; signedIn: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking the viewer for the work plan…</p>;
  return <ViewerWorkPlan key={`${user?.id ?? 'anonymous'}:${vehicleId}`} vehicleId={vehicleId} signedIn={signedIn} />;
}

function ViewerWorkPlan({ vehicleId, signedIn }: { vehicleId: string; signedIn: boolean }) {
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPlan(null); setRefusal(null);
    void JobReaders.plan(vehicleId).then(result => {
      if (cancelled) return;
      if (result.refusal) setRefusal(result.refusal.message);
      else if (result.data) setPlan(result.data);
      else setRefusal('The plan reader returned no result.');
    }).catch(() => { if (!cancelled) setRefusal('The work plan could not be loaded.'); });
    return () => { cancelled = true; };
  }, [vehicleId, attempt]);
  if (refusal) return <div role="alert"><Text role="body">Work plan unavailable: {refusal}</Text>
    <button type="button" className="btn-base btn-sm btn-secondary" onClick={() => setAttempt(value => value + 1)}>Retry work plan</button></div>;
  if (!plan) return <p role="status">Reading the listing…</p>;
  return <WorkPlanView vehicleId={vehicleId} plan={plan} signedIn={signedIn} />;
}
