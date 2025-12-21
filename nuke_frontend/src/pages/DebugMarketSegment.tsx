import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);

export default function DebugMarketSegment() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [segment, setSegment] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  useEffect(() => {
    if (slug) {
      loadDebugData();
    }
  }, [slug]);

  const loadDebugData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('Loading segment:', slug);

      // Try to get segment from both sources
      const [segmentResult, indexResult] = await Promise.all([
        supabase.from('market_segments').select('*').eq('slug', slug).maybeSingle(),
        supabase.from('market_segments_index').select('*').eq('slug', slug).maybeSingle()
      ]);

      console.log('Segment result:', segmentResult);
      console.log('Index result:', indexResult);

      const segmentData = segmentResult.data || indexResult.data;
      if (!segmentData) {
        setError(`No segment found with slug: ${slug}`);
        return;
      }

      setSegment(segmentData);

      // Get vehicles for this segment - simplified logic
      let vehicleQuery = supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, location, purchase_location, is_public')
        .eq('is_public', true)
        .not('current_value', 'is', null);

      // Apply filters based on segment
      if (segmentData.year_min) vehicleQuery = vehicleQuery.gte('year', segmentData.year_min);
      if (segmentData.year_max) vehicleQuery = vehicleQuery.lte('year', segmentData.year_max);

      const { data: vehicleData, error: vehicleError } = await vehicleQuery
        .order('current_value', { ascending: false })
        .limit(50);

      if (vehicleError) {
        console.error('Vehicle query error:', vehicleError);
        throw vehicleError;
      }

      console.log('Raw vehicles:', vehicleData?.length);

      // Client-side filtering for make/keywords
      const filtered = (vehicleData || []).filter((v: any) => {
        if (!v.current_value || v.current_value <= 0) return false;
        
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

      console.log('Filtered vehicles:', filtered.length);
      setVehicles(filtered);

      setDebugInfo({
        slug,
        segmentFound: !!segmentData,
        rawVehicleCount: vehicleData?.length || 0,
        filteredVehicleCount: filtered.length,
        segmentCriteria: {
          year_min: segmentData.year_min,
          year_max: segmentData.year_max,
          makes: segmentData.makes,
          model_keywords: segmentData.model_keywords
        }
      });

    } catch (e: any) {
      console.error('Debug load error:', e);
      setError(e?.message || 'Failed to load segment');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
            Loading segment "{slug}"...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Error Loading Segment</h3>
            </div>
            <div className="card-body">
              <div style={{ color: 'var(--danger, #ef4444)', fontSize: '9pt', marginBottom: '16px' }}>
                {error}
              </div>
              {debugInfo && (
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  <strong>Debug Info:</strong><br/>
                  Slug: {debugInfo.slug}<br/>
                  Segment Found: {debugInfo.segmentFound ? 'Yes' : 'No'}<br/>
                  Raw Vehicles: {debugInfo.rawVehicleCount}<br/>
                  Filtered Vehicles: {debugInfo.filteredVehicleCount}<br/>
                  Criteria: {JSON.stringify(debugInfo.segmentCriteria, null, 2)}
                </div>
              )}
              <div style={{ marginTop: '16px' }}>
                <button className="button button-secondary" onClick={() => navigate('/market')}>
                  Back to Market
                </button>
              </div>
            </div>
          </div>
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
            <h1 style={{ margin: 0, fontSize: '16pt', fontWeight: 900 }}>
              {segment?.name || 'Market Segment'}
            </h1>
            <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              {vehicles.length} vehicles • {formatUSD(totalValue)} total value
            </div>
            {segment?.description && (
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

        {/* Debug Info */}
        {debugInfo && (
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-header">
              <h3 className="heading-3">Debug Information</h3>
            </div>
            <div className="card-body">
              <pre style={{ fontSize: '8pt', background: 'var(--surface)', padding: '12px', borderRadius: '4px', overflow: 'auto' }}>
                {JSON.stringify(debugInfo, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Contract Overview */}
        <div style={{ marginBottom: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Contract Vehicles</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>{vehicles.length}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Real underlying assets</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Total Value</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD(totalValue)}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Market capitalization</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Year Focus</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>
                {segment?.year_min || 'Any'}{segment?.year_min !== segment?.year_max ? `-${segment?.year_max}` : ''}
              </div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Target years</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Average Value</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>
                {vehicles.length > 0 ? formatUSD(totalValue / vehicles.length) : '$0'}
              </div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Per vehicle</div>
            </div>
          </div>
        </div>

        {/* Real Vehicles in Contract */}
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Real Vehicles in ETF Contract</h3>
          </div>
          <div className="card-body">
            {vehicles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                No vehicles currently match this segment criteria.
                <div style={{ marginTop: '8px', fontSize: '8pt' }}>
                  Criteria: Year {segment?.year_min}-{segment?.year_max}, 
                  Makes: {segment?.makes?.join(', ') || 'Any'}, 
                  Keywords: {segment?.model_keywords?.join(', ') || 'None'}
                </div>
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
                  <div>% OF ETF</div>
                  <div>ACTION</div>
                </div>
                
                {vehicles.map((vehicle) => {
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
                          ID: {vehicle.id.slice(-8)}
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

        {/* ETF Investment Terms */}
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-header">
            <h3 className="heading-3">ETF Investment Terms</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Contract Structure</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  • <strong>Legal Entity:</strong> Market Segment Fund<br/>
                  • <strong>Share Class:</strong> Common investment shares<br/>
                  • <strong>Management:</strong> AI-optimized portfolio<br/>
                  • <strong>Rebalancing:</strong> Automated based on criteria<br/>
                  • <strong>Liquidity:</strong> Daily NAV-based trading
                </div>
              </div>
              
              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Investment Details</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  • <strong>Minimum Investment:</strong> $100<br/>
                  • <strong>Management Fee:</strong> 0.10% annually<br/>
                  • <strong>Transaction Fee:</strong> 0.05% per trade<br/>
                  • <strong>Settlement:</strong> T+1 business day<br/>
                  • <strong>Distributions:</strong> Quarterly if applicable
                </div>
              </div>
            </div>
            
            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <button 
                className="button button-primary"
                onClick={() => navigate('/market/exchange/Y79')}
                style={{ padding: '12px 24px', fontSize: '10pt' }}
              >
                INVEST IN {segment?.name || 'ETF'} NOW
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
