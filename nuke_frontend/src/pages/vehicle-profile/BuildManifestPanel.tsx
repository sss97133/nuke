import React, { useState } from 'react';
import type { ManifestDevice } from './hooks/useBuildProfile';

interface Props {
  manifestByCategory: Record<string, ManifestDevice[]>;
  manifestStats: { total: number; purchased: number; priced: number; totalValue: number; purchasedPct: number };
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const STATUS_COLORS: Record<string, string> = {
  purchased: 'var(--vp-brg, #006847)',
  installed: 'var(--vp-gulf-blue, #001f5b)',
  sourced: 'var(--vp-gulf-orange, #f48024)',
  identified: 'var(--vp-pencil, #888)',
};

const statusBadge = (device: ManifestDevice) => {
  const label = device.purchased ? 'PURCHASED' : (device.status || 'IDENTIFIED');
  const color = device.purchased ? STATUS_COLORS.purchased : (STATUS_COLORS[label.toLowerCase()] || STATUS_COLORS.identified);
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 4px',
      fontSize: '7px',
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      border: `1px solid ${color}`,
      color,
      fontFamily: 'var(--vp-font-mono)',
    }}>
      {label}
    </span>
  );
};

const confidenceDot = (device: ManifestDevice) => {
  const pct = device.pct_complete || 0;
  const color = pct >= 80 ? 'var(--vp-brg, #006847)' : pct >= 50 ? 'var(--vp-gulf-orange, #f48024)' : 'var(--vp-martini-red, #c62828)';
  return (
    <span style={{
      display: 'inline-block',
      width: '6px',
      height: '6px',
      background: color,
      flexShrink: 0,
    }} title={`${pct}% complete`} />
  );
};

const BuildManifestPanel: React.FC<Props> = ({ manifestByCategory, manifestStats }) => {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const categories = Object.keys(manifestByCategory).sort();

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px' }}>
      {/* Category groups */}
      {categories.map(cat => {
        const devices = manifestByCategory[cat];
        const catPurchased = devices.filter(d => d.purchased).length;
        const isExpanded = expandedCats.has(cat);
        return (
          <div key={cat} style={{ marginBottom: '4px' }}>
            <div
              onClick={() => toggleCat(cat)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '3px 6px', cursor: 'pointer',
                border: '2px solid var(--vp-border)',
                background: isExpanded ? 'var(--vp-bg-alt, #fafafa)' : 'transparent',
                userSelect: 'none',
              }}
            >
              <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {isExpanded ? '▾' : '▸'} {cat}
              </span>
              <span style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '8px', color: 'var(--vp-pencil)' }}>
                {catPurchased}/{devices.length}
              </span>
            </div>
            {isExpanded && (
              <div style={{ borderLeft: '2px solid var(--vp-border)', borderRight: '2px solid var(--vp-border)', borderBottom: '2px solid var(--vp-border)' }}>
                {devices.map(d => (
                  <div key={d.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '6px 1fr auto auto',
                    gap: '4px 6px',
                    alignItems: 'center',
                    padding: '3px 6px',
                    borderBottom: '1px solid var(--vp-bg-alt, #f0f0f0)',
                    fontSize: '8px',
                  }}>
                    {confidenceDot(d)}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.device_name}
                      {d.manufacturer && <span style={{ color: 'var(--vp-pencil)', marginLeft: '4px' }}>({d.manufacturer})</span>}
                    </span>
                    {statusBadge(d)}
                    <span style={{ fontFamily: 'var(--vp-font-mono)', textAlign: 'right', minWidth: '40px' }}>
                      {d.price != null ? fmt(d.price) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default BuildManifestPanel;
