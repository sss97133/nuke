export type SourceKind = 'craigslist' | 'dealer_site' | 'ksl' | 'bat' | 'classic' | 'user' | 'unknown';

export const SOURCE_META: Record<string, { title: string; domain: string }> = {
  craigslist: { title: 'Craigslist', domain: 'craigslist.org' },
  ksl: { title: 'KSL', domain: 'ksl.com' },
  bat: { title: 'Bring a Trailer', domain: 'bringatrailer.com' },
  classic: { title: 'Classic.com', domain: 'classic.com' },
  dealer_site: { title: 'Dealer Sites', domain: 'autotrader.com' },
};

/** Detect strings that are HTTP error text stored as source name/domain (e.g. from failed scrapes). */
export function looksLikeHttpError(nameOrDomain: string): boolean {
  if (!nameOrDomain || typeof nameOrDomain !== 'string') return true;
  const s = nameOrDomain.toLowerCase().trim();
  if (/^\d{3}\s/.test(s)) return true;
  if (/\b(404|500|502|503)\b/.test(s)) return true;
  if (/not found|page not found|file or directory not found/i.test(s)) return true;
  if (/internal server error|server error|bad gateway|service unavailable/i.test(s)) return true;
  if (/^error\b|^undefined$|^null$/i.test(s)) return true;
  return false;
}

export const normalizeHost = (url: string | null | undefined): string => {
  try {
    if (!url) return '';
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    const s = String(url || '').trim().toLowerCase();
    const m = s.match(/^(?:https?:\/\/)?([^/]+)/i);
    return (m?.[1] || '').replace(/^www\./, '').toLowerCase();
  }
};

export const normalizeAlias = (value: string | null | undefined): string => {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
};

export const stripTld = (host: string): string => {
  const parts = String(host || '').split('.');
  if (parts.length <= 1) return host;
  return parts.slice(0, -1).join('.');
};

export const classifySource = (v: any): SourceKind => {
  const origin = String(v?.profile_origin || '').trim().toLowerCase();
  const discoverySource = String(v?.discovery_source || '').trim().toLowerCase();
  const discoveryUrl = String(v?.discovery_url || '').trim().toLowerCase();
  const host = normalizeHost(v?.discovery_url || null);

  if (origin === 'craigslist_scrape' || host.includes('craigslist.org') || discoveryUrl.includes('craigslist.org') || discoverySource.includes('craigslist')) {
    return 'craigslist';
  }
  if (origin === 'ksl_import' || host === 'ksl.com' || host.endsWith('.ksl.com') || discoveryUrl.includes('ksl.com') || discoverySource.includes('ksl')) {
    return 'ksl';
  }
  if (origin === 'bat_import' || host.includes('bringatrailer.com') || discoveryUrl.includes('bringatrailer.com/listing') || discoverySource.includes('bat')) {
    return 'bat';
  }
  if (origin === 'classic_com_indexing' || host === 'classic.com' || host.endsWith('.classic.com') || discoveryUrl.includes('classic.com') || discoverySource.includes('classic')) {
    return 'classic';
  }
  if (discoveryUrl.includes('mecum.com') || discoverySource.includes('mecum')) {
    return 'dealer_site';
  }
  if (origin === 'url_scraper' || origin === 'organization_import' || origin.includes('dealer')) {
    return 'dealer_site';
  }
  if (origin.includes('import')) {
    return 'dealer_site';
  }
  if (!origin || origin === 'user_upload' || origin === 'user_uploaded' || origin === 'manual' || origin === 'manual_entry' || origin === 'user_import') {
    return 'user';
  }
  return 'unknown';
};
