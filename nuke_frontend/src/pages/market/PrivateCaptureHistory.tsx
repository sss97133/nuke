import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { facebookListingUrl, validListingHistory } from '../../components/admin/FacebookListingHistory';
import { sourceLink } from './useCapturedListings';

export async function readPrivateCaptureHistory(principal: string, signal: AbortSignal) {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (session?.user.id !== principal || !session.access_token || signal.aborted) throw new Error('Private capture session unavailable');
  const { data: reading, error } = await supabase.functions.invoke('db-stats?intake=listing_history', {
    method: 'GET', headers: { Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (error || signal.aborted || !validListingHistory(reading)) throw new Error('Private captures unavailable');
  return reading;
}

function captureSurface(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.port && !url.search && !url.hash
      && (url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com')) && url.pathname.startsWith('/marketplace/') ? url.href : null;
  } catch { return null; }
}

function PrivateHistory({ principal }: { principal: string }) {
  const client = useQueryClient();
  const key = ['market-private-capture-history', principal];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => readPrivateCaptureHistory(principal, signal), staleTime: 60_000, retry: false });
  useEffect(() => () => {
    // Private payloads never survive logout, principal changes or leaving this view.
    void client.cancelQueries({ queryKey: ['market-private-capture-history', principal], exact: true });
    client.removeQueries({ queryKey: ['market-private-capture-history', principal], exact: true });
  }, [client, principal]);
  const reading = query.data;
  return <section aria-label="Private Facebook captures" style={{ padding: '0 12px', marginTop: 16 }}>
    <h2>Facebook captures · private</h2>
    <p>Your permitted captured history: preceding 24 hours, at most 100 capture runs and 20 listing histories. This is a bounded view, not full Facebook inventory.</p>
    {query.isPending && <p role="status">Reading captured history…</p>}
    {query.isError && <p role="status">Private history could not be refreshed. {reading ? 'Showing the last fetched private history.' : ''} <button onClick={() => void query.refetch()}>Retry</button></p>}
    {reading && <>
      <p>Observed {new Date(reading.scope.event_from).toLocaleString()}–{new Date(reading.scope.event_before).toLocaleString()}. {reading.capture_window_complete ? 'Selected capture window complete.' : 'Capture window partial.'} Availability between observations is unobserved.</p>
      {!reading.rows.length && <p role="status">No histories in this selected capture window.</p>}
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
        <thead><tr><th scope="col">Listing</th><th scope="col">Last observed asking amount</th><th scope="col">Observed history</th></tr></thead>
        <tbody>{reading.rows.map(history => {
          const latest = history.observations.at(-1);
          const observedLink = sourceLink('facebook_marketplace', latest?.actual_url ?? null);
          const observedId = observedLink && new URL(observedLink).pathname.match(/^\/marketplace\/item\/(\d+)\/?$/)?.[1];
          const href = observedId === history.facebook_id ? observedLink : facebookListingUrl(history.facebook_id);
          return <tr key={history.listing_id} style={{ borderTop: '2px solid var(--border)' }}>
            <td style={{ padding: '8px 0' }}>{history.title || 'Listing title unrecorded'}<div>{history.current_vehicle_id ? 'Vehicle link retained; identity not verified here' : 'Vehicle unresolved'}</div>
              {href ? <a href={href} target="_blank" rel="noopener noreferrer">Facebook listing</a> : <span>Source link unavailable</span>}</td>
            <td>{latest?.asking_amount == null ? 'Unrecorded' : `${latest.asking_amount.toLocaleString()} ${latest.asking_currency || '· currency unrecorded'}`}</td>
            <td><details><summary>{history.observation_count === 1 ? 'First observation in window' : `${history.observation_count} observations in window`} · {history.observed_asking_changes} observed asking changes</summary>
              <div>Source ID {history.facebook_id}</div>
              <ol>{history.observations.map(observation => <li key={observation.sighting_id}>
                {new Date(observation.observed_at).toLocaleString()} · {observation.detail_observation ? 'Detail observation' : 'Search sighting'} · {observation.asking_amount === null ? 'Ask unrecorded' : `${observation.asking_amount.toLocaleString()} ${observation.asking_currency || 'currency unrecorded'}`}
                <div>{observation.source_scope_complete === true ? 'Declared complete capture' : 'Partial or undeclared capture scope'}</div>
                <div>{captureSurface(observation.actual_url) ? <a href={captureSurface(observation.actual_url)!} target="_blank" rel="noopener noreferrer">Capture surface</a> : 'Capture surface unavailable here'}</div>
                <div>Known by capture completion {new Date(observation.known_by).toLocaleString()}</div>
              </li>)}</ol>
            </details></td>
          </tr>;
        })}</tbody>
      </table></div>
      <button onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh captured history</button>
    </>}
  </section>;
}

export default function PrivateCaptureHistory({ source }: { source: string }) {
  const { user } = useAuth();
  const access = useAdminAccess();
  if (!user || access.loading || !access.isAdmin || !['', 'classifieds', 'facebook_marketplace'].includes(source)) return null;
  return <PrivateHistory key={user.id} principal={user.id} />;
}
