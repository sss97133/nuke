import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readArea, readAreas, platformName } from './oneMapService';
import { activityWindow, qualifyZipActivity } from './zipActivity';

function asOfLabel(value: string) {
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'time unavailable';
}

/** A compact public map_facts read. Browse rows are a separate, broader population. */
export function ZipAreaActivity({ zip }: { zip: string }) {
  const [days, setDays] = useState<30 | 365>(365);
  const window = activityWindow(days);
  const read = useQuery({
    queryKey: ['zip-area-activity', zip, window.from, window.to],
    enabled: /^\d{5}$/.test(zip),
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const [area, sources] = await Promise.all([
        readArea('zcta', zip, window.from, window.to, signal),
        readAreas('zcta', 'listing', window.from, window.to, [zip], signal).catch(() => null),
      ]);
      return qualifyZipActivity(zip, window, area, sources);
    },
  });

  return <section className="zip-area-activity" aria-label={`Recorded activity in ZCTA ${zip}`}>
    <div className="zip-area-activity__heading"><h3>Recorded activity</h3>
      <select aria-label="Activity period" value={days} onChange={event => setDays(Number(event.target.value) === 30 ? 30 : 365)}>
        <option value={30}>30 days</option><option value={365}>365 days</option>
      </select>
    </div>
    {read.isPending && <p role="status">Reading area activity…</p>}
    {read.isError && <p role="status">Area activity is unavailable.</p>}
    {read.data && <>
      <p><strong>{read.data.listings?.entities ?? '—'}</strong> first-seen listings
        {read.data.listings && <span className="zip-area-activity__muted"> · {read.data.listings.priced} with asking amounts</span>}</p>
      <p><strong>{read.data.sales?.entities ?? '—'}</strong> recorded sold events</p>
      <details><summary>Sources and coverage</summary>
        {read.data.sources ? <ul>{read.data.sources.map(source =>
          <li key={source.source}>{platformName(source.source)} · {source.entities}</li>)}</ul>
          : <p>Listing source breakdown unavailable.</p>}
        <p>Listing fold: {read.data.listings ? asOfLabel(read.data.listings.asOf) : 'unavailable'}.
          {' '}Sale fold: {read.data.sales ? asOfLabel(read.data.sales.asOf) : 'unavailable'}.</p>
        <p>Captured public records in this ZCTA. First-seen listings are activity, not current inventory.</p>
        <p><a href={`/map?layer=listing&window=${days}`}>Browse the public map</a> · search {zip}; its record list spans more dates than this count.</p>
      </details>
    </>}
  </section>;
}
