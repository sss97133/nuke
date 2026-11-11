import type { SaleComparisonOptions } from './batComps';

export function canonicalBatSource(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value), slug = /^\/listing\/([a-z0-9-]+)\/?$/i.exec(url.pathname)?.[1];
    return ['http:', 'https:'].includes(url.protocol) && /^(www\.)?bringatrailer\.com$/i.test(url.hostname)
      && !url.username && !url.password && !url.port && slug ? `https://bringatrailer.com/listing/${slug.toLowerCase()}/` : null;
  } catch { return null; }
}

/** Shared with the detailed valuation page. A physical car's earlier episodes
 * remain usable when the current source episode is excluded or unestablished. */
export function saleReceiptSubject(requested: string | null, receipt: {
  sale_population_basis?: string;
  subject?: { vehicle_id: string | null; source_key: string | null; source_url: string | null; exclusion_basis: string };
}): Pick<SaleComparisonOptions['subject'], 'vehicleId' | 'sourceUrl' | 'exclusionBasis'> {
  if (!requested || receipt.sale_population_basis !== 'source_qualified_episodes_of_current_public_members') return { vehicleId: requested };
  const subject = receipt.subject, source = canonicalBatSource(subject?.source_url ?? null);
  if (/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requested) && subject?.vehicle_id === requested
    && subject.exclusion_basis === 'exact_source_episode' && source === subject.source_url
    && subject.source_key === source?.replace('https://', '').replace(/\/$/, '')) {
    return { vehicleId: requested, sourceUrl: source, exclusionBasis: 'exact_source_episode' };
  }
  return { vehicleId: requested, exclusionBasis: 'unestablished' };
}
