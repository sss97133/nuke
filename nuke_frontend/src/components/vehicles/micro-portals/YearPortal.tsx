import React from 'react';
import MicroPortal from './MicroPortal';
import PortalShell from './PortalShell';
import { useYearMarketStats } from '../../../hooks/useMarketStats';
import { formatCurrencyAmount } from '../../../utils/currency';

interface YearPortalProps {
  year: number;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

export default function YearPortal({ year, activePortal, onOpen }: YearPortalProps) {
  const isOpen = activePortal === 'year';
  const { data, state, isLoading, error } = useYearMarketStats(year, isOpen);

  return (
    <MicroPortal
      portalId="year"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={<span>{year}</span>}
      width={260}
    >
      <PortalShell
        title={`${year} Market`}
        isLoading={isLoading}
        error={error}
        state={state}
        emptyContent={
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '8px 0' }}>
            No {year} vehicles tracked yet
          </div>
        }
        sparseContent={data && (
          <div style={{ fontSize: '11px' }}>
            <StatRow label="Listings" value={data.total_listings} />
            {data.avg_price > 0 && <StatRow label="Avg Price" value={formatCurrencyAmount(data.avg_price)} />}
          </div>
        )}
        richContent={data && (
          <div style={{ fontSize: '11px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              <StatBox label="Listings" value={String(data.total_listings)} />
              <StatBox label="Avg Price" value={data.avg_price > 0 ? formatCurrencyAmount(data.avg_price) : '—'} />
              <StatBox label="Median" value={data.median_price > 0 ? formatCurrencyAmount(data.median_price) : '—'} />
              <StatBox label="Sell-Through" value={`${Math.round(data.sell_through_pct)}%`} />
            </div>
            {data.top_makes && data.top_makes.length > 0 && (
              <div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '4px' }}>Top Makes</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                  {data.top_makes.slice(0, 6).map((m) => (
                    <span key={m.make} style={{
                      padding: '1px 5px',
                      background: 'var(--bg-secondary, #f3f4f6)',
                      borderRadius: '3px',
                      fontSize: '9px',
                    }}>
                      {m.make} ({m.count})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      />
    </MicroPortal>
  );
}

function StatRow({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '4px 6px', background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '4px' }}>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: '12px' }}>{value}</div>
    </div>
  );
}
