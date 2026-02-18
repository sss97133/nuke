/**
 * Custom hook: manages source state, classification, inclusion logic, and UI helpers.
 * Loads active sources from DB, computes inclusion/exclusion, builds sourcePogs for display.
 * Extracted from CursorHomepage to reduce file size.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { classifySource, normalizeHost, normalizeAlias, stripTld, looksLikeHttpError, SOURCE_META } from '../lib/sourceClassification';
import type { FilterState } from '../types/feedTypes';

export interface ActiveSource {
  id: string;
  domain: string;
  source_name: string;
  url: string;
}

export interface SourcePog {
  key: string;
  domain: string;
  title: string;
  included: boolean;
  id: string;
  url: string;
  count: number;
}

interface UseFeedSourcesParams {
  filters: FilterState;
  isMissingListingKindColumn: (err: any) => boolean;
  listingKindSupportedRef: React.MutableRefObject<boolean>;
}

export function useFeedSources({ filters, isMissingListingKindColumn, listingKindSupportedRef }: UseFeedSourcesParams) {
  const [activeSources, setActiveSources] = useState<ActiveSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});

  // Map domain to filter key for backward compatibility
  const domainToFilterKey = useCallback((domain: string): string => {
    const host = normalizeHost(domain);
    if (!host) return '';
    if (host === 'craigslist.org' || host.endsWith('.craigslist.org')) return 'craigslist';
    if (host === 'ksl.com' || host.endsWith('.ksl.com')) return 'ksl';
    if (host === 'autotrader.com' || host.endsWith('.autotrader.com')) return 'dealer_site';
    if (host === 'bringatrailer.com' || host.endsWith('.bringatrailer.com')) return 'bat';
    if (host === 'classic.com' || host.endsWith('.classic.com')) return 'classic';
    return host.replace(/[^a-z0-9]/g, '_');
  }, []);

  const includedSources = useMemo(() => {
    if (!filters) return {};

    const base: Record<string, boolean> = {};
    const hiddenSourcesSet = new Set(filters.hiddenSources || []);

    const knownSourceTypes = ['craigslist', 'ksl', 'dealer_site', 'bat', 'classic', 'user', 'unknown'];

    knownSourceTypes.forEach(key => {
      if (key === 'craigslist') {
        base[key] = !filters.hideDealerListings && !filters.hideCraigslist;
      } else if (key === 'ksl') {
        base[key] = !filters.hideDealerListings && !filters.hideKsl;
      } else if (key === 'dealer_site') {
        base[key] = !filters.hideDealerListings && !filters.hideDealerSites;
      } else if (key === 'bat') {
        base[key] = !filters.hideBat;
      } else if (key === 'classic') {
        base[key] = !filters.hideClassic;
      } else {
        const allNamedSourcesHidden =
          filters.hideBat && filters.hideClassic && filters.hideCraigslist &&
          filters.hideKsl && filters.hideDealerSites;
        base[key] = !hiddenSourcesSet.has(key) && !allNamedSourcesHidden;
      }
    });

    activeSources.forEach(source => {
      const key = domainToFilterKey(source.domain);
      if (!base.hasOwnProperty(key)) {
        base[key] = !hiddenSourcesSet.has(key);
      }
    });

    filters.hiddenSources?.forEach(key => {
      if (!base.hasOwnProperty(key)) {
        base[key] = false;
      } else if (!['craigslist', 'ksl', 'dealer_site', 'bat', 'classic'].includes(key)) {
        base[key] = false;
      }
    });

    return base;
  }, [activeSources, filters, domainToFilterKey]);

  const sourceAliasMap = useMemo(() => {
    const map = new Map<string, string>();
    activeSources.forEach((source) => {
      const host = normalizeHost(source.domain);
      if (!host) return;
      const key = domainToFilterKey(host);
      if (!key) return;
      const aliases = new Set<string>();
      aliases.add(host);
      aliases.add(normalizeAlias(host));
      aliases.add(normalizeAlias(stripTld(host)));
      aliases.add(normalizeAlias(source.source_name || ''));
      aliases.add(normalizeAlias(key));
      aliases.forEach((alias) => {
        if (alias) map.set(alias, key);
      });
    });
    return map;
  }, [activeSources, domainToFilterKey]);

  const getSourceFilterKey = useCallback((v: any): string => {
    const discoveryHost = normalizeHost(v?.discovery_url || '');
    if (discoveryHost) {
      const key = domainToFilterKey(discoveryHost);
      if (key) return key;
    }
    const discoverySource = String(v?.discovery_source || '').trim().toLowerCase();
    if (discoverySource) {
      const normalized = normalizeAlias(discoverySource);
      const mapped = sourceAliasMap.get(discoverySource) || sourceAliasMap.get(normalized);
      if (mapped) return mapped;
      const key = domainToFilterKey(discoverySource);
      if (key) return key;
    }
    return classifySource(v);
  }, [domainToFilterKey, sourceAliasMap]);

  const buildSourceCounts = useCallback((vehicles: any[]) => {
    const counts: Record<string, number> = {};
    (vehicles || []).forEach((v: any) => {
      const key = getSourceFilterKey(v);
      if (key) {
        counts[key] = (counts[key] || 0) + 1;
      }
    });

    const domainCounts: Record<string, number> = {};
    const seenKeys = new Set<string>();
    activeSources.forEach((source) => {
      const key = domainToFilterKey(source.domain);
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      domainCounts[key] = counts[key] || 0;
    });
    return domainCounts;
  }, [activeSources, domainToFilterKey, getSourceFilterKey]);

  // Load active sources from database
  useEffect(() => {
    async function loadActiveSources() {
      try {
        const { data, error } = await supabase
          .from('scrape_sources')
          .select('id, name, url, is_active')
          .eq('is_active', true)
          .order('name', { ascending: true });

        if (error) {
          setActiveSources([
            { id: '1', domain: 'craigslist.org', source_name: 'Craigslist', url: 'https://craigslist.org' },
            { id: '2', domain: 'ksl.com', source_name: 'KSL', url: 'https://ksl.com' },
            { id: '3', domain: 'autotrader.com', source_name: 'Dealer Sites', url: 'https://autotrader.com' },
            { id: '4', domain: 'bringatrailer.com', source_name: 'Bring a Trailer', url: 'https://bringatrailer.com' },
            { id: '5', domain: 'classic.com', source_name: 'Classic.com', url: 'https://classic.com' }
          ]);
        } else {
          const transformedData = (data || [])
            .map(source => {
              let domain = source.url;
              try {
                const urlObj = new URL(source.url);
                domain = urlObj.hostname.replace(/^www\./, '');
              } catch {
                domain = source.url
                  ? source.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')
                  : '';
              }
              return {
                id: source.id,
                domain,
                source_name: source.name,
                url: source.url
              };
            })
            .filter(
              (row) =>
                !looksLikeHttpError(row.source_name) && !looksLikeHttpError(row.domain)
            );

          setActiveSources(transformedData);
        }
      } catch {
        // Error loading sources - silent
      } finally {
        setSourcesLoading(false);
      }
    }

    loadActiveSources();
  }, []);

  // Load vehicle counts per source
  useEffect(() => {
    async function loadSourceCounts() {
      try {
        const { data: vehicles, error } = await supabase
          .from('vehicles')
          .select('discovery_url, discovery_source, profile_origin')
          .eq('is_public', true)
          .neq('status', 'pending');

        if (error) {
          if (isMissingListingKindColumn(error)) {
            listingKindSupportedRef.current = false;
            const retry = await supabase
              .from('vehicles')
              .select('discovery_url, discovery_source, profile_origin')
              .eq('is_public', true)
              .neq('status', 'pending');
            if (retry.error) return;

            const vehicles = retry.data as any[];
            setSourceCounts(buildSourceCounts(vehicles || []));
            return;
          }
          return;
        }

        setSourceCounts(buildSourceCounts(vehicles || []));
      } catch {
        // Error loading source counts - silent
      }
    }

    if (activeSources.length > 0) {
      loadSourceCounts();
    }
  }, [activeSources, buildSourceCounts, domainToFilterKey, isMissingListingKindColumn, listingKindSupportedRef]);

  const faviconUrl = useCallback((domain: string) => {
    return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
  }, []);

  const sourcePogs = useMemo(() => {
    const deduplicatedMap = new Map<string, SourcePog>();

    activeSources.forEach((source) => {
      const key = domainToFilterKey(source.domain);
      if (!key || deduplicatedMap.has(key)) return;
      const meta = SOURCE_META[key];
      const rawTitle = meta?.title || source.source_name || source.domain;
      if (looksLikeHttpError(rawTitle) || looksLikeHttpError(source.domain)) return;
      deduplicatedMap.set(key, {
        key,
        domain: meta?.domain || source.domain,
        title: rawTitle,
        included: includedSources[key] === true,
        id: meta ? key : source.id,
        url: meta ? `https://${meta.domain}` : source.url,
        count: sourceCounts[key] || 0
      });
    });

    const deduplicated = Array.from(deduplicatedMap.values()).sort((a, b) => {
      if (a.included !== b.included) return a.included ? -1 : 1;
      if (a.count !== b.count) return b.count - a.count;
      const titleCompare = a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
      if (titleCompare !== 0) return titleCompare;
      return a.domain.localeCompare(b.domain, undefined, { sensitivity: 'base', numeric: true });
    });

    return {
      all: deduplicated,
      selected: deduplicated.filter((x) => x.included),
      hiddenCount: deduplicated.filter((x) => !x.included).length
    };
  }, [activeSources, includedSources, domainToFilterKey, sourceCounts]);

  const domainHue = useCallback((domain: string) => {
    const s = String(domain || '').toLowerCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h % 360;
  }, []);

  const domainGradient = useCallback((domain: string) => {
    const h1 = domainHue(domain);
    const h2 = (h1 + 42) % 360;
    return `linear-gradient(135deg, hsla(${h1}, 92%, 60%, 0.38), hsla(${h2}, 92%, 56%, 0.16))`;
  }, [domainHue]);

  return {
    activeSources,
    sourcesLoading,
    sourceCounts,
    domainToFilterKey,
    includedSources,
    getSourceFilterKey,
    sourcePogs,
    faviconUrl,
    domainGradient,
  };
}
