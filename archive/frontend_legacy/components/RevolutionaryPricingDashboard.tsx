import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

interface RevolutionaryPricingDashboardProps {
  vehicleId: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    current_value?: number;
    price_confidence?: number;
  };
}

interface PricingData {
  // Automatic discovery
  scraped_data: {
    estimated_value: number;
    confidence: number;
    comparable_count: number;
    sold_count: number;
    sources: string[];
  } | null;
  
  // User comparables
  user_comparables: {
    count: number;
    avg_price: number;
    confidence: number;
  } | null;
  
  // AI condition analysis
  condition_analysis: {
    overall_score: number;
    condition_grade: string;
    price_multiplier: number;
    final_price: number;
    confidence: number;
  } | null;
  
  // Final pricing
  final_estimate: {
    price: number;
    confidence: number;
    last_updated: string;
  };
}

export function RevolutionaryPricingDashboard({ vehicleId, vehicle }: RevolutionaryPricingDashboardProps) {
  const { user } = useAuth();
  const [pricingData, setPricingData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'sources' | 'condition' | 'comparables'>('overview');

  useEffect(() => {
    loadPricingData();
  }, [vehicleId]);

  const loadPricingData = async () => {
    try {
      setLoading(true);
      
      // Load all pricing data sources in parallel
      const [
        scrapedDataResult,
        userComparablesResult,
        conditionAnalysisResult,
        vehicleDataResult
      ] = await Promise.all([
        // Scraped market data
        supabase
          .from('vehicle_price_discoveries')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('discovered_at', { ascending: false })
          .limit(1)
          .single(),
        
        // User comparables summary
        supabase
          .from('vehicle_comparables_summary')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .single(),
        
        // AI condition analysis
        supabase
          .from('vehicle_condition_summary')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .single(),
        
        // Current vehicle data
        supabase
          .from('vehicles')
          .select('current_value, price_confidence, price_last_updated, price_sources')
          .eq('id', vehicleId)
          .single()
      ]);

      // Process and combine data
      const pricing: PricingData = {
        scraped_data: scrapedDataResult.data ? {
          estimated_value: scrapedDataResult.data.estimated_value || 0,
          confidence: scrapedDataResult.data.confidence || 0,
          comparable_count: scrapedDataResult.data.comparable_count || 0,
          sold_count: scrapedDataResult.data.sold_count || 0,
          sources: scrapedDataResult.data.sources || []
        } : null,
        
        user_comparables: userComparablesResult.data ? {
          count: userComparablesResult.data.user_comparables_count || 0,
          avg_price: userComparablesResult.data.avg_comparable_price || 0,
          confidence: userComparablesResult.data.comparable_confidence || 0
        } : null,
        
        condition_analysis: conditionAnalysisResult.data ? {
          overall_score: conditionAnalysisResult.data.ai_condition_score || 5,
          condition_grade: conditionAnalysisResult.data.condition_grade || 'Unknown',
          price_multiplier: conditionAnalysisResult.data.condition_multiplier || 1.0,
          final_price: conditionAnalysisResult.data.final_price || 0,
          confidence: conditionAnalysisResult.data.condition_confidence || 0
        } : null,
        
        final_estimate: {
          price: vehicleDataResult.data?.current_value || 0,
          confidence: vehicleDataResult.data?.price_confidence || 0,
          last_updated: vehicleDataResult.data?.price_last_updated || new Date().toISOString()
        }
      };

      setPricingData(pricing);
    } catch (error) {
      console.error('Error loading pricing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshPricing = async () => {
    setRefreshing(true);
    try {
      // Trigger fresh price discovery
      await supabase.functions.invoke('auto-price-discovery', {
        body: { vehicle_id: vehicleId }
      });
      
      // Wait a moment then reload
      setTimeout(loadPricingData, 3000);
    } catch (error) {
      console.error('Error refreshing pricing:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return '#10B981'; // Green
    if (confidence >= 70) return '#F59E0B'; // Yellow
    if (confidence >= 50) return '#EF4444'; // Red
    return '#6B7280'; // Gray
  };

  const getConditionColor = (score: number) => {
    if (score >= 8) return '#10B981';
    if (score >= 6) return '#F59E0B';
    return '#EF4444';
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: '#6b7280' }}>
          🤖 Analyzing revolutionary pricing data...
        </div>
      </div>
    );
  }

  if (!pricingData) {
    return (
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: '#ef4444' }}>
          Failed to load pricing data
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{
        padding: '20px',
        borderBottom: '1px solid #e5e7eb',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0' }}>
              🚀 Revolutionary Pricing System
            </h2>
            <p style={{ fontSize: '16px', opacity: 0.9, margin: 0 }}>
              AI + Market Data + Community Intelligence = Accurate Pricing
            </p>
          </div>
          
          <button
            onClick={handleRefreshPricing}
            disabled={refreshing}
            className="button button-secondary"
            style={{ 
              backgroundColor: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'white'
            }}
          >
            {refreshing ? '🔄 Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* Main Price Display */}
      <div style={{
        padding: '30px',
        textAlign: 'center',
        background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        color: 'white'
      }}>
        <div style={{ fontSize: '48px', fontWeight: 'bold', marginBottom: '8px' }}>
          {formatPrice(pricingData.final_estimate.price)}
        </div>
        
        <div style={{ 
          fontSize: '18px', 
          opacity: 0.9,
          marginBottom: '12px'
        }}>
          {pricingData.final_estimate.confidence}% Confidence
        </div>
        
        <div style={{
          display: 'inline-block',
          padding: '6px 12px',
          backgroundColor: 'rgba(255,255,255,0.2)',
          borderRadius: '20px',
          fontSize: '14px'
        }}>
          Last updated: {new Date(pricingData.final_estimate.last_updated).toLocaleDateString()}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #e5e7eb'
      }}>
        {[
          { id: 'overview', label: 'Overview', icon: '📊' },
          { id: 'sources', label: 'Market Data', icon: '🔍' },
          { id: 'condition', label: 'AI Analysis', icon: '🤖' },
          { id: 'comparables', label: 'Community', icon: '👥' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              flex: 1,
              padding: '16px 12px',
              border: 'none',
              background: activeTab === tab.id ? '#f3f4f6' : 'transparent',
              borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab.id ? '#3b82f6' : '#6b7280',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ padding: '20px' }}>
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
            {/* Market Data Card */}
            <div className="card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>🔍</span>
                <h4 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Market Discovery</h4>
              </div>
              
              {pricingData.scraped_data ? (
                <>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
                    {formatPrice(pricingData.scraped_data.estimated_value)}
                  </div>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    {pricingData.scraped_data.sold_count} sold + {pricingData.scraped_data.comparable_count - pricingData.scraped_data.sold_count} active
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                    Sources: {pricingData.scraped_data.sources.join(', ')}
                  </div>
                </>
              ) : (
                <div style={{ color: '#6b7280' }}>No market data yet</div>
              )}
            </div>

            {/* Condition Analysis Card */}
            <div className="card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>🤖</span>
                <h4 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>AI Condition</h4>
              </div>
              
              {pricingData.condition_analysis ? (
                <>
                  <div style={{ 
                    fontSize: '24px', 
                    fontWeight: 'bold', 
                    marginBottom: '8px',
                    color: getConditionColor(pricingData.condition_analysis.overall_score)
                  }}>
                    {pricingData.condition_analysis.overall_score}/10
                  </div>
                  <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                    {pricingData.condition_analysis.condition_grade}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    Price Impact: {((pricingData.condition_analysis.price_multiplier - 1) * 100).toFixed(0)}%
                  </div>
                </>
              ) : (
                <div style={{ color: '#6b7280' }}>Upload images for AI analysis</div>
              )}
            </div>

            {/* User Comparables Card */}
            <div className="card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '20px' }}>👥</span>
                <h4 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Community Data</h4>
              </div>
              
              {pricingData.user_comparables && pricingData.user_comparables.count > 0 ? (
                <>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
                    {formatPrice(pricingData.user_comparables.avg_price)}
                  </div>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    {pricingData.user_comparables.count} user submissions
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                    {pricingData.user_comparables.confidence}% validation score
                  </div>
                </>
              ) : (
                <div style={{ color: '#6b7280' }}>No user comparables yet</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'sources' && (
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>
              📊 Market Data Sources
            </h3>
            
            {pricingData.scraped_data ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                        Automatic Market Discovery
                      </div>
                      <div style={{ fontSize: '14px', color: '#6b7280' }}>
                        {pricingData.scraped_data.sources.join(' • ')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                        {formatPrice(pricingData.scraped_data.estimated_value)}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>
                        {pricingData.scraped_data.confidence}% confidence
                      </div>
                    </div>
                  </div>
                </div>
                
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                  gap: '12px',
                  marginTop: '16px'
                }}>
                  <div className="card" style={{ padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>
                      {pricingData.scraped_data.sold_count}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Sold Vehicles</div>
                  </div>
                  
                  <div className="card" style={{ padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>
                      {pricingData.scraped_data.comparable_count - pricingData.scraped_data.sold_count}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Active Listings</div>
                  </div>
                  
                  <div className="card" style={{ padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>
                      {pricingData.scraped_data.sources.length}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>Data Sources</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ 
                textAlign: 'center', 
                padding: '40px',
                color: '#6b7280'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
                <div>No market data discovered yet</div>
                <div style={{ fontSize: '14px', marginTop: '8px' }}>
                  Market discovery runs automatically when vehicles are added
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'condition' && (
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>
              🤖 AI Condition Analysis
            </h3>
            
            {pricingData.condition_analysis ? (
              <div>
                {/* Overall Score */}
                <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px' }}>
                        Overall Condition: {pricingData.condition_analysis.condition_grade}
                      </div>
                      <div style={{ fontSize: '14px', color: '#6b7280' }}>
                        Based on AI analysis of vehicle images
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ 
                        fontSize: '36px', 
                        fontWeight: 'bold',
                        color: getConditionColor(pricingData.condition_analysis.overall_score)
                      }}>
                        {pricingData.condition_analysis.overall_score}/10
                      </div>
                    </div>
                  </div>
                </div>

                {/* Price Impact */}
                <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
                  <div style={{ fontWeight: '600', marginBottom: '12px' }}>
                    💰 Condition Price Impact
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '14px', color: '#6b7280' }}>
                        Condition Multiplier: {pricingData.condition_analysis.price_multiplier}x
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                        {((pricingData.condition_analysis.price_multiplier - 1) * 100) > 0 ? '+' : ''}
                        {((pricingData.condition_analysis.price_multiplier - 1) * 100).toFixed(0)}% vs baseline
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                        {formatPrice(pricingData.condition_analysis.final_price)}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>
                        Condition-Adjusted Price
                      </div>
                    </div>
                  </div>
                </div>

                {/* Analysis Confidence */}
                <div className="card" style={{ padding: '16px' }}>
                  <div style={{ fontWeight: '600', marginBottom: '12px' }}>
                    📊 Analysis Confidence
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ 
                      width: '100px',
                      height: '8px',
                      backgroundColor: '#e5e7eb',
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${pricingData.condition_analysis.confidence}%`,
                        height: '100%',
                        backgroundColor: getConfidenceColor(pricingData.condition_analysis.confidence),
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                    <span style={{ 
                      fontSize: '16px', 
                      fontWeight: 'bold',
                      color: getConfidenceColor(pricingData.condition_analysis.confidence)
                    }}>
                      {pricingData.condition_analysis.confidence}%
                    </span>
                  </div>
                  
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
                    Higher confidence with more images and clearer condition indicators
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ 
                textAlign: 'center', 
                padding: '40px',
                color: '#6b7280'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📸</div>
                <div>No condition analysis available</div>
                <div style={{ fontSize: '14px', marginTop: '8px' }}>
                  Upload vehicle images to enable AI condition analysis
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'comparables' && (
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>
              👥 Community Comparables
            </h3>
            
            {pricingData.user_comparables && pricingData.user_comparables.count > 0 ? (
              <div className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                      User-Submitted Comparables
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      {pricingData.user_comparables.count} validated submissions
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                      {formatPrice(pricingData.user_comparables.avg_price)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      Average Price
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ 
                textAlign: 'center', 
                padding: '40px',
                color: '#6b7280'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>👥</div>
                <div>No community comparables yet</div>
                <div style={{ fontSize: '14px', marginTop: '8px' }}>
                  Be the first to submit a comparable vehicle
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}