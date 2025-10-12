import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface MultiSourcePriceSectionProps {
  vehicleId: string;
  isOwner: boolean;
  onEdit?: () => void;
}

// Verification levels from lowest to highest trust
type VerificationLevel = 
  | 'ai_scraped'      // Web scraping, AI extraction
  | 'user_input'      // User provided
  | 'db_average'      // Average from database
  | 'human_verified'  // Human inspection/service
  | 'professional';   // Professional diagnostic tools

interface DataSource {
  value: number;
  source_type: VerificationLevel;
  source_name?: string;
  confidence_score?: number;
  updated_at: string;
  verification_details?: string;
}

interface MultiSourceField {
  field_name: string;
  sources: DataSource[];
  consensus_value?: number;
  highest_verification: VerificationLevel;
}

const MultiSourcePriceSection: React.FC<MultiSourcePriceSectionProps> = ({ vehicleId, isOwner, onEdit }) => {
  const [msrpData, setMsrpData] = useState<MultiSourceField | null>(null);
  const [marketValueData, setMarketValueData] = useState<MultiSourceField | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMultiSourceData();
  }, [vehicleId]);

  const loadMultiSourceData = async () => {
    try {
      setLoading(true);
      
      // Load from vehicle_field_sources table for multi-source data
      const { data: fieldSources, error: sourcesError } = await supabase
        .from('vehicle_field_sources')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .in('field_name', ['msrp', 'current_value', 'market_value']);

      if (sourcesError) {
        console.error('Error loading field sources:', sourcesError);
      }

      // Also load direct vehicle data as fallback
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles')
        .select('msrp, current_value')
        .eq('id', vehicleId)
        .single();

      if (vehicleError) {
        console.error('Error loading vehicle data:', vehicleError);
      }

      // Process MSRP sources
      const msrpSources = (fieldSources || [])
        .filter(s => s.field_name === 'msrp')
        .map(s => ({
          value: parseFloat(s.field_value),
          source_type: s.source_type as VerificationLevel,
          source_name: s.source_name,
          confidence_score: s.confidence_score,
          updated_at: s.updated_at,
          verification_details: s.verification_details
        }));

      // Add vehicle table data if exists and not already in sources
      if (vehicleData?.msrp && !msrpSources.find(s => s.source_type === 'user_input')) {
        msrpSources.push({
          value: vehicleData.msrp,
          source_type: 'user_input',
          source_name: 'Vehicle Owner',
          confidence_score: 75,
          updated_at: new Date().toISOString(),
          verification_details: 'User provided'
        });
      }

      // Process Market Value sources
      const marketSources = (fieldSources || [])
        .filter(s => s.field_name === 'current_value' || s.field_name === 'market_value')
        .map(s => ({
          value: parseFloat(s.field_value),
          source_type: s.source_type as VerificationLevel,
          source_name: s.source_name,
          confidence_score: s.confidence_score,
          updated_at: s.updated_at,
          verification_details: s.verification_details
        }));

      // Add vehicle table data if exists
      if (vehicleData?.current_value && !marketSources.find(s => s.source_type === 'user_input')) {
        marketSources.push({
          value: vehicleData.current_value,
          source_type: 'user_input',
          source_name: 'Vehicle Owner',
          confidence_score: 75,
          updated_at: new Date().toISOString(),
          verification_details: 'User provided'
        });
      }

      setMsrpData({
        field_name: 'msrp',
        sources: msrpSources,
        consensus_value: calculateConsensus(msrpSources),
        highest_verification: getHighestVerification(msrpSources)
      });

      setMarketValueData({
        field_name: 'market_value',
        sources: marketSources,
        consensus_value: calculateConsensus(marketSources),
        highest_verification: getHighestVerification(marketSources)
      });

    } catch (err) {
      console.error('Error in loadMultiSourceData:', err);
    } finally {
      setLoading(false);
    }
  };

  const calculateConsensus = (sources: DataSource[]): number | undefined => {
    if (sources.length === 0) return undefined;
    
    // Weight by verification level and confidence
    const weights: Record<VerificationLevel, number> = {
      ai_scraped: 1,
      user_input: 2,
      db_average: 3,
      human_verified: 4,
      professional: 5
    };

    let totalWeight = 0;
    let weightedSum = 0;

    sources.forEach(source => {
      const weight = weights[source.source_type] * (source.confidence_score || 50) / 100;
      weightedSum += source.value * weight;
      totalWeight += weight;
    });

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : undefined;
  };

  const getHighestVerification = (sources: DataSource[]): VerificationLevel => {
    const levels: VerificationLevel[] = ['professional', 'human_verified', 'db_average', 'user_input', 'ai_scraped'];
    for (const level of levels) {
      if (sources.find(s => s.source_type === level)) {
        return level;
      }
    }
    return 'ai_scraped';
  };

  const formatPrice = (price: number | undefined): string => {
    if (!price) return 'Not available';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  };

  const getVerificationBadge = (level: VerificationLevel) => {
    const badges = {
      ai_scraped: { label: 'AI Scraped', color: 'badge-secondary' },
      user_input: { label: 'User Input', color: 'badge-info' },
      db_average: { label: 'Database Average', color: 'badge-primary' },
      human_verified: { label: 'Human Verified', color: 'badge-success' },
      professional: { label: 'Professional', color: 'badge-warning' }
    };
    return badges[level] || badges.ai_scraped;
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header">Multi-Source Price Data</div>
        <div className="card-body">
          <div className="text-center text-muted">Loading price sources...</div>
        </div>
      </div>
    );
  }

  const renderMultiSourceField = (data: MultiSourceField | null, label: string) => {
    if (!data || data.sources.length === 0) {
      return (
        <div className="vehicle-detail">
          <span>{label}</span>
          <span className="text-muted">No data available</span>
        </div>
      );
    }

    const badge = getVerificationBadge(data.highest_verification);

    return (
      <div style={{ marginBottom: '20px' }}>
        <div className="vehicle-detail">
          <span>{label}</span>
          <span>
            <span className="text font-bold">{formatPrice(data.consensus_value)}</span>
            <span className={`badge ${badge.color}`} style={{ marginLeft: '8px' }}>
              {badge.label}
            </span>
          </span>
        </div>
        
        {/* Show all sources */}
        <div style={{ marginLeft: '20px', marginTop: '8px' }}>
          {data.sources.map((source, idx) => {
            const sourceBadge = getVerificationBadge(source.source_type);
            return (
              <div key={idx} className="vehicle-detail" style={{ fontSize: '12px', color: '#6b7280' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className={`badge badge-small ${sourceBadge.color}`}>
                    {sourceBadge.label}
                  </span>
                  {source.source_name}
                  {source.confidence_score && (
                    <span style={{ opacity: 0.7 }}>({source.confidence_score}%)</span>
                  )}
                </span>
                <span>
                  {formatPrice(source.value)}
                  <span style={{ marginLeft: '8px', fontSize: '10px', opacity: 0.6 }}>
                    {formatDate(source.updated_at)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Multi-Source Price Information</span>
        {isOwner && onEdit && (
          <button className="button button-small button-primary" onClick={onEdit}>
            Add Data Source
          </button>
        )}
      </div>
      <div className="card-body">
        <div className="vehicle-details">
          

          {/* MSRP with sources */}
          {renderMultiSourceField(msrpData, 'Original MSRP')}

          {/* Market Value with sources */}
          {renderMultiSourceField(marketValueData, 'Current Market Value')}


        </div>
      </div>
    </div>
  );
};

export default MultiSourcePriceSection;
