/**
 * BaT Profile Extractor
 * Tool to extract data from BaT member profiles for market analysis
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface BaTProfileData {
  username: string;
  profile_url: string;
  listings: number;
  bids: number;
  comments: number;
  success_stories: number;
  auction_wins: number;
  member_since: string;
  location: string;
  website?: string;
}

export const BaTProfileExtractor: React.FC = () => {
  const [batProfileUrl, setBatProfileUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<BaTProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const extractProfileData = async () => {
    if (!batProfileUrl || !batProfileUrl.includes('bringatrailer.com/member/')) {
      setError('Please enter a valid BaT profile URL (e.g., https://bringatrailer.com/member/wob/)');
      return;
    }

    setExtracting(true);
    setError(null);

    try {
      // Extract username from URL
      const urlMatch = batProfileUrl.match(/\/member\/([^\/]+)/);
      if (!urlMatch) {
        throw new Error('Could not extract username from URL');
      }
      const username = urlMatch[1];

      // Use existing comprehensive-bat-extraction function (it handles member profiles too)
      // For member profiles, we'll extract from the profile page HTML directly
      // First, try to get existing data from external_identities
      const { data: existingIdentity } = await supabase
        .from('external_identities')
        .select('*')
        .eq('platform', 'bat')
        .eq('handle', username)
        .single();

      if (existingIdentity && existingIdentity.metadata) {
        // Use existing data
        setExtractedData({
          username,
          profile_url: existingIdentity.profile_url || batProfileUrl,
          listings: existingIdentity.metadata.listings || 0,
          bids: existingIdentity.metadata.bids || 0,
          comments: existingIdentity.metadata.comments || 0,
          success_stories: existingIdentity.metadata.success_stories || 0,
          auction_wins: existingIdentity.metadata.auction_wins || 0,
          member_since: existingIdentity.metadata.member_since || '',
          location: existingIdentity.metadata.location || '',
          website: existingIdentity.metadata.website,
        });
        return;
      }

      // If no existing data, we'd need to scrape - for now, show message
      throw new Error('Profile data not found. Use comprehensive-bat-extraction function or scrape manually.');

      if (extractError) throw extractError;
      if (data?.error) throw new Error(data.error);

      setExtractedData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to extract profile data');
    } finally {
      setExtracting(false);
    }
  };

  const saveToDatabase = async () => {
    if (!extractedData) return;

    setSaving(true);
    setError(null);

    try {
      // Get or create external identity
      const { data: identity, error: identityError } = await supabase
        .from('external_identities')
        .upsert({
          platform: 'bat',
          handle: extractedData.username,
          profile_url: extractedData.profile_url,
          display_name: extractedData.username,
          metadata: {
            listings: extractedData.listings,
            bids: extractedData.bids,
            comments: extractedData.comments,
            success_stories: extractedData.success_stories,
            auction_wins: extractedData.auction_wins,
            member_since: extractedData.member_since,
            location: extractedData.location,
            website: extractedData.website,
          },
        }, {
          onConflict: 'platform,handle',
        })
        .select()
        .single();

      if (identityError) throw identityError;

      // If user is logged in, offer to claim this identity
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Update profile stats if this identity is claimed
        const { data: claimedIdentity } = await supabase
          .from('external_identities')
          .select('claimed_by_user_id')
          .eq('id', identity.id)
          .single();

        if (claimedIdentity?.claimed_by_user_id) {
          // Update profile stats
          await supabase.rpc('backfill_user_profile_stats', {
            p_user_id: claimedIdentity.claimed_by_user_id,
          });
        }
      }

      setError(null);
      alert('Profile data saved successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to save profile data');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
    }}>
      <h3 style={{ fontSize: '10pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-3)' }}>
        BaT Profile Extractor
      </h3>
      <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        Extract data from Bring a Trailer member profiles for market analysis and profile population.
      </p>

      <div style={{ marginBottom: 'var(--space-3)' }}>
        <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
          BaT Profile URL
        </label>
        <input
          type="text"
          value={batProfileUrl}
          onChange={(e) => setBatProfileUrl(e.target.value)}
          placeholder="https://bringatrailer.com/member/wob/"
          style={{
            width: '100%',
            padding: 'var(--space-2)',
            fontSize: '8pt',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--surface-hover)',
          }}
        />
      </div>

      <button
        onClick={extractProfileData}
        disabled={extracting || !batProfileUrl}
        style={{
          padding: 'var(--space-2) var(--space-4)',
          fontSize: '8pt',
          fontWeight: 'bold',
          background: extracting ? 'var(--text-muted)' : 'var(--accent)',
          color: 'var(--white)',
          border: 'none',
          borderRadius: '4px',
          cursor: extracting ? 'not-allowed' : 'pointer',
          marginBottom: 'var(--space-3)',
        }}
      >
        {extracting ? 'Extracting...' : 'Extract Profile Data'}
      </button>

      {error && (
        <div style={{
          padding: 'var(--space-2)',
          background: 'var(--danger-light)',
          border: '1px solid var(--danger)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: 'var(--danger)',
          marginBottom: 'var(--space-3)',
        }}>
          {error}
        </div>
      )}

      {extractedData && (
        <div style={{
          padding: 'var(--space-3)',
          background: 'var(--surface-hover)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          marginBottom: 'var(--space-3)',
        }}>
          <h4 style={{ fontSize: '9pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-2)' }}>
            Extracted Data
          </h4>
          <div style={{ fontSize: '8pt', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
            <div><strong>Username:</strong> {extractedData.username}</div>
            <div><strong>Listings:</strong> {extractedData.listings.toLocaleString()}</div>
            <div><strong>Bids:</strong> {extractedData.bids.toLocaleString()}</div>
            <div><strong>Comments:</strong> {extractedData.comments.toLocaleString()}</div>
            <div><strong>Auction Wins:</strong> {extractedData.auction_wins.toLocaleString()}</div>
            <div><strong>Success Stories:</strong> {extractedData.success_stories.toLocaleString()}</div>
            <div><strong>Member Since:</strong> {extractedData.member_since}</div>
            {extractedData.location && <div><strong>Location:</strong> {extractedData.location}</div>}
            {extractedData.website && <div><strong>Website:</strong> <a href={extractedData.website} target="_blank" rel="noopener noreferrer">{extractedData.website}</a></div>}
          </div>

          <button
            onClick={saveToDatabase}
            disabled={saving}
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-4)',
              fontSize: '8pt',
              fontWeight: 'bold',
              background: saving ? 'var(--text-muted)' : 'var(--success)',
              color: 'var(--white)',
              border: 'none',
              borderRadius: '4px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save to Database'}
          </button>
        </div>
      )}
    </div>
  );
};

