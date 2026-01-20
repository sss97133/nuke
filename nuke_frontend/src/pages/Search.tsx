import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import IntelligentSearch from '../components/search/IntelligentSearch';
import SearchResults from '../components/search/SearchResults';
import { aiGateway } from '../lib/aiGateway';
import { supabase } from '../lib/supabase';
import type { SearchResult } from '../types/search';
import '../design-system.css';

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchSummary, setSearchSummary] = useState('Enter a search query to find vehicles, organizations, parts, and more');
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);

  const [answer, setAnswer] = useState<string>('');
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<Array<{ title: string; href?: string }>>([]);
  const [answerRequestId, setAnswerRequestId] = useState(0);

  const haversineMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const detectMakeFromQuery = (q: string): string | null => {
    const t = (q || '').toLowerCase();
    const makes = [
      'porsche',
      'volkswagen',
      'vw',
      'bmw',
      'mercedes',
      'audi',
      'toyota',
      'honda',
      'ford',
      'chevrolet',
      'chevy',
      'gmc',
      'dodge',
      'jeep',
      'tesla',
    ];
    for (const m of makes) {
      if (t.includes(m)) {
        if (m === 'vw') return 'volkswagen';
        if (m === 'chevy') return 'chevrolet';
        return m;
      }
    }
    return null;
  };

  const looksLikeOwnershipCountQuestion = (q: string) => {
    const t = (q || '').toLowerCase();
    return /how\s+many\b/.test(t) && /\b(do\s+i\s+own|i\s+own|do\s+i\s+have|i\s+have)\b/.test(t);
  };

  const looksLikeNearbyCurationQuestion = (q: string) => {
    const t = (q || '').toLowerCase();
    return /\b(near\s+me|nearby|in\s+this\s+area|around\s+here|in\s+my\s+area)\b/.test(t);
  };

  const looksLikeVibeQuestion = (q: string) => {
    const t = (q || '').toLowerCase();
    return /\b(vibe|coolest\s+spots|cool\s+spots|car\s+show|collectors?|richest\s+history|best\s+set\s+of\s+cars)\b/.test(t);
  };

  const buildStructuredSources = async (q: string) => {
    const trimmed = (q || '').trim();
    if (!trimmed) return [] as Array<{ title: string; text: string; href?: string }>;

    const sources: Array<{ title: string; text: string; href?: string }> = [];
    const make = detectMakeFromQuery(trimmed);
    const isMissingListingKindColumn = (err: any) => {
      const code = String((err as any)?.code || '').toUpperCase();
      const message = String(err?.message || '').toLowerCase();
      if (!message.includes('listing_kind')) return false;
      if (code === '42703' || code === 'PGRST204') return true;
      return message.includes('does not exist') || message.includes('schema cache');
    };

    const wantsCount = looksLikeOwnershipCountQuestion(trimmed);
    const wantsNearby = looksLikeNearbyCurationQuestion(trimmed) || looksLikeVibeQuestion(trimmed);
    const wantsVibe = looksLikeVibeQuestion(trimmed);

    let currentUserId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      currentUserId = data?.user?.id ?? null;
    } catch {
      currentUserId = null;
    }

    if (wantsCount && currentUserId) {
      try {
        const runCountQuery = async (includeListingKind: boolean) => {
          let queryBuilder = supabase
            .from('vehicles')
            .select('id', { count: 'exact', head: true });
          if (includeListingKind) queryBuilder = queryBuilder.eq('listing_kind', 'vehicle');

          if (make) {
            queryBuilder = queryBuilder.ilike('make', `%${make}%`);
          }

          // Be liberal on ownership fields; schema may include owner_id, user_id, or uploaded_by.
          queryBuilder = queryBuilder.or(`owner_id.eq.${currentUserId},user_id.eq.${currentUserId},uploaded_by.eq.${currentUserId}`);
          return await queryBuilder;
        };

        let { count, error } = await runCountQuery(true);
        if (error && isMissingListingKindColumn(error)) {
          ({ count, error } = await runCountQuery(false));
        }
        if (!error) {
          sources.push({
            title: make ? `Your ${make} count` : 'Your vehicle count',
            text: JSON.stringify({ make: make ?? null, count: count ?? 0 })
          });
        }
      } catch {
        // ignore
      }
    }

    if (wantsNearby && userLocation) {
      const radiusMeters = 80000; // baseline: ~50 miles
      const lat = userLocation.lat;
      const lng = userLocation.lng;
      const approxLatDelta = radiusMeters / 111000;
      const approxLngDelta = radiusMeters / (111000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

      try {
        const runNearbyQuery = async (includeListingKind: boolean) => {
          let vq = supabase
            .from('vehicles')
            .select('id, year, make, model, is_for_sale, latitude, longitude, created_at, owner_id, user_id, uploaded_by')
            .eq('is_public', true);
          if (includeListingKind) vq = vq.eq('listing_kind', 'vehicle');
          vq = vq
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .gte('latitude', lat - approxLatDelta)
            .lte('latitude', lat + approxLatDelta)
            .gte('longitude', lng - approxLngDelta)
            .lte('longitude', lng + approxLngDelta)
            .limit(300);

          if (make) {
            vq = vq.ilike('make', `%${make}%`);
          }
          return await vq;
        };

        let { data: vehicles, error } = await runNearbyQuery(true);
        if (error && isMissingListingKindColumn(error)) {
          ({ data: vehicles, error } = await runNearbyQuery(false));
        }
        if (!error && vehicles && vehicles.length > 0) {
          const withDistance = vehicles
            .map((v: any) => {
              const d = haversineMeters(lat, lng, Number(v.latitude), Number(v.longitude));
              return { ...v, distance_meters: d };
            })
            .filter((v: any) => Number.isFinite(v.distance_meters) && v.distance_meters <= radiusMeters)
            .sort((a: any, b: any) => a.distance_meters - b.distance_meters);

          const top = withDistance.slice(0, 12).map((v: any) => ({
            id: v.id,
            title: `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim(),
            distance_miles: Math.round((v.distance_meters / 1609.34) * 10) / 10,
            is_for_sale: !!v.is_for_sale,
          }));

          sources.push({
            title: make ? `Nearby ${make} vehicles (public)` : 'Nearby vehicles (public)',
            text: JSON.stringify({
              radius_miles: Math.round((radiusMeters / 1609.34) * 10) / 10,
              count: withDistance.length,
              top
            })
          });

          if (wantsVibe) {
            const byMake = new Map<string, number>();
            const ownerSet = new Set<string>();
            let forSaleCount = 0;
            withDistance.forEach((v: any) => {
              const mk = String(v.make || '').trim() || 'Unknown';
              byMake.set(mk, (byMake.get(mk) || 0) + 1);
              if (v.is_for_sale) forSaleCount++;
              const oid = v.owner_id || v.user_id || v.uploaded_by;
              if (oid) ownerSet.add(String(oid));
            });
            const topMakes = Array.from(byMake.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([mk, ct]) => ({ make: mk, count: ct }));

            sources.push({
              title: 'Area vibe snapshot (public vehicles)',
              text: JSON.stringify({
                radius_miles: Math.round((radiusMeters / 1609.34) * 10) / 10,
                total_vehicles: withDistance.length,
                unique_owners_approx: ownerSet.size,
                for_sale_count: forSaleCount,
                top_makes: topMakes
              })
            });
          }
        } else if (!error) {
          sources.push({
            title: make ? `Nearby ${make} vehicles (public)` : 'Nearby vehicles (public)',
            text: JSON.stringify({ radius_miles: Math.round((radiusMeters / 1609.34) * 10) / 10, count: 0, top: [] })
          });
        }
      } catch {
        // ignore
      }
    }

    return sources;
  };

  const looksLikeQuestion = (q: string) => {
    const t = (q || '').trim().toLowerCase();
    if (!t) return false;
    if (t.includes('?')) return true;
    if (/^(what|why|how|when|where|who|which|are|is|do|does|did|can|should|could|would)\b/i.test(t)) return true;
    if (/\b(same\b|difference\b|vs\b|compare\b|better\b|best\b|everyone\s+loves\b)\b/i.test(t)) return true;
    return false;
  };

  const buildResultHref = (r: SearchResult): string | undefined => {
    switch (r.type) {
      case 'vehicle':
        return `/vehicle/${r.id}`;
      case 'organization':
        return `/org/${r.id}`;
      case 'user':
        return `/profile/${r.id}`;
      case 'shop':
        return `/org/${r.id}`;
      case 'part':
        return `/parts/${r.id}`;
      case 'timeline_event':
        return r.metadata?.vehicle_id ? `/vehicle/${r.metadata.vehicle_id}` : undefined;
      case 'image':
        return r.metadata?.vehicle_id ? `/vehicle/${r.metadata.vehicle_id}` : `/images/${r.id}`;
      case 'auction':
        return r.metadata?.listing_url ? String(r.metadata.listing_url) : undefined;
      case 'source':
        return r.metadata?.url ? String(r.metadata.url) : (r.metadata?.domain ? `https://${String(r.metadata.domain)}` : undefined);
      default:
        return undefined;
    }
  };

  const generateAnswer = async (q: string, rs: SearchResult[]) => {
    const trimmed = (q || '').trim();
    if (!trimmed) return;

    const nextRequestId = answerRequestId + 1;
    setAnswerRequestId(nextRequestId);
    setAnswerLoading(true);
    setAnswerError(null);
    setAnswer('');

    const structured = await buildStructuredSources(trimmed);
    const top = (rs || []).slice(0, 8);
    const sources = [
      ...structured.map((s) => ({ title: s.title, href: s.href })),
      ...top.map((r) => ({ title: r.title, href: buildResultHref(r) })),
    ];
    setAnswerSources(sources);

    try {
      const structuredContext = structured
        .map((s, idx) => {
          const payload = (s.text || '').slice(0, 2000);
          return `SOURCE ${idx + 1}: structured\nTITLE: ${s.title}\nDATA: ${payload}`;
        })
        .join('\n\n');

      const topContext = top
        .map((r, idx) => {
          const desc = (r.description || '').slice(0, 400);
          const meta = r.metadata ? JSON.stringify(r.metadata).slice(0, 400) : '';
          return `SOURCE ${structured.length + idx + 1}: ${r.type}\nTITLE: ${r.title}\nDESCRIPTION: ${desc}${meta ? `\nMETADATA: ${meta}` : ''}`;
        })
        .join('\n\n');

      const context = [structuredContext, topContext].filter(Boolean).join('\n\n');

      const requestPayload = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are a search assistant. Answer the user question using ONLY the provided SOURCES. If the sources are insufficient, say what is missing and suggest a better search query. Keep it concise. When you use a source, cite it like [1], [2].'
          },
          {
            role: 'user',
            content: `QUESTION:\n${trimmed}\n\nSOURCES:\n${context || '(no sources)'}\n\nReturn a short answer, then a short list of citations like: Sources: [1] [3].`
          }
        ],
        max_tokens: 350,
        temperature: 0.2
      };

      const gatewayResult = await aiGateway.makeRequest('openai', 'gpt-4o', requestPayload, {
        cache: false,
        fallback: true,
      });

      const content: string | undefined = gatewayResult?.choices?.[0]?.message?.content;
      if (nextRequestId !== answerRequestId + 1) {
        return;
      }
      if (!content) {
        setAnswerError('No answer returned');
        return;
      }

      setAnswer(String(content).trim());
    } catch (e: any) {
      if (nextRequestId !== answerRequestId + 1) {
        return;
      }
      setAnswerError(e?.message || 'Failed to generate answer');
    } finally {
      if (nextRequestId === answerRequestId + 1) {
        setAnswerLoading(false);
      }
    }
  };

  // Get user location if needed
  useEffect(() => {
    const t = (searchQuery || '').toLowerCase();
    if (t.includes('near me') || t.includes('nearby') || t.includes('in this area') || t.includes('around here') || t.includes('in my area')) {
      navigator.geolocation?.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        () => {
          console.warn('Could not get user location');
        }
      );
    }
  }, [searchQuery]);

  // Update URL when search query changes
  useEffect(() => {
    if (searchQuery) {
      setSearchParams({ q: searchQuery });
    } else {
      setSearchParams({});
    }
  }, [searchQuery, setSearchParams]);

  const handleSearchResults = (searchResults: SearchResult[], summary: string) => {
    setResults(searchResults);
    setSearchSummary(summary);
    setLoading(false);

    const q = (searchParams.get('q') || searchQuery || '').trim();
    if (looksLikeQuestion(q)) {
      generateAnswer(q, searchResults);
    } else {
      setAnswer('');
      setAnswerError(null);
      setAnswerLoading(false);
      setAnswerSources([]);
    }
  };

  // Sync searchQuery with URL parameter
  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    if (urlQuery !== searchQuery) {
      setSearchQuery(urlQuery);
      if (urlQuery) {
        setLoading(true);
      }
    }
  }, [searchParams]);

  return (
    <div style={{ padding: '12px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Search Input */}
      <div style={{ marginBottom: '24px' }}>
        <IntelligentSearch
          initialQuery={searchQuery}
          userLocation={userLocation}
          onSearchResults={handleSearchResults}
        />
      </div>

      {searchQuery && looksLikeQuestion(searchQuery) && (answerLoading || answer || answerError) && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            padding: '16px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '0px'
          }}>
            <div className="text font-bold" style={{ fontSize: '9pt', marginBottom: '8px' }}>Answer</div>
            {answerLoading && (
              <div className="text-small text-muted" style={{ fontSize: '8pt' }}>Thinking…</div>
            )}
            {answerError && (
              <div className="text-small" style={{ fontSize: '8pt', color: 'var(--danger)' }}>{answerError}</div>
            )}
            {!!answer && (
              <div className="text" style={{ fontSize: '9pt', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{answer}</div>
            )}

            {answerSources.length > 0 && (
              <div style={{ marginTop: '12px' }}>
                <div className="text-small text-muted" style={{ fontSize: '8pt', marginBottom: '6px' }}>Top sources in your results</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {answerSources.slice(0, 5).map((s, idx) => (
                    <div key={`${s.title}-${idx}`} className="text-small" style={{ fontSize: '8pt' }}>
                      {s.href ? (
                        <a href={s.href} style={{ color: 'var(--text)', textDecoration: 'underline' }}>{s.title}</a>
                      ) : (
                        <span>{s.title}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

        {/* Loading State */}
        {loading && (
          <div style={{
            textAlign: 'center',
            padding: '24px',
            background: 'var(--grey-50)',
            border: '1px solid var(--border)',
            borderRadius: '0px',
            fontSize: '8pt'
          }}>
            <h3 className="heading-3" style={{ fontSize: '9pt', marginBottom: '8px' }}>Searching...</h3>
            <p className="text text-muted" style={{ fontSize: '8pt' }}>Finding results for "{searchQuery}"</p>
          </div>
        )}

      {/* Results - Always show if there's a query or results */}
      {searchQuery && (
        <SearchResults
          results={results}
          searchSummary={searchSummary}
          loading={loading}
        />
      )}
    </div>
  );
}

