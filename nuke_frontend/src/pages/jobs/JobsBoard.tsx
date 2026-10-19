/**
 * JobsBoard — /jobs: open requests on Nuke (open_requirements_read).
 *
 * Each row: what is needed, the job, the vehicle, the area band, any window and the quote state.
 * A signed-in viewer also sees how their record lines up, input by input, in plain words: no score,
 * and a missing tool or shop space means a backup supplier is needed, not a rejection. "Make an
 * offer" appears only where the job's offers reader (work_order_offers_read) gives this account an
 * offer action; "Contact via Nuke" only where the reader says contact is available.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { useAuthContext } from '../../contexts/AuthContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { ContactSheet, OfferSheet } from './JobSheets';
import { MatchList, PlanBList } from './MatchList';
import {
  JobReaders, areaText, jobHref, openRequestsSentence, quoteText, requirementKind, vehicleText, windowText,
  type JobAction, type OpenRequirement, type OpenRequirementsRead,
} from './jobsReaders';
import './jobs.css';

/** Below this many open requests the board explains how requests get here. */
const FEW_REQUESTS = 10;

/** How jobs reach this board, for a board with few requests. */
function HowJobsAppear({ signedIn }: { signedIn: boolean }) {
  return <section className="k-section" aria-label="How jobs appear here">
    <Text role="label" as="h2">How jobs appear here</Text>
    <ol className="jb-ol">
      <li><Text role="body">An owner posts a job from their vehicle's page: <Text role="label">Post a job</Text>, in their own words.</Text></li>
      <li><Text role="body">A buyer orders a pre-purchase inspection from a listing: <Text role="label">Plan the work</Text>, then <Text role="label">Order an inspection</Text>.</Text></li>
    </ol>
    <Text role="body">Each request lists what it needs; technicians, inspectors, tool owners and shops offer, and the customer chooses.</Text>
    <Text role="body">{signedIn
      ? <>Own a vehicle that needs work? <PrefetchLink to="/vehicle/list">Post a job from one of your vehicles</PrefetchLink>.</>
      : <>Own a vehicle that needs work? <PrefetchLink to="/login">Sign in</PrefetchLink> and post a job from its page.</>}</Text>
    <Text role="caption">Shops that run their work orders on Nuke list what a job needs here too.</Text>
  </section>;
}

function RequirementRow({ row, offer, canContact, onOffer, onContact }: {
  row: OpenRequirement; offer: JobAction | null; canContact: boolean; onOffer: () => void; onContact: () => void;
}) {
  const detail = [vehicleText(row.vehicle_label), areaText(row.area_band), windowText(row.window), quoteText(row.quote_state), row.request_source_label]
    .filter(Boolean).join(' · ');
  const listed = row.candidates_listed ?? 0;
  return <li className="jb-row" aria-label={`${requirementKind(row.requirement_kind)} request`}>
    <div className="jb-row__head">
      <Text role="label">{requirementKind(row.requirement_kind)}</Text>
      <Text role="caption">{listed === 1 ? '1 candidate listed' : `${listed} candidates listed`}</Text>
    </div>
    <Text role="body">{row.description || 'No description'}</Text>
    <PrefetchLink to={jobHref(row.work_order_id)}><Text role="entity" dense>{row.display_title || 'Untitled job'}</Text></PrefetchLink>
    {detail && <Text role="caption">{detail}</Text>}
    {row.match && row.match.length > 0 && <MatchList inputs={row.match} />}
    {row.plan_b_suppliers && row.plan_b_suppliers.length > 0 && <PlanBList suppliers={row.plan_b_suppliers} />}
    {(offer || canContact) && <div className="jb-actions">
      {offer && <button type="button" className="btn-base btn-sm btn-primary" onClick={onOffer}><Text role="label">Make an offer</Text></button>}
      {canContact && <button type="button" className="btn-base btn-sm btn-secondary" onClick={onContact}><Text role="label">Contact via Nuke</Text></button>}
    </div>}
  </li>;
}

const JobsBoard: React.FC = () => {
  usePageTitle('Jobs looking for someone');
  const { session } = useAuthContext();
  const signedIn = !!session?.user?.id;
  const [page, setPage] = useState<OpenRequirementsRead | null>(null);
  const [rows, setRows] = useState<OpenRequirement[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [offers, setOffers] = useState<Record<string, JobAction>>({});
  const [offering, setOffering] = useState<OpenRequirement | null>(null);
  const [contacting, setContacting] = useState<OpenRequirement | null>(null);

  const loadOffers = useCallback(async (list: OpenRequirement[]) => {
    if (!signedIn) return;
    const ids = Array.from(new Set(list.map(r => r.work_order_id)));
    const found: Record<string, JobAction> = {};
    await Promise.all(ids.map(async id => {
      const r = await JobReaders.offers(id);
      for (const a of r.data?.viewer?.actions ?? []) {
        const rid = a.args?.p_requirement_id;
        if (a.action === 'offer' && typeof rid === 'string') found[rid] = a;
      }
    }));
    setOffers(prev => ({ ...prev, ...found }));
  }, [signedIn]);

  const load = useCallback(async (after: string | null) => {
    const r = await JobReaders.openRequirements(after);
    if (r.refusal) { setRefusal(r.refusal.message); return; }
    setRefusal(null);
    setPage(r.data);
    setRows(prev => (after ? [...prev, ...r.data.rows] : r.data.rows));
    void loadOffers(r.data.rows);
  }, [loadOffers]);

  useEffect(() => { void load(null); }, [load]);

  const total = page?.coverage.total_open ?? 0;
  return <main className="jb-page jb-scope">
    <div className="jb-intro">
      <Text role="entity" as="h1">Jobs looking for someone</Text>
      {page && <Text role="body">{openRequestsSentence(total)}.</Text>}
      {page && <Text role="caption">{signedIn
        ? "How your record lines up, item by item. There's no score, and nothing rules you out."
        : <>Sign in to see how your record lines up. <PrefetchLink to="/login">Sign in</PrefetchLink></>}</Text>}
    </div>
    {refusal && <Text role="body" className="jb-warn">{refusal}</Text>}
    {page && <Section title="Open requests" coverage={{ n: rows.length, of: total, grain: 'open requests shown', as_of: page.as_of }}>
      {rows.length === 0
        ? <Text role="body">No open requests right now.</Text>
        : <ul className="jb-list">{rows.map(row => <RequirementRow key={row.requirement_id} row={row}
            offer={offers[row.requirement_id] ?? null} canContact={!!page.contact?.available}
            onOffer={() => setOffering(row)} onContact={() => setContacting(row)} />)}</ul>}
      {page.next_after && <div className="jb-more"><button type="button" className="btn-base btn-sm btn-secondary" onClick={() => void load(page.next_after)}>
        <Text role="label">More requests</Text></button></div>}
      {page.coverage.not_assessed && page.coverage.not_assessed.length > 0 &&
        <Text role="caption">Not assessed yet: {page.coverage.not_assessed.join(', ')}.</Text>}
    </Section>}
    {page && total < FEW_REQUESTS && <HowJobsAppear signedIn={signedIn} />}
    {offering && offers[offering.requirement_id] && <OfferSheet action={offers[offering.requirement_id]}
      requestTitle={offering.description || requirementKind(offering.requirement_kind)} onClose={() => setOffering(null)} />}
    {contacting && <ContactSheet requirementId={contacting.requirement_id}
      contextLabel={`${requirementKind(contacting.requirement_kind)} on ${contacting.display_title || 'this job'}`} onClose={() => setContacting(null)} />}
  </main>;
};

export default JobsBoard;
