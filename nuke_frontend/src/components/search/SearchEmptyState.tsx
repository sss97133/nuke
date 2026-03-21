import React from 'react';
import VehicleCardDense from '../vehicles/VehicleCardDense';
import type { FeaturedVehicle, MakeCount } from '../../hooks/useSearchEmptyState';

const ERA_FACETS = [
  { label: 'PRE-WAR', query: 'pre-war' },
  { label: 'CLASSIC', query: 'classic' },
  { label: 'MUSCLE', query: 'muscle car' },
  { label: 'MALAISE', query: 'malaise era' },
  { label: 'MODERN CLASSIC', query: 'modern classic' },
  { label: 'MODERN', query: 'modern' },
];

const BODY_FACETS = [
  { label: 'TRUCK', query: 'truck' },
  { label: 'COUPE', query: 'coupe' },
  { label: 'CONVERTIBLE', query: 'convertible' },
  { label: 'SEDAN', query: 'sedan' },
  { label: 'SUV', query: 'suv' },
  { label: 'WAGON', query: 'wagon' },
];

const SEARCH_TIPS = [
  { example: '"1973 Porsche 911"', desc: 'Year + make + model' },
  { example: '"WP0AA2A95ES123456"', desc: 'Exact VIN lookup' },
  { example: '"muscle car under 50k"', desc: 'Natural language + price' },
  { example: '"red convertible 1960-1970"', desc: 'Color + body + year range' },
];

const pillStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '11px',
  fontWeight: 600,
  border: '2px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  cursor: 'pointer',
  transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

interface Props {
  recentVehicles: FeaturedVehicle[];
  notableSales: FeaturedVehicle[];
  topMakes: MakeCount[];
  totalCount: number;
  loading: boolean;
}

export const SearchEmptyState: React.FC<Props> = ({
  recentVehicles, notableSales, topMakes, totalCount, loading,
}) => {
  if (loading) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ padding: '0 0 48px' }}>
      {/* Total count + search tips */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '24px',
        alignItems: 'flex-start', marginBottom: '24px',
      }}>
        {/* Vehicle count hero */}
        {totalCount > 0 && (
          <div>
            <div style={{
              fontSize: '32px', fontWeight: 800, fontFamily: "'Courier New', monospace",
              color: 'var(--text)', lineHeight: 1,
            }}>
              {totalCount.toLocaleString()}
            </div>
            <div style={{
              fontSize: '8px', fontWeight: 800, letterSpacing: '1px',
              color: 'var(--text-disabled)', textTransform: 'uppercase',
            }}>
              VEHICLES INDEXED
            </div>
          </div>
        )}

        {/* Search tips */}
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{
            fontSize: '8px', fontWeight: 800, letterSpacing: '0.5px',
            color: 'var(--text-disabled)', textTransform: 'uppercase',
            marginBottom: '6px',
          }}>
            TRY SEARCHING
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {SEARCH_TIPS.map(tip => (
              <a
                key={tip.example}
                href={`/search?q=${encodeURIComponent(tip.example.replace(/"/g, ''))}`}
                style={{
                  padding: '4px 10px',
                  fontSize: '10px',
                  fontFamily: "'Courier New', monospace",
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                }}
                title={tip.desc}
              >
                {tip.example}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Browse by Make */}
      {topMakes.length > 0 && (
        <FacetSection title="BROWSE BY MAKE">
          {topMakes.map(({ make, count }) => (
            <a key={make} href={`/search?q=${encodeURIComponent(make)}`} style={pillStyle}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
              {make}
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: '9px', marginLeft: '6px', opacity: 0.6 }}>
                {count.toLocaleString()}
              </span>
            </a>
          ))}
        </FacetSection>
      )}

      {/* Browse by Era */}
      <FacetSection title="BROWSE BY ERA">
        {ERA_FACETS.map(({ label, query }) => (
          <a key={label} href={`/search?q=${encodeURIComponent(query)}`} style={pillStyle}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
            {label}
          </a>
        ))}
      </FacetSection>

      {/* Browse by Body Style */}
      <FacetSection title="BROWSE BY BODY STYLE">
        {BODY_FACETS.map(({ label, query }) => (
          <a key={label} href={`/search?q=${encodeURIComponent(query)}`} style={pillStyle}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
            {label}
          </a>
        ))}
      </FacetSection>

      {/* Notable Sales */}
      {notableSales.length > 0 && (
        <VehicleGrid title="NOTABLE SALES" vehicles={notableSales} />
      )}

      {/* Recently Added */}
      {recentVehicles.length > 0 && (
        <VehicleGrid title="RECENTLY ADDED" vehicles={recentVehicles} />
      )}
    </div>
  );
};

function FacetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: '9px', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '1px',
        color: 'var(--text-disabled)',
        marginBottom: '10px',
        borderBottom: '2px solid var(--border)', paddingBottom: '4px',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {children}
      </div>
    </div>
  );
}

function VehicleGrid({ title, vehicles }: {
  title: string;
  vehicles: FeaturedVehicle[];
}) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: '9px', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '1px',
        color: 'var(--text-disabled)',
        marginBottom: '10px',
        borderBottom: '2px solid var(--border)', paddingBottom: '4px',
      }}>
        {title}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '12px',
      }}>
        {vehicles.map(v => (
          <VehicleCardDense
            key={v.id}
            vehicle={{
              id: v.id,
              year: v.year ?? undefined,
              make: v.make ?? undefined,
              model: v.model ?? undefined,
              primary_image_url: v.primary_image_url ?? undefined,
              sale_price: v.sale_price ?? undefined,
            }}
            viewMode="gallery"
            showSocial={false}
            showPriceChange={false}
            showPriceOverlay={true}
            showDetailOverlay={true}
            infoDense={true}
            thumbnailFit="contain"
          />
        ))}
      </div>
    </div>
  );
}
