import React, { useState, useEffect, useMemo } from 'react';
import { PrefetchLink } from '../components/PrefetchLink';
import { supabase } from '../lib/supabase';
import '../styles/unified-design-system.css';

interface BaTMember {
  id: string;
  handle: string;
  display_name: string | null;
  profile_url: string;
  observed_at: string | null;
  comments_count: number | null;
  bids_count: number | null;
  wins_count: number | null;
  record_basis: 'replayed' | 'legacy' | null;
  record_clock: string | null;
  claimed_by_user_id: string | null;
}

const PAGE_SIZE = 50;
const countValue = (value: unknown): number | null => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const timeValue = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

export default function BaTMembers() {
  const [members, setMembers] = useState<BaTMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'comments' | 'bids' | 'recent' | 'name'>('name');
  const [platformFilter, setPlatformFilter] = useState<string>('bat');
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState(false);
  const [activityError, setActivityError] = useState(false);
  const [reload, setReload] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const readKey = JSON.stringify([searchQuery.trim(), platformFilter, page, reload]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => { try {
      let query = supabase
        .from('external_identities')
        .select('id, handle, display_name, profile_url, claimed_by_user_id, first_seen_at, last_seen_at, created_at')
        .in('platform', platformFilter === 'bat' ? ['bat'] : ['cars_and_bids', 'carsandbids']);

      // Apply search filter
      if (searchQuery.trim()) {
        const literal = searchQuery.trim().replace(/[\\%_]/g, '\\$&');
        query = query.ilike('handle', `%${literal}%`);
      }

      const parent = await query.order('handle').order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      if (parent.error) throw parent.error;
      if (cancelled) return;
      const rows = (parent.data || []).slice(0, PAGE_SIZE);
      // Reuse the canonical fold in one bounded read, never rescan comments per member.
      const profiles = platformFilter === 'bat' && rows.length ? await supabase.from('bat_user_profiles')
        .select('external_identity_id, username, total_comments, total_bids, total_wins, record_method:metadata->bat_bidder_record->>method, eligible_closed:metadata->bat_bidder_record->>eligible_closed_presentations, record_clock:metadata->bat_bidder_record->>refreshed_at')
        .in('external_identity_id', rows.map(row => row.id)).limit(PAGE_SIZE + 1)
        .then(result => result, () => ({ data: null, error: { message: 'Activity unavailable' } })) : { data: [], error: null };
      if (cancelled) return;
      const byIdentity = new Map<string, typeof profiles.data>();
      for (const profile of profiles.data || []) {
        const key = profile.external_identity_id;
        if (key) byIdentity.set(key, [...(byIdentity.get(key) || []), profile]);
      }
      const mapped = rows.map(member => {
        const matches = byIdentity.get(member.id) || [];
        const profile = !profiles.error && (profiles.data?.length ?? 0) <= PAGE_SIZE && matches.length === 1 && matches[0].username === member.handle ? matches[0] : null;
        const replayed = profile?.record_method === 'published_buyer_v1';
        return { ...member, observed_at: member.last_seen_at || member.first_seen_at || member.created_at,
          comments_count: countValue(profile?.total_comments), bids_count: countValue(profile?.total_bids),
          wins_count: replayed && (countValue(profile?.eligible_closed) ?? 0) > 0 ? countValue(profile?.total_wins) : null,
          record_clock: profile?.record_clock ?? null,
          record_basis: profile ? replayed ? 'replayed' as const : 'legacy' as const : null };
      });
      setMembers(mapped); setHasNext((parent.data?.length ?? 0) > PAGE_SIZE);
      setActivityError(Boolean(profiles.error) || (profiles.data?.length ?? 0) > PAGE_SIZE);
      setError(false); setLoadedKey(readKey);
    } catch {
      if (!cancelled) { setMembers([]); setHasNext(false); setError(true); setLoadedKey(readKey); }
    } finally { if (!cancelled) setLoading(false); } }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [readKey, searchQuery, platformFilter, page]);

  const supportedSort = (sortBy === 'comments' && !members.some(member => member.comments_count !== null))
    || (sortBy === 'bids' && !members.some(member => member.bids_count !== null)) ? 'name' : sortBy;
  const sorted = useMemo(() => [...members].sort((a, b) => {
        switch (supportedSort) {
          case 'comments':
            return (b.comments_count ?? -1) - (a.comments_count ?? -1);
          case 'bids':
            return (b.bids_count ?? -1) - (a.bids_count ?? -1);
          case 'recent':
            return timeValue(b.observed_at) - timeValue(a.observed_at);
          case 'name':
            return (a.handle || '').localeCompare(b.handle || '');
          default:
            return 0;
        }
      }), [members, supportedSort]);
  const reading = loading || loadedKey !== readKey;

  return (
    <div style={{ padding: '12px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '21px', fontWeight: 700, marginBottom: '6px' }}>
          {platformFilter === 'bat' && <img src="/vendor/bat/favicon.ico" width={24} height={24} alt="" style={{ verticalAlign: 'middle', marginRight: 8 }} />}
          {platformFilter === 'bat' ? 'Bring a Trailer' : 'Cars & Bids'} members
        </h1>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {platformFilter === 'bat' ? 'Captured identities · activity from retained BaT records. Legacy counts have unknown coverage; these are not seller grades.' : 'Captured Cars & Bids identities · activity unmeasured here.'}
        </p>
      </div>

      {/* Search & Filters */}
      <div style={{
        background: 'var(--white)',
        marginBottom: '12px'
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            aria-label="Search member handle"
            placeholder="Search by username..."
            className="form-input"
            style={{ fontSize: '12px', width: 'auto', flex: '1 1 160px', minWidth: 0 }}
          />

          {/* Platform filter */}
          <select
            value={platformFilter}
            onChange={(e) => { setPlatformFilter(e.target.value); setPage(0); }}
            aria-label="Member platform"
            className="form-select"
            style={{ fontSize: '12px', width: 'auto', maxWidth: '100%' }}
          >
            <option value="bat">BaT</option>
            <option value="cars_and_bids">Cars & Bids</option>
          </select>

          {/* Sort */}
          {!reading && !error && members.length > 1 && <select
            value={supportedSort}
            aria-label="Sort this directory page"
            onChange={(e) => setSortBy(e.target.value as any)}
            className="form-select"
            style={{ fontSize: '12px', width: 'auto', maxWidth: '100%' }}
          >
            <option value="comments" disabled={!members.some(member => member.comments_count !== null)}>Recorded posts · this page</option>
            <option value="bids" disabled={!members.some(member => member.bids_count !== null)}>Recorded bids · this page</option>
            <option value="recent">Recently observed · this page</option>
            <option value="name">Name (A-Z)</option>
          </select>}
        </div>
      </div>

      {/* Stats */}
      {!reading && !error && <div style={{ marginBottom: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
        {members.length} captured {members.length === 1 ? 'identity' : 'identities'} · page {page + 1}
        {searchQuery && ` matching "${searchQuery}"`}
      </div>}
      {!reading && !error && activityError && <p role="status">Activity could not be read. Identity links remain available.</p>}

      {/* Members Grid */}
      {reading ? <p role="status">Reading captured identities…</p> : error ? <p role="alert">Directory unavailable. <button type="button" onClick={() => setReload(value => value + 1)}>Retry</button></p> : members.length === 0 ? (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          background: 'var(--surface)',
          border: '1px solid var(--border)'}}>
          <div style={{ fontSize: '12px', marginBottom: '8px' }}>No captured identities in this page</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {searchQuery ? 'Try a different handle' : 'No identity records returned'}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
          gap: '8px'
        }}>
          {sorted.map((member) => (
            <PrefetchLink
              key={member.id}
              to={member.claimed_by_user_id ? `/profile/${member.claimed_by_user_id}` : `/profile/external/${member.id}`}
              style={{
                background: 'var(--white)',
                border: '2px solid var(--border)', padding: '12px', color: 'inherit', textDecoration: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              {/* Name */}
              <div style={{
                fontSize: '15px',
                fontWeight: 700,
                marginBottom: '4px',
                color: 'var(--text)'
              }}>
                {member.display_name || member.handle}
              </div>

              {/* Handle */}
              <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginBottom: '12px'
              }}>
                {member.display_name && member.display_name !== member.handle && `@${member.handle}`}
                {member.claimed_by_user_id && (
                  <span style={{ marginLeft: '8px' }}>Linked account</span>
                )}
              </div>

              {/* Stats */}
              {(member.comments_count !== null || member.bids_count !== null || member.wins_count !== null) && <div style={{
                display: 'flex',
                gap: '16px',
                fontSize: '11px',
                color: 'var(--text-muted)'
              }}>
                {member.comments_count !== null && <div><strong style={{ color: 'var(--text)' }}>{member.comments_count}</strong> posts</div>}
                {member.bids_count !== null && <div><strong style={{ color: 'var(--text)' }}>{member.bids_count}</strong> bids</div>}
                {member.wins_count !== null && <div><strong style={{ color: 'var(--text)' }}>{member.wins_count}</strong> awards</div>}
              </div>}

              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>{member.record_basis === 'replayed' ? 'Replayed' : member.record_basis === 'legacy' ? 'Legacy' : 'Activity unmeasured'}{member.record_basis && (timeValue(member.record_clock) > 0 ? ` · record refreshed ${new Date(member.record_clock!).toLocaleDateString()}` : ' · activity clock unknown')}</div>
              {/* Nuke observation clock, never platform membership age. */}
              {timeValue(member.observed_at) > 0 && (
                <div style={{
                  fontSize: '9px',
                  color: 'var(--text-muted)',
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border)'
                }}>
                  Observed by Nuke {new Date(member.observed_at!).toLocaleDateString()}
                </div>
              )}
            </PrefetchLink>
          ))}
        </div>
      )}
      {!reading && (page > 0 || hasNext) && <nav aria-label="Directory pages" style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
        <button type="button" disabled={error || !hasNext} onClick={() => setPage(value => value + 1)}>Next</button>
      </nav>}
    </div>
  );
}

