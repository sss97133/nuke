import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface ContractVehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  current_value: number;
  location: string;
  ownership_verified: boolean;
  image_count: number;
  last_activity: string;
  contract_type: 'funding_round' | 'shares_trading' | 'for_sale' | 'bonded' | 'none';
  contract_details: any;
}

interface ETFContract {
  symbol: string;
  name: string;
  description: string;
  segment_id: string;
  nav_per_share: number;
  total_aum: number;
  total_shares_outstanding: number;
  inception_date: string;
  total_vehicles: number;
  total_market_cap: number;
  management_type: 'ai' | 'human';
  vehicles: ContractVehicle[];
}

interface ETFContractDetailsProps {
  segmentSlug: string;
}

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);

const formatUSD2 = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatLocation = (location: string | null, purchaseLocation: string | null) => {
  const loc = location || purchaseLocation;
  if (!loc) return 'Location unspecified';
  
  if (loc.includes('latitude')) {
    try {
      const coords = JSON.parse(loc);
      return `${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`;
    } catch {
      return loc;
    }
  }
  
  if (loc.includes(',') && loc.match(/^-?\d+\.?\d*, -?\d+\.?\d*$/)) {
    const [lat, lng] = loc.split(',').map(s => parseFloat(s.trim()));
    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
  
  return loc;
};

const getContractStatusColor = (status: string) => {
  switch (status) {
    case 'funding_round': return 'var(--warning, #f59e0b)';
    case 'shares_trading': return 'var(--success, #10b981)';
    case 'for_sale': return 'var(--info, #3b82f6)';
    case 'bonded': return 'var(--purple, #8b5cf6)';
    default: return 'var(--text-muted)';
  }
};

const getContractLabel = (status: string) => {
  switch (status) {
    case 'funding_round': return 'FUNDING ACTIVE';
    case 'shares_trading': return 'SHARES TRADING';
    case 'for_sale': return 'FOR SALE';
    case 'bonded': return 'BOND ISSUED';
    default: return 'NO CONTRACTS';
  }
};

export default function ETFContractDetails({ segmentSlug }: ETFContractDetailsProps) {
  const navigate = useNavigate();
  const [contract, setContract] = useState<ETFContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterContract, setFilterContract] = useState<string>('all');

  useEffect(() => {
    loadContractDetails();
  }, [segmentSlug]);

  const loadContractDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get segment and fund details
      const { data: segmentData, error: segmentError } = await supabase
        .from('market_segments_index')
        .select('*')
        .eq('slug', segmentSlug)
        .maybeSingle();

      if (segmentError) {
        console.error('Segment query error:', segmentError);
        throw segmentError;
      }
      
      if (!segmentData) {
        console.error('No segment data found for slug:', segmentSlug);
        setError(`Segment "${segmentSlug}" not found`);
        return;
      }

      // Get vehicles in this segment
      const segment = segmentData;
      
      // Build vehicle query based on segment criteria
      let vehicleQuery = supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          current_value,
          location,
          purchase_location,
          ownership_verified,
          user_id,
          created_at,
          updated_at
        `)
        .eq('is_public', true)
        .not('current_value', 'is', null);

      // Apply segment filters
      if (segment.year_min) vehicleQuery = vehicleQuery.gte('year', segment.year_min);
      if (segment.year_max) vehicleQuery = vehicleQuery.lte('year', segment.year_max);

      const { data: vehicles, error: vehicleError } = await vehicleQuery
        .order('current_value', { ascending: false })
        .limit(100);

      if (vehicleError) throw vehicleError;

      // Filter vehicles by make and keywords (client-side for complex logic)
      const filteredVehicles = (vehicles || []).filter((v: any) => {
        const makeMatch = !segment.makes || segment.makes.some((make: string) => 
          v.make.toUpperCase().includes(make.toUpperCase())
        );
        
        const keywordMatch = !segment.model_keywords || segment.model_keywords.some((keyword: string) =>
          v.model.toUpperCase().includes(keyword.toUpperCase())
        );

        return makeMatch && keywordMatch && v.current_value > 0;
      });

      // Get contract information for each vehicle
      const vehicleIds = filteredVehicles.map((v: any) => v.id);
      
      const [fundingRounds, offerings, bonds, listings, imageCounts] = await Promise.all([
        supabase.from('vehicle_funding_rounds').select('vehicle_id, status, target_amount_cents, profit_share_pct').in('vehicle_id', vehicleIds),
        supabase.from('vehicle_offerings').select('vehicle_id, status, current_share_price, total_shares').in('vehicle_id', vehicleIds),
        supabase.from('vehicle_bonds').select('vehicle_id, status, principal_cents, interest_rate').in('vehicle_id', vehicleIds),
        supabase.from('market_listings').select('vehicle_id, status, asking_price').in('vehicle_id', vehicleIds),
        supabase.from('vehicle_images').select('vehicle_id').in('vehicle_id', vehicleIds)
      ]);

      // Create lookup maps
      const fundingMap = new Map((fundingRounds.data || []).map(f => [f.vehicle_id, f]));
      const offeringsMap = new Map((offerings.data || []).map(o => [o.vehicle_id, o]));
      const bondsMap = new Map((bonds.data || []).map(b => [b.vehicle_id, b]));
      const listingsMap = new Map((listings.data || []).map(l => [l.vehicle_id, l]));
      
      const imageCountMap = (imageCounts.data || []).reduce((acc: any, img: any) => {
        acc[img.vehicle_id] = (acc[img.vehicle_id] || 0) + 1;
        return acc;
      }, {});

      // Build contract vehicles
      const contractVehicles: ContractVehicle[] = filteredVehicles.map((v: any) => {
        let contractType: ContractVehicle['contract_type'] = 'none';
        let contractDetails = null;

        if (fundingMap.has(v.id)) {
          contractType = 'funding_round';
          contractDetails = fundingMap.get(v.id);
        } else if (offeringsMap.has(v.id)) {
          contractType = 'shares_trading';
          contractDetails = offeringsMap.get(v.id);
        } else if (bondsMap.has(v.id)) {
          contractType = 'bonded';
          contractDetails = bondsMap.get(v.id);
        } else if (listingsMap.has(v.id)) {
          contractType = 'for_sale';
          contractDetails = listingsMap.get(v.id);
        }

        return {
          id: v.id,
          year: v.year,
          make: v.make,
          model: v.model,
          current_value: Number(v.current_value),
          location: formatLocation(v.location, v.purchase_location),
          ownership_verified: Boolean(v.ownership_verified),
          image_count: imageCountMap[v.id] || 0,
          last_activity: v.updated_at || v.created_at,
          contract_type: contractType,
          contract_details: contractDetails
        };
      });

      const etfContract: ETFContract = {
        symbol: segment.fund_symbol || 'N/A',
        name: segment.name,
        description: segment.description || '',
        segment_id: segment.segment_id,
        nav_per_share: Number(segment.nav_share_price || 0),
        total_aum: Number(segment.total_aum_usd || 0),
        total_shares_outstanding: Number(segment.total_shares_outstanding || 0),
        inception_date: segment.created_at || new Date().toISOString(),
        total_vehicles: contractVehicles.length,
        total_market_cap: contractVehicles.reduce((sum, v) => sum + v.current_value, 0),
        management_type: segment.manager_type || 'ai',
        vehicles: contractVehicles
      };

      setContract(etfContract);
    } catch (e: any) {
      console.error('Failed to load contract details:', e);
      setError(e?.message || 'Failed to load contract details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading contract details...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: 'var(--danger, #ef4444)', fontSize: '9pt' }}>
        Error: {error}
      </div>
    );
  }

  if (!contract) return null;

  const filteredVehicles = filterContract === 'all' 
    ? contract.vehicles 
    : contract.vehicles.filter(v => v.contract_type === filterContract);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '16pt', fontWeight: 900 }}>{contract.symbol} ETF Contract</h1>
            <div style={{ marginTop: '6px', fontSize: '11pt', fontWeight: 700 }}>{contract.name}</div>
            <div style={{ marginTop: '6px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              Complete investment contract details and underlying assets
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="button button-primary" onClick={() => navigate(`/market/exchange/${contract.symbol}`)}>
              INVEST NOW
            </button>
            <button className="button button-secondary" onClick={() => navigate('/market')}>
              Back to Market
            </button>
          </div>
        </div>

        {/* Contract Summary */}
        <div style={{ marginBottom: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Fund Size</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD(contract.total_aum)}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Assets Under Management</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Share Price</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD2(contract.nav_per_share)}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Current NAV</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Total Vehicles</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>{contract.total_vehicles}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Underlying assets</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="heading-3">Market Cap</h3></div>
            <div className="card-body">
              <div style={{ fontSize: '18pt', fontWeight: 900 }}>{formatUSD(contract.total_market_cap)}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '4px' }}>Total vehicle value</div>
            </div>
          </div>
        </div>

        {/* Legal & Contract Terms */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <h3 className="heading-3">Legal Structure & Investment Terms</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '10pt' }}>Legal Structure</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  <strong>Entity:</strong> Market Segment Fund LP<br/>
                  <strong>Securities:</strong> Investment Fund Shares<br/>
                  <strong>Custody:</strong> Platform-held vehicle titles<br/>
                  <strong>Governance:</strong> Proportional voting<br/>
                  <strong>Liquidity:</strong> Daily NAV redemption<br/>
                  <strong>Regulation:</strong> SEC-compliant structure
                </div>
              </div>
              
              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '10pt' }}>Fee Structure</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  <strong>Management Fee:</strong> 0.10% annually<br/>
                  <strong>Performance Fee:</strong> 10% above 8% return<br/>
                  <strong>Transaction Fee:</strong> 0.05% per trade<br/>
                  <strong>Minimum Account:</strong> $25 annual<br/>
                  <strong>Redemption Fee:</strong> None<br/>
                  <strong>Early Exit:</strong> No penalties
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px', fontSize: '10pt' }}>Investment Terms</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  <strong>Minimum:</strong> $100 initial investment<br/>
                  <strong>Maximum:</strong> No position limits<br/>
                  <strong>Settlement:</strong> T+1 business day<br/>
                  <strong>Distributions:</strong> Quarterly if applicable<br/>
                  <strong>Tax Treatment:</strong> Capital gains/losses<br/>
                  <strong>Reporting:</strong> Monthly statements
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Management Strategy */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <h3 className="heading-3">Fund Management Strategy</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Management Type: {contract.management_type.toUpperCase()}</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px', marginBottom: '12px' }}>
                  {contract.management_type === 'ai' ? (
                    <>
                      <strong>AI-Managed Portfolio:</strong> Automated rebalancing based on market performance, 
                      valuation models, and risk metrics. Algorithm optimizes for risk-adjusted returns while 
                      maintaining sector exposure according to fund objectives.
                    </>
                  ) : (
                    <>
                      <strong>Human-Managed Portfolio:</strong> Professional fund manager actively selects 
                      vehicles, monitors market conditions, and adjusts holdings based on research and 
                      market intelligence.
                    </>
                  )}
                </div>
                
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Investment Objective</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  Provide investors with diversified exposure to the {contract.name.toLowerCase()} segment 
                  through a professionally managed portfolio of verified vehicles with documented ownership 
                  and market valuations.
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Risk Management</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px', marginBottom: '12px' }}>
                  • <strong>Diversification:</strong> No single vehicle greater than 5% of fund<br/>
                  • <strong>Quality Standards:</strong> Verified ownership required<br/>
                  • <strong>Liquidity Management:</strong> 10% cash buffer maintained<br/>
                  • <strong>Valuation Reviews:</strong> Monthly mark-to-market<br/>
                  • <strong>Geographic Spread:</strong> Multiple locations/markets
                </div>

                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Performance Benchmark</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  Fund performance measured against segment-specific vehicle indices and 
                  comparable investment products. Target: 8-12% annual returns with 
                  Sharpe ratio above 1.0 and maximum drawdown below 20%.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Contract Filter */}
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)', alignSelf: 'center', marginRight: '8px' }}>
            Filter by contract type:
          </div>
          {['all', 'shares_trading', 'funding_round', 'bonded', 'for_sale', 'none'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterContract(type)}
              style={{
                padding: '6px 12px',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                background: filterContract === type ? 'var(--primary)' : 'var(--white)',
                color: filterContract === type ? 'var(--white)' : 'var(--text)',
                fontSize: '9pt',
                cursor: 'pointer',
                textTransform: 'uppercase'
              }}
            >
              {type === 'all' ? 'ALL' : getContractLabel(type)} ({contract.vehicles.filter(v => type === 'all' || v.contract_type === type).length})
            </button>
          ))}
        </div>

        {/* Underlying Assets Table */}
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Underlying Assets & Contracts ({filteredVehicles.length} Vehicles)</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gap: '12px' }}>
              {/* Table Header */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '2fr 1fr 2fr 80px 120px 120px 100px',
                gap: '12px',
                fontSize: '9pt',
                fontWeight: 700,
                padding: '12px 8px',
                borderBottom: '2px solid var(--border)',
                color: 'var(--text-muted)'
              }}>
                <div>VEHICLE</div>
                <div>VALUE</div>
                <div>LOCATION</div>
                <div>IMAGES</div>
                <div>OWNERSHIP</div>
                <div>CONTRACT</div>
                <div>ACTION</div>
              </div>
              
              {/* Vehicle Rows */}
              {filteredVehicles.map((vehicle) => (
                <div
                  key={vehicle.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 2fr 80px 120px 120px 100px',
                    gap: '12px',
                    fontSize: '9pt',
                    padding: '12px 8px',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background 0.12s ease',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => navigate(`/vehicle/${vehicle.id}`)}
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
                    {formatUSD(vehicle.current_value)}
                  </div>
                  
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    {vehicle.location}
                  </div>
                  
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ 
                      fontSize: '8pt',
                      padding: '2px 6px',
                      background: vehicle.image_count > 5 ? 'var(--success, #10b981)' : 'var(--warning, #f59e0b)',
                      color: 'var(--white)',
                      borderRadius: '2px',
                      fontWeight: 700
                    }}>
                      {vehicle.image_count}
                    </span>
                  </div>
                  
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      fontSize: '7pt',
                      padding: '4px 6px',
                      background: vehicle.ownership_verified ? 'var(--success, #10b981)' : 'var(--warning, #f59e0b)',
                      color: 'var(--white)',
                      borderRadius: '2px',
                      fontWeight: 700
                    }}>
                      {vehicle.ownership_verified ? 'VERIFIED' : 'PENDING'}
                    </span>
                  </div>
                  
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      fontSize: '7pt',
                      padding: '4px 6px',
                      background: getContractStatusColor(vehicle.contract_type),
                      color: 'var(--white)',
                      borderRadius: '2px',
                      fontWeight: 700
                    }}>
                      {getContractLabel(vehicle.contract_type)}
                    </span>
                    {vehicle.contract_details && (
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {vehicle.contract_type === 'funding_round' && 
                          `$${(vehicle.contract_details.target_amount_cents / 100).toLocaleString()} target`}
                        {vehicle.contract_type === 'shares_trading' && 
                          `${vehicle.contract_details.total_shares} shares`}
                        {vehicle.contract_type === 'bonded' && 
                          `${vehicle.contract_details.interest_rate}% yield`}
                        {vehicle.contract_type === 'for_sale' && 
                          `$${(vehicle.contract_details.asking_price || 0).toLocaleString()} ask`}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ textAlign: 'center' }}>
                    <button
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
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/vehicle/${vehicle.id}`);
                      }}
                    >
                      VIEW
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Investment Summary */}
        <div className="card">
          <div className="card-header">
            <h3 className="heading-3">Investment Opportunity Summary</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>ETF Benefits</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  • <strong>Instant Diversification:</strong> {contract.total_vehicles} vehicles in one purchase<br/>
                  • <strong>Professional Management:</strong> {contract.management_type.toUpperCase()} optimization<br/>
                  • <strong>Daily Liquidity:</strong> Buy/sell at any time<br/>
                  • <strong>Fractional Access:</strong> Own portion of high-value vehicles<br/>
                  • <strong>Reduced Risk:</strong> Portfolio vs single vehicle exposure
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: '8px' }}>Direct Investment Options</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: '14px' }}>
                  • <strong>Individual Shares:</strong> {contract.vehicles.filter(v => v.contract_type === 'shares_trading').length} vehicles available<br/>
                  • <strong>Funding Stakes:</strong> {contract.vehicles.filter(v => v.contract_type === 'funding_round').length} restoration projects<br/>
                  • <strong>Vehicle Bonds:</strong> {contract.vehicles.filter(v => v.contract_type === 'bonded').length} fixed-income opportunities<br/>
                  • <strong>Whole Purchases:</strong> {contract.vehicles.filter(v => v.contract_type === 'for_sale').length} vehicles for sale<br/>
                  • <strong>Higher Returns:</strong> Potential for alpha vs ETF
                </div>
              </div>
            </div>

            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--primary)', color: 'var(--white)', borderRadius: '4px' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>INVESTMENT DECISION FRAMEWORK</div>
              <div style={{ fontSize: '9pt', lineHeight: '14px' }}>
                <strong>Choose ETF if:</strong> You want diversification, professional management, and daily liquidity<br/>
                <strong>Choose Individual if:</strong> You want to pick specific vehicles, higher potential returns, and direct ownership
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
