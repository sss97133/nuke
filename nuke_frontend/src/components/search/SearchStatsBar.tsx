import React, { useState } from 'react';
import type { BrowseStats } from '../../hooks/useSearchPage';

interface Props {
  stats: BrowseStats;
  make: string;
}

export const SearchStatsBar: React.FC<Props> = ({ stats, make }) => {
  const [expanded, setExpanded] = useState(false);

  if (!stats || stats.total === 0) return null;

  const fmtPrice = (n: number) =>
    n >= 1000 ? `$${Math.round(n / 1000).toLocaleString()}k` : `$${n.toLocaleString()}`;

  return (
    <div style={{ marginBottom: '16px' }}>
      {/* Compact stats bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          alignItems: 'center',
          padding: '8px 12px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <StatCell label="TOTAL" value={stats.total.toLocaleString()} />
        <StatCell label="WITH PHOTOS" value={stats.with_images.toLocaleString()} />
        {stats.with_price > 0 && (
          <StatCell label="WITH PRICE" value={stats.with_price.toLocaleString()} />
        )}
        <div style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--text-muted)' }}>
          {expanded ? 'COLLAPSE' : 'EXPAND'}
        </div>
      </div>

      {/* Expanded: model breakdown + sources + eras */}
      {expanded && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginTop: '8px',
        }}>
          {/* Top Models */}
          {stats.by_model && stats.by_model.length > 0 && (
            <StatSection title={`${make} MODELS`}>
              {stats.by_model.slice(0, 8).map((m: any) => (
                <div key={m.model} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '3px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <a
                    href={`/search?q=${encodeURIComponent(make + ' ' + m.model)}`}
                    style={{ fontSize: '11px', color: 'var(--text)', textDecoration: 'none', fontWeight: 600 }}
                  >
                    {m.model}
                  </a>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                      {m.count}
                    </span>
                  </div>
                </div>
              ))}
            </StatSection>
          )}

          {/* By Source */}
          {stats.by_source && stats.by_source.length > 0 && (
            <StatSection title="SOURCES">
              {stats.by_source.slice(0, 6).map((s: any) => (
                <div key={s.source} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '3px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: '11px', color: 'var(--text)' }}>
                    {s.source || 'Unknown'}
                  </span>
                  <span style={{
                    fontSize: '9px', fontFamily: "'Courier New', monospace",
                    color: 'var(--text-muted)',
                  }}>
                    {s.count}
                  </span>
                </div>
              ))}
            </StatSection>
          )}

          {/* By Era */}
          {stats.by_era && stats.by_era.length > 0 && (
            <StatSection title="ERAS">
              {stats.by_era.map((e: any) => (
                <div key={e.era} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '3px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <a
                    href={`/search?q=${encodeURIComponent(make + ' ' + e.era)}`}
                    style={{ fontSize: '11px', color: 'var(--text)', textDecoration: 'none' }}
                  >
                    {e.era || 'Unclassified'}
                  </a>
                  <span style={{
                    fontSize: '9px', fontFamily: "'Courier New', monospace",
                    color: 'var(--text-muted)',
                  }}>
                    {e.count}
                  </span>
                </div>
              ))}
            </StatSection>
          )}
        </div>
      )}
    </div>
  );
};

function StatCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{
        fontSize: '8px', fontWeight: 800, letterSpacing: '0.5px',
        color: 'var(--text-disabled)', textTransform: 'uppercase',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '14px', fontWeight: 700, color: 'var(--text)',
        fontFamily: mono ? "'Courier New', monospace" : 'Arial, sans-serif',
      }}>
        {value}
      </div>
    </div>
  );
}

function StatSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
    }}>
      <div style={{
        fontSize: '8px', fontWeight: 800, letterSpacing: '0.5px',
        color: 'var(--text-disabled)', textTransform: 'uppercase',
        marginBottom: '6px', paddingBottom: '4px',
        borderBottom: '2px solid var(--border)',
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}
