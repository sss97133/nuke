import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface BaTMember {
  id: string;
  handle: string;
  display_name: string | null;
  profile_url: string;
  metadata: any;
  member_since: string | null;
  comments_count: number;
  listings_count: number;
  claimed_by_user_id: string | null;
}

export default function BaTMembers() {
  const navigate = useNavigate();
  const [members, setMembers] = useState<BaTMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'comments' | 'listings' | 'recent' | 'name'>('comments');
  const [platformFilter, setPlatformFilter] = useState<string>('bat');

  useEffect(() => {
    loadMembers();
  }, [searchQuery, sortBy, platformFilter]);

  const loadMembers = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('external_identities')
        .select('id, handle, display_name, profile_url, metadata, claimed_by_user_id, first_seen_at, created_at')
        .eq('platform', platformFilter);

      // Apply search filter
      if (searchQuery.trim()) {
        query = query.or(`handle.ilike.%${searchQuery}%,display_name.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Process members with stats
      const membersWithStats = await Promise.all(
        (data || []).map(async (member) => {
          const metadata = member.metadata || {};
          const memberSince = metadata.member_since || null;
          const commentsCount = metadata.comments_count || metadata.total_comments || 0;
          const listingsCount = metadata.listings_count || metadata.total_listings || 0;

          // If we don't have counts in metadata, try to get them from the database
          let actualCommentsCount = commentsCount;
          let actualListingsCount = listingsCount;

          if (commentsCount === 0 || listingsCount === 0) {
            // Get comment count
            const { count: commentCount } = await supabase
              .from('bat_comments')
              .select('*', { count: 'exact', head: true })
              .eq('external_identity_id', member.id);

            // Get listing count (as seller)
            const { count: listingCount } = await supabase
              .from('bat_listings')
              .select('*', { count: 'exact', head: true })
              .eq('seller_external_identity_id', member.id);

            actualCommentsCount = commentCount || 0;
            actualListingsCount = listingCount || 0;
          }

          return {
            id: member.id,
            handle: member.handle,
            display_name: member.display_name,
            profile_url: member.profile_url,
            metadata: metadata,
            member_since: memberSince,
            comments_count: actualCommentsCount,
            listings_count: actualListingsCount,
            claimed_by_user_id: member.claimed_by_user_id,
          };
        })
      );

      // Sort members
      const sorted = membersWithStats.sort((a, b) => {
        switch (sortBy) {
          case 'comments':
            return b.comments_count - a.comments_count;
          case 'listings':
            return b.listings_count - a.listings_count;
          case 'recent':
            return new Date(b.metadata?.scraped_at || b.metadata?.first_seen_at || 0).getTime() -
                   new Date(a.metadata?.scraped_at || a.metadata?.first_seen_at || 0).getTime();
          case 'name':
            return (a.handle || '').localeCompare(b.handle || '');
          default:
            return 0;
        }
      });

      // Filter out members with no activity (optional - you might want to show all)
      const activeMembers = sorted.filter(m => m.comments_count > 0 || m.listings_count > 0);

      setMembers(activeMembers);
    } catch (error) {
      console.error('Error loading BaT members:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMemberClick = (member: BaTMember) => {
    if (member.claimed_by_user_id) {
      navigate(`/profile/${member.claimed_by_user_id}`);
    } else {
      navigate(`/profile/external/${member.id}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: '40px', fontSize: '9pt' }}>
          Loading BaT members...
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '6px' }}>
          BaT Members
        </h1>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Browse Bring a Trailer members and their activity
        </p>
      </div>

      {/* Search & Filters */}
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '12px', alignItems: 'center' }}>
          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by username..."
            className="form-input"
            style={{ fontSize: '9pt' }}
          />

          {/* Platform filter */}
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="form-select"
            style={{ fontSize: '9pt' }}
          >
            <option value="bat">BaT</option>
            <option value="cars_and_bids">Cars & Bids</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="form-select"
            style={{ fontSize: '9pt' }}
          >
            <option value="comments">Most Comments</option>
            <option value="listings">Most Listings</option>
            <option value="recent">Recently Added</option>
            <option value="name">Name (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Stats */}
      <div style={{ marginBottom: '20px', fontSize: '8pt', color: 'var(--text-muted)' }}>
        Showing {members.length} {platformFilter === 'bat' ? 'BaT' : 'Cars & Bids'} members
        {searchQuery && ` matching "${searchQuery}"`}
      </div>

      {/* Members Grid */}
      {members.length === 0 ? (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px'
        }}>
          <div style={{ fontSize: '9pt', marginBottom: '8px' }}>No members found</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            {searchQuery ? 'Try a different search term' : 'No members with activity yet'}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px'
        }}>
          {members.map((member) => (
            <div
              key={member.id}
              onClick={() => handleMemberClick(member)}
              style={{
                background: 'var(--white)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--primary)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* Avatar placeholder */}
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'var(--grey-100)',
                border: '1px solid var(--border)',
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16pt',
                fontWeight: 700,
                color: 'var(--text-muted)'
              }}>
                {member.handle.charAt(0).toUpperCase()}
              </div>

              {/* Name */}
              <div style={{
                fontSize: '11pt',
                fontWeight: 700,
                marginBottom: '4px',
                color: 'var(--text)'
              }}>
                {member.display_name || member.handle}
              </div>

              {/* Handle */}
              <div style={{
                fontSize: '8pt',
                color: 'var(--text-muted)',
                marginBottom: '12px'
              }}>
                @{member.handle}
                {member.claimed_by_user_id && (
                  <span style={{ marginLeft: '8px', color: 'var(--success)' }}>✓ Claimed</span>
                )}
              </div>

              {/* Stats */}
              <div style={{
                display: 'flex',
                gap: '16px',
                fontSize: '8pt',
                color: 'var(--text-muted)'
              }}>
                <div>
                  <strong style={{ color: 'var(--text)' }}>{member.comments_count}</strong> comments
                </div>
                <div>
                  <strong style={{ color: 'var(--text)' }}>{member.listings_count}</strong> listings
                </div>
              </div>

              {/* Member since */}
              {member.member_since && (
                <div style={{
                  fontSize: '7pt',
                  color: 'var(--text-muted)',
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border)'
                }}>
                  Member since {member.member_since}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

