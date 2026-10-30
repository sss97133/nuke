import React, { useEffect, useState } from 'react';
import { PrefetchLink } from '../../components/PrefetchLink';
import { Text } from '../../kit';
import { day, JobReaders, type RetainedWorkRead } from './jobsReaders';
import { retainedWorkPlan, workExcerpt, type WorkComponent, type WorkContext, type WorkProof } from './workEvidenceModel';

type Props = { vehicleId: string; reports: NonNullable<RetainedWorkRead['responsibility_reports']> };
function useWorkContext({ vehicleId, reports }: Props) {
  const [context, setContext] = useState<WorkContext | null>(null);
  const signature = JSON.stringify(reports.map(r => [r.source_observation_id, r.client_label]));
  useEffect(() => {
    let active = true;
    setContext(null);
    void JobReaders.workContext(vehicleId, reports).then(data => { if (active) setContext(data); })
      .catch(() => { if (active) setContext({ vehicleId, proofs: [], decisions: [], handoffs: [], partial: false,
        errors: ['Build evidence could not be read.'] }); });
    return () => { active = false; };
    // The signature represents every report value used by this read. No shared private cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, signature]);
  return context;
}

const PROOF_WORDS: Record<string, string> = {
  bought: 'Purchase recorded', on_hand: 'Seen on hand', in_hand: 'Seen on hand',
  mounted: 'Shown mounted', installed: 'Installation reported', not_installed: 'Not installed in the record',
  on_truck: 'Seen on the truck', not_on_truck: 'Not on the truck in the record',
  lined_up: 'Vendor option', answered: 'Source question answered', withdrawn: 'Earlier reading withdrawn',
};
function ProofSource({ proof }: { proof: WorkProof }) {
  const photo = proof.photo_url && /^https:\/\//.test(proof.photo_url) ? proof.photo_url : null;
  return <div className="work-proof">
    <Text role="caption" as="p">{PROOF_WORDS[proof.level ?? ''] ?? 'Source report'}
      {(proof.event_date || proof.observed_at) ? ` · ${day(proof.event_date || proof.observed_at)}` : ''}</Text>
    {proof.description && <Text role="body" as="p">{workExcerpt(proof.description)}</Text>}
    <div className="work-source">
      {photo && <a href={photo} target="_blank" rel="noopener noreferrer">View source photo{proof.photo_at ? ` · ${day(proof.photo_at)}` : ''} ↗</a>}
      <Text role="caption" as="p">Recorded {day(proof.ingested_at)} · observation {proof.id}</Text>
    </div>
  </div>;
}
function ComponentRows({ rows }: { rows: WorkComponent[] }) {
  return <ul className="work-items">{rows.map(row => {
    const lead = row.reports.find(p => ['not_installed', 'not_on_truck'].includes(p.level ?? ''))
      ?? row.reports.find(p => !['lined_up', 'withdrawn', 'answered'].includes(p.level ?? '')) ?? row.reports[0];
    return <li key={row.code}>
    <div className="work-item__head"><Text role="entity" dense as="h3">{workExcerpt(row.name).replace(/_/g, ' ')}</Text>
      {row.disagreement && <Text role="caption">Records disagree about installation</Text>}</div>
    <Text role="body" as="p">{[...(row.wiringGap ? ['Not wired in source'] : []), ...new Set(row.reports.map(p => PROOF_WORDS[p.level ?? ''] ?? 'Source report'))].join(' · ')}</Text>
    {lead?.observed_at && <Text role="caption" as="p">Report dated {day(lead.observed_at)}{lead.photo_at ? ` · photo ${day(lead.photo_at)}` : ''}</Text>}
    <details className="work-source"><summary>Evidence & dates</summary>
      {row.reports.map(proof => <ProofSource key={proof.id} proof={proof} />)}
    </details>
  </li>;
  })}</ul>;
}

export function WorkPlanPreview({ vehicleId, reports, href }: Props & { href: string }) {
  const context = useWorkContext({ vehicleId, reports });
  const plan = context && retainedWorkPlan(context);
  const first = plan?.open[0];
  const remaining = plan?.remaining[0];
  return <div className="work-preview">
    {first && <Text role="body" as="p">Open work: {workExcerpt(first.subject)}</Text>}
    {remaining && <Text role="body" as="p">{workExcerpt(remaining.name).replace(/_/g, ' ')} · {remaining.wiringGap ? 'wiring' : 'installation'} remaining in the last record</Text>}
    {context?.errors.length ? <Text role="caption" as="p">Some build evidence is unavailable.</Text> : null}
    <PrefetchLink to={href}>Open work & parts →</PrefetchLink>
  </div>;
}

export function RetainedWorkPlan(props: Props) {
  const context = useWorkContext(props);
  if (!context) return <Text role="caption" as="p" aria-live="polite">Reading build evidence…</Text>;
  const plan = retainedWorkPlan(context);
  const hasEvidence = context.proofs.length > 0 || context.decisions.length > 0 || context.handoffs.length > 0;
  return <div id="work-plan" className="work-plan">
    <section className="k-section" aria-label="Work to finish"><Text role="entity" as="h2">Work to finish</Text>
      <Text role="caption" as="p">Wiring plan and retained component evidence</Text>
      {plan.open.length > 0 && <ul className="work-items">{plan.open.map(call => <li key={call.id}>
        <Text role="entity" dense as="h3">{workExcerpt(call.subject)}</Text>
        <Text role="caption" as="p">{call.work_status === 'blocked' ? 'Recorded blocker' : 'Open in the build plan'}</Text>
        {call.source && <details className="work-source"><summary>Decision source</summary>
          <Text role="body" as="p">{workExcerpt(call.source)}</Text><Text role="caption" as="p">Decision {call.id}</Text>
        </details>}
      </li>)}</ul>}
      {plan.remaining.length > 0 && <ComponentRows rows={plan.remaining} />}
      {!plan.open.length && !plan.remaining.length && <Text role="body" as="p">{hasEvidence
        ? context.partial ? 'This read is incomplete; it cannot establish the remaining work.' : 'No remaining operation is identified by this set of records.'
        : 'Work evidence has not been connected to this view yet.'}</Text>}
      <Text role="caption" as="p">Dated build evidence; completion and delivery still need their own records.</Text>
      {hasEvidence && <PrefetchLink className="work-open" to={`/vehicle/${props.vehicleId}/wiring`}>Open wiring workspace →</PrefetchLink>}
    </section>

    {plan.available.length > 0 && <details className="work-group" open><summary>Bought, on hand or mounted</summary>
      <Text role="caption" as="p">Purchase, presence and installation are separate. Each entry keeps what its source actually says.</Text>
      <ComponentRows rows={plan.available} />
    </details>}
    {plan.options.length > 0 && <details className="work-group"><summary>Vendor options</summary>
      <Text role="caption" as="p">Saved options for the vehicle. These are not purchase orders or missing-work commitments.</Text>
      <ComponentRows rows={plan.options} />
    </details>}
    {plan.settled.length > 0 && <details className="work-group"><summary>Decisions already made</summary>
      <ul className="work-items">{plan.settled.map(call => <li key={call.id}>
        <Text role="label" as="h3">{workExcerpt(call.subject)}</Text>
        {call.chosen && <Text role="body" as="p">{workExcerpt(call.chosen)}</Text>}
        <Text role="caption" as="p">{call.decided_on ? `${day(call.decided_on)} · ` : ''}{workExcerpt(call.source)} · decision {call.id}</Text>
      </li>)}</ul>
    </details>}
    {context.handoffs.length > 0 && <details className="work-group"><summary>Earlier handoffs</summary>
      <Text role="caption" as="p">These are dated reports from the same vehicle and reporting source naming this client. Later decisions above may resolve their questions.</Text>
      {context.handoffs.map(handoff => <div className="work-handoff" key={handoff.id}>
        <Text role="label" as="h3">{day(handoff.observed_at)} · {workExcerpt(handoff.gate)}</Text>
        {handoff.next_action && <Text role="body" as="p">Next action in that handoff: {workExcerpt(handoff.next_action)}</Text>}
        {handoff.blocked_on.length > 0 && <><Text role="caption" as="p">Questions in that handoff</Text>
          <ul>{handoff.blocked_on.map((question, index) => <li key={index}>{workExcerpt(question)}</li>)}</ul></>}
        <Text role="caption" as="p">Observation {handoff.id} · recorded {day(handoff.ingested_at)}</Text>
      </div>)}
    </details>}
    {plan.candidates.length > 0 && <details className="work-group"><summary>Optional scope</summary>
      <Text role="caption" as="p">Candidate options remain separate from the work owed.</Text>
      <ul className="work-items">{plan.candidates.map(call => <li key={call.id}>{workExcerpt(call.subject)}</li>)}</ul>
    </details>}
    {plan.corrections.length > 0 && <details className="work-group"><summary>Corrections to earlier readings</summary><ComponentRows rows={plan.corrections} /></details>}
    {context.errors.map(error => <Text key={error} role="body" as="p" aria-live="polite">{error}</Text>)}
    {context.partial && <Text role="caption" as="p">This view reached its source limit. Open the wiring workspace for the wider build record.</Text>}
    {hasEvidence && <Text role="caption" as="p">Vehicle build history supports this job; these records do not allocate costs or labor to it.</Text>}
  </div>;
}
