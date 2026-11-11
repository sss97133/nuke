import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuctionAcquisition } from './useAuctionAcquisition';
import { supabase } from '../../lib/supabase';
import { PrefetchLink } from '../../components/PrefetchLink';
import { OrgLogo } from '../../components/common/OrgLogo';
import { auctionAcquisitionState, type AcquisitionEpisode } from './auctionAcquisitionState';
import './VehicleAcquisitionStage.css';
const BuyerMarketEvidence = lazy(() => import('../../components/market/BuyerMarketEvidence'));
const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function SourceStage({ event, vehicleId, year, make, model, now }: {
  event: AcquisitionEpisode; vehicleId: string; year: number | null; make: string; model: string; now: number;
}) {
  const [inspect, setInspect] = useState(false);
  const state = auctionAcquisitionState(event, now)!;
  const organization = useQuery({ queryKey: ['auction-source-organization', event.source_organization_id], enabled: !!event.source_organization_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('businesses').select('id,business_name,logo_url')
        .eq('id', event.source_organization_id!).maybeSingle();
      if (error) throw error;
      return data;
    }, staleTime: 30 * 60_000, retry: false });
  const stale = !state.observedAt || !Number.isFinite(Date.parse(state.observedAt)) || now - Date.parse(state.observedAt) > 3_600_000 || Date.parse(state.observedAt) > now;
  return <section id={`acquisition-${event.id}`} className="vehicle-acquisition-stage" aria-label={`${state.house} auction state`}>
    <div className="vehicle-acquisition-stage__heading">
      <OrgLogo logoUrl={organization.data?.logo_url} businessName={organization.data?.business_name ?? state.house} businessType="auction_house" size={32} variant="logo" />
      <div><strong>{state.house}</strong><h2>{state.stage}</h2></div>
      {state.timer && <strong className="vehicle-acquisition-stage__timer">{state.timer}</strong>}
    </div>
    <p>{state.name}{state.lot ? ` · Lot ${state.lot}` : ''}{state.runOn.length ? ` · Scheduled ${state.runOn.map(date).join(', ')}`
      : state.scheduled ? ` · ${date(state.scheduled.startsOn)} – ${date(state.scheduled.endsOn)}` : ' · Schedule unconfirmed'}</p>
    {state.location && <p>{state.location}</p>}
    <p>Seller represented for this auction by {organization.data?.business_name ?? state.house}. Owner identity and title still need verification.</p>
    <p className="vehicle-acquisition-stage__note">{state.observedAt && Number.isFinite(Date.parse(state.observedAt)) ? `Source checked ${new Date(state.observedAt).toLocaleString()}. ` : 'Source check time unknown. '}
      {stale ? 'Availability needs a fresh source check. ' : ''}Schedule is day precision; exact lot time is unconfirmed. Passing the date does not establish a sale.</p>
    <div className="vehicle-acquisition-stage__actions">
      <button type="button" aria-expanded={inspect} aria-controls={`buyer-evidence-${event.id}`} onClick={() => setInspect(value => !value)}> {inspect ? 'Close market evidence' : 'Assess this acquisition'}</button>
      {event.source_organization_id && <PrefetchLink to={`/org/${event.source_organization_id}#source-inventory`}>Other cars at this auctioneer →</PrefetchLink>}
    </div>
    <div id={`buyer-evidence-${event.id}`}>{inspect && <Suspense fallback={<p role="status">Opening market evidence…</p>}>
      <BuyerMarketEvidence year={year} make={make} model={model} vehicleId={vehicleId} />
    </Suspense>}</div>
    {event.source_platform === 'mccormicks' && <details><summary>Prepare to bid at McCormick’s</summary>
      <p>Publisher information checked November 11, 2026; confirm current terms for this sale before registering.</p>
      <ul><li>Bidder registration is required. The registration page lists a $30 regular registration including a guest, in-person bidding, and documents to sign on arrival.</li>
        <li>The buyer information page lists a 6% auction buy fee. Tax, title, transport and repairs need a separate allowance; this is not an all-in quote.</li>
        <li>A bank letter of guarantee is required if paying by check. The bidder documents page explains the requirement.</li></ul>
      <p><a href="https://www.classic-carauction.com/Buyer-Registration" target="_blank" rel="noopener noreferrer">Registration requirements ↗</a>{' · '}
        <a href="https://www.classic-carauction.com/Buyer-General-Info" target="_blank" rel="noopener noreferrer">Published buyer fee and payment information ↗</a>{' · '}
        <a href="https://www.classic-carauction.com/Buyer-Documents" target="_blank" rel="noopener noreferrer">Bidder documents ↗</a></p>
    </details>}
    <details><summary>Sources</summary><a href={state.sourceUrl} target="_blank" rel="noopener noreferrer">Original {state.house} lot ↗</a></details>
  </section>;
}

export default function VehicleAcquisitionStage({ vehicleId, year, make, model }: {
  vehicleId: string; year: number | null; make: string; model: string;
}) {
  const { episodes, now, isError, refetch } = useAuctionAcquisition(vehicleId);
  return <>{isError && <p role="status">Auction state could not be refreshed. <button type="button" onClick={() => void refetch()}>Retry auction state</button></p>}
    {episodes.map(({ event }) => <SourceStage key={`${vehicleId}:${event.id}`} event={event} vehicleId={vehicleId} year={year} make={make} model={model} now={now} />)}</>;
}
