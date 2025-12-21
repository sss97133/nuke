/**
 * Market Data Tools Page
 * Central hub for tools to populate market data and profile information
 */

import React, { useState } from 'react';
import { BaTProfileExtractor } from '../components/market/BaTProfileExtractor';
import { OrganizationServiceMapper } from '../components/market/OrganizationServiceMapper';
import { ExternalIdentityClaimer } from '../components/market/ExternalIdentityClaimer';
import { supabase } from '../lib/supabase';

const OrganizationServiceMapperWithSelector = () => {
  const [orgId, setOrgId] = useState('');
  return (
    <div>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
          Organization ID
        </label>
        <input
          type="text"
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          placeholder="Enter organization UUID"
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
      {orgId && <OrganizationServiceMapper organizationId={orgId} />}
    </div>
  );
};

export default function MarketDataTools() {
  const [activeTool, setActiveTool] = React.useState<'bat' | 'services' | 'claim' | 'backfill'>('bat');
  const [backfilling, setBackfilling] = React.useState(false);
  const [backfillResult, setBackfillResult] = React.useState<any>(null);

  const runBackfill = async (type: 'users' | 'organizations') => {
    setBackfilling(true);
    setBackfillResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('backfill-profile-stats', {
        body: { type: `all_${type}`, batch_size: 100 },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBackfillResult(data);
    } catch (err: any) {
      setBackfillResult({ error: err.message });
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1 style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-4)' }}>
        Market Data Tools
      </h1>
      <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
        Tools to populate profiles with data and extract market information from external sources.
      </p>

      {/* Tool Navigation */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-4)',
        borderBottom: '2px solid var(--border)',
      }}>
        {[
          { key: 'bat', label: 'BaT Profile Extractor' },
          { key: 'services', label: 'Service Mapper' },
          { key: 'claim', label: 'Claim Identity' },
          { key: 'backfill', label: 'Backfill Stats' },
        ].map((tool) => (
          <button
            key={tool.key}
            onClick={() => setActiveTool(tool.key as any)}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              fontSize: '8pt',
              fontWeight: activeTool === tool.key ? 'bold' : 'normal',
              background: activeTool === tool.key ? 'var(--surface)' : 'transparent',
              border: 'none',
              borderBottom: activeTool === tool.key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              color: 'var(--text)',
            }}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {/* Tool Content */}
      <div>
        {activeTool === 'bat' && (
          <BaTProfileExtractor />
        )}

        {activeTool === 'services' && (
          <div>
            <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
              Organization Service Mapper - Navigate to an organization profile to use this tool, or enter organization ID below.
            </p>
            <OrganizationServiceMapperWithSelector />
          </div>
        )}

        {activeTool === 'claim' && (
          <ExternalIdentityClaimer />
        )}

        {activeTool === 'backfill' && (
          <div style={{
            padding: 'var(--space-4)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
          }}>
            <h3 style={{ fontSize: '10pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-3)' }}>
              Backfill Profile Stats
            </h3>
            <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
              Populate profile statistics from existing BaT data. This will update listings, bids, comments, and other stats for all profiles.
            </p>

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <button
                onClick={() => runBackfill('users')}
                disabled={backfilling}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  fontSize: '8pt',
                  fontWeight: 'bold',
                  background: backfilling ? 'var(--text-muted)' : 'var(--accent)',
                  color: 'var(--white)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: backfilling ? 'not-allowed' : 'pointer',
                }}
              >
                {backfilling ? 'Backfilling...' : 'Backfill All Users'}
              </button>
              <button
                onClick={() => runBackfill('organizations')}
                disabled={backfilling}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  fontSize: '8pt',
                  fontWeight: 'bold',
                  background: backfilling ? 'var(--text-muted)' : 'var(--accent)',
                  color: 'var(--white)',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: backfilling ? 'not-allowed' : 'pointer',
                }}
              >
                {backfilling ? 'Backfilling...' : 'Backfill All Organizations'}
              </button>
            </div>

            {backfillResult && (
              <div style={{
                padding: 'var(--space-3)',
                background: backfillResult.error ? 'var(--danger-light)' : 'var(--success-light)',
                border: `1px solid ${backfillResult.error ? 'var(--danger)' : 'var(--success)'}`,
                borderRadius: '4px',
                fontSize: '8pt',
              }}>
                {backfillResult.error ? (
                  <div style={{ color: 'var(--danger)' }}>Error: {backfillResult.error}</div>
                ) : (
                  <div style={{ color: 'var(--success)' }}>
                    Success! Processed {backfillResult.processed} profiles.
                    {backfillResult.results && (
                      <div style={{ marginTop: 'var(--space-2)' }}>
                        <details>
                          <summary style={{ cursor: 'pointer' }}>View Details</summary>
                          <pre style={{ marginTop: 'var(--space-2)', fontSize: '7pt', overflow: 'auto' }}>
                            {JSON.stringify(backfillResult.results, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

