import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface SimpleETFDetailsProps {
  segmentSlug: string;
}

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);

export default function SimpleETFDetails({ segmentSlug }: SimpleETFDetailsProps) {
  const navigate = useNavigate();
  const [segment, setSegment] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [segmentSlug]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get segment directly from market_segments table
      const { data: segmentData, error: segmentError } = await supabase
        .from('market_segments')
        .select('*')
        .eq('slug', segmentSlug)
        .single();

      if (segmentError) {
        console.error('Segment error:', segmentError);
        throw segmentError;
      }

      setSegment(segmentData);

      // Get all vehicles and filter client-side
      const { data: allVehicles, error: vehicleError } = await supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, location, purchase_location, is_public')
        .eq('is_public', true)
        .not('current_value', 'is', null);

      if (vehicleError) throw vehicleError;

      // Filter vehicles based on segment criteria
      const filtered = (allVehicles || []).filter((v: any) => {
        if (!v.current_value || v.current_value <= 0) return false;
        
        // Year filter
        if (segmentData.year_min && v.year < segmentData.year_min) return false;
        if (segmentData.year_max && v.year > segmentData.year_max) return false;
        
        // Make filter
        if (segmentData.makes && segmentData.makes.length > 0) {
          const makeMatch = segmentData.makes.some((make: string) => 
            v.make.toUpperCase().includes(make.toUpperCase())
          );
          if (!makeMatch) return false;
        }
        
        // Keyword filter
        if (segmentData.model_keywords && segmentData.model_keywords.length > 0) {
          const keywordMatch = segmentData.model_keywords.some((keyword: string) =>
            v.model.toUpperCase().includes(keyword.toUpperCase())
          );
          if (!keywordMatch) return false;
        }
        
        return true;
      });

      setVehicles(filtered);
    } catch (e: any) {
      console.error('Failed to load ETF details:', e);
      setError(e?.message || 'Failed to load segment details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading ETF contract details...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: 'var(--danger, #ef4444)', fontSize: '9pt' }}>
        Error loading segment: {error}
        <div style={{ marginTop: '10px' }}>
          <button className="button button-secondary" onClick={() => navigate('/market')}>
            Back to Market
          </button>
        </div>
      </div>
    );
  }

  if (!segment) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Segment not found: {segmentSlug}
        <div style={{ marginTop: '10px' }}>
          <button className="button button-secondary" onClick={() => navigate('/market')}>
            Back to Market
          </button>
        </div>
      </div>
    );
  }

  const totalValue = vehicles.reduce((sum, v) => sum + Number(v.current_value || 0), 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '16pt', fontWeight: 900 }}>{segment.name}</h1>
            <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              ETF Contract Details - {vehicles.length} underlying vehicles
            </div>
            {segment.description && (
              <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                {segment.description}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="button button-primary" onClick={() => navigate('/market/exchange/Y79')}>
              INVEST IN Y79 ETF
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market')}>
              Back to Market
            </button>
          </div>
        </div>

        {/* Contract Summary */}
        <div style={{ marginBottom: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Total Vehicles</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>{vehicles.length}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Real vehicles in contract</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Market Cap</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD(totalValue)}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Total vehicle value</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Year Focus</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>1979</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Collector vintage year</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">ETF Symbol</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>Y79</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Trading symbol</div>
            </div>
          </div>
        </div>

        {/* Contract Terms */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <h3 className="heading-3">Investment Contract Terms</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Legal Structure</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px', marginBottom: '12px' }}>
                  • <strong>Entity Type:</strong> Market Segment Fund (Limited Partnership)<br/>
                  • <strong>Securities Class:</strong> Investment Fund Shares<br/>
                  • <strong>Management:</strong> AI-managed portfolio optimization<br/>
                  • <strong>Custody:</strong> Platform holds underlying vehicle titles<br/>
                  • <strong>Liquidity:</strong> Daily redemption at NAV
                </div>

                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Investment Criteria</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  <strong>Year Range:</strong> {segment.year_min || 'Any'} - {segment.year_max || 'Any'}<br/>
                  <strong>Makes:</strong> {segment.makes?.join(', ') || 'All manufacturers'}<br/>
                  <strong>Keywords:</strong> {segment.model_keywords?.join(', ') || 'No restrictions'}<br/>
                  <strong>Requirements:</strong> Public visibility, verified ownership
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Fee Structure</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px', marginBottom: '12px' }}>
                  • <strong>Management Fee:</strong> 0.10% annually<br/>
                  • <strong>Performance Fee:</strong> 10% above 8% annual return<br/>
                  • <strong>Transaction Fee:</strong> 0.05% per trade<br/>
                  • <strong>Minimum Investment:</strong> $100<br/>
                  • <strong>Early Exit:</strong> No penalties
                </div>

                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Risk Factors</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  • <strong>Market Risk:</strong> Vehicle values may decline<br/>
                  • <strong>Concentration Risk:</strong> Single model year exposure<br/>
                  • <strong>Liquidity Risk:</strong> Small underlying market<br/>
                  • <strong>Vintage Risk:</strong> Age-related deterioration possible
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Underlying Vehicles */}
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Underlying Assets - Real Vehicles</h3>
          </div>
          <div className="card-body">
            {vehicles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                No vehicles currently match this segment criteria.
              </div>
            ) : (
              <div>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '2fr 1fr 2fr 1fr 100px',
                  gap: '12px',
                  fontSize: '9pt',
                  fontWeight: 700,
                  padding: '12px 8px',
                  borderBottom: '2px solid var(--border)',
                  color: 'var(--text-muted)',
                  marginBottom: '12px'
                }}>
                  <div>VEHICLE</div>
                  <div>VALUE</div>
                  <div>LOCATION</div>
                  <div>% OF FUND</div>
                  <div>ACTION</div>
                </div>
                
                {vehicles.map((vehicle, index) => {
                  const fundPercentage = totalValue > 0 ? (Number(vehicle.current_value) / totalValue * 100) : 0;
                  const location = vehicle.location || vehicle.purchase_location || 'Location not specified';
                  
                  return (
                    <div
                      key={vehicle.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 2fr 1fr 100px',
                        gap: '12px',
                        fontSize: '9pt',
                        padding: '12px 8px',
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '10pt' }}>
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '8pt', marginTop: '2px' }}>
                          Vehicle ID: {vehicle.id.slice(-8)}
                        </div>
                      </div>
                      
                      <div style={{ fontWeight: 700 }}>
                        {formatUSD(Number(vehicle.current_value))}
                      </div>
                      
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {location}
                      </div>
                      
                      <div style={{ fontWeight: 700 }}>
                        {fundPercentage.toFixed(1)}%
                      </div>
                      
                      <div>
                        <button
                          onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                          style={{
                            padding: '4px 8px',
                            border: '1px solid var(--primary)',
                            borderRadius: '2px',
                            background: 'var(--primary)',
                            color: 'var(--white)',
                            fontSize: '8pt',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          VIEW
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Investment Decision */}
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-header">
            <h3 className="heading-3">Investment Summary</h3>
          </div>
          <div className="card-body">
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px', marginBottom: '16px' }}>
              This ETF provides diversified exposure to {vehicles.length} vehicles from {segment.year_min || 'various'} 
              {segment.year_min !== segment.year_max ? `-${segment.year_max}` : ''} with a total market capitalization 
              of {formatUSD(totalValue)}. The fund is managed automatically and provides daily liquidity.
            </div>
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button 
                className="button button-primary"
                onClick={() => navigate('/market/exchange/Y79')}
                style={{ padding: '12px 24px' }}
              >
                INVEST IN Y79 ETF
              </button>
              <button 
                className="button button-secondary"
                onClick={() => navigate('/market')}
              >
                Back to Market
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
