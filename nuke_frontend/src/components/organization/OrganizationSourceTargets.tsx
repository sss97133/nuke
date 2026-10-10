import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Target = { listing_url: string; first_discovered_at: string | null; last_seen_at: string | null };
type Source = { source_slug: string; display_name: string; total_targets: number; targets: Target[] };
type Reading = { contract: string; organization_id: string; status: string; measured_at: string; complete: boolean; rows: Source[] };
const safeUrl = (value: string) => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unmeasured';
const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left' as const };

export default function OrganizationSourceTargets({ organizationId }: { organizationId: string }) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(`db-stats?organization_targets=${encodeURIComponent(organizationId)}`,
          { method: 'GET', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) });
        if (error || data?.contract !== 'organization_targets_v1' || data.organization_id !== organizationId
          || data.status !== 'measured' || !Number.isFinite(Date.parse(data.measured_at)) || typeof data.complete !== 'boolean'
          || !Array.isArray(data.rows) || data.rows.length > 30 || !data.rows.every((s: Source) => s
            && typeof s.source_slug === 'string' && typeof s.display_name === 'string'
            && Number.isSafeInteger(s.total_targets) && s.total_targets >= 0
            && Array.isArray(s.targets) && s.targets.length <= 25 && s.targets.length <= s.total_targets
            && s.targets.every(t => t && typeof t.listing_url === 'string' && safeUrl(t.listing_url)))) throw new Error('unavailable');
        if (!cancelled) setReading(data);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [organizationId]);

  useEffect(() => {
    if (reading && window.location.hash === '#source-targets') document.getElementById('source-targets')?.scrollIntoView?.();
  }, [reading]);

  const sources = reading?.rows.filter(s => s.total_targets > 0) ?? [];
  if (failed) return <p id="source-targets" role="status">Source target inventory unavailable.</p>;
  if (!reading || sources.length === 0) return null;
  return <section id="source-targets" aria-labelledby="source-targets-heading"
    style={{ border: '2px solid var(--border)', padding: 12, marginBottom: 16, fontSize: 11 }}>
    <h3 id="source-targets-heading" style={{ fontSize: 11 }}>KNOWN SOURCE TARGETS</h3>
    <p>Read {date(reading.measured_at)}. Known listing URLs from source sitemaps; discovery does not prove extraction, a verified vehicle or a sale.</p>
    {!reading.complete && <p>First 30 source keys only.</p>}
    {sources.map(source => <div key={source.source_slug}>
      <p><strong>{source.display_name}</strong> · {source.total_targets.toLocaleString()} known target URLs</p>
      <details>
        <summary>View {source.targets.length} retained target URLs · bounded sample, unranked</summary>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Source listing', 'First discovered', 'Last seen in inventory'].map(label => <th key={label} scope="col" style={cell}>{label}</th>)}</tr></thead>
          <tbody>{source.targets.map(target => <tr key={target.listing_url}>
            <td style={{ ...cell, overflowWrap: 'anywhere' }}><a href={target.listing_url} target="_blank" rel="noopener noreferrer">{target.listing_url}</a></td>
            <td style={cell}>{date(target.first_discovered_at)}</td><td style={cell}>{date(target.last_seen_at)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </div>)}
  </section>;
}
