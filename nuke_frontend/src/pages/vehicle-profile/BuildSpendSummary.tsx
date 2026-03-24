import React from 'react';
import type { SpendProfile } from './hooks/useBuildProfile';

interface Props {
  spendProfile: SpendProfile;
  manifestStats: { total: number; purchased: number; priced: number; totalValue: number; purchasedPct: number };
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const BuildSpendSummary: React.FC<Props> = ({ spendProfile, manifestStats }) => {
  const topVendors = (spendProfile.by_vendor || []).slice(0, 6);

  return (
    <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: 1.6 }}>
      {/* Top row: big numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px', marginBottom: '8px' }}>
        <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>TOTAL SPEND</div>
          <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(spendProfile.total_documented_spend)}</div>
        </div>
        <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>HIGH CONF</div>
          <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(spendProfile.high_confidence_spend)}</div>
        </div>
        <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>TRANSACTIONS</div>
          <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{spendProfile.total_transactions}</div>
        </div>
      </div>

      {/* Manifest progress */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>MANIFEST COVERAGE</span>
          <span style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '8px' }}>{manifestStats.purchased}/{manifestStats.total} PURCHASED · {manifestStats.purchasedPct}%</span>
        </div>
        <div style={{ height: '4px', background: 'var(--vp-bg-alt, #f0f0f0)', border: '2px solid var(--vp-border)' }}>
          <div style={{
            height: '100%',
            width: `${manifestStats.purchasedPct}%`,
            background: 'var(--vp-ink)',
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Top vendors */}
      {topVendors.length > 0 && (
        <div>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '2px' }}>TOP VENDORS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1px 8px', fontFamily: 'var(--vp-font-mono)', fontSize: '8px' }}>
            {topVendors.map(v => (
              <React.Fragment key={v.vendor}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.vendor}</span>
                <span style={{ textAlign: 'right' }}>{fmt(v.spend)}</span>
                <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>{v.count}x</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BuildSpendSummary;
