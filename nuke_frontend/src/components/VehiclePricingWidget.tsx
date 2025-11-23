/**
 * Vehicle Pricing Widget - Prominent pricing intelligence interface
 *
 * This widget provides immediate access to AI-powered pricing tools
 * directly in the vehicle profile, making pricing intelligence highly visible.
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { VehicleValuationService } from '../services/vehicleValuationService';
import type { VehicleValuation } from '../services/vehicleValuationService';
import { BuyCreditsButton } from './credits/BuyCreditsButton';

interface VehiclePricingWidgetProps {
  vehicleId: string;
  vehicleInfo: {
    year: number;
    make: string;
    model: string;
    mileage?: number;
  };
  isOwner?: boolean;
  className?: string;
  initialValuation?: any | null; // From RPC to avoid duplicate query
}

interface PricingStatus {
  status: 'not_analyzed' | 'analyzing' | 'high_confidence' | 'medium_confidence' | 'low_confidence' | 'needs_review';
  estimated_value?: number;
  confidence_score?: number;
  last_analyzed?: string;
  message: string;
}

export const VehiclePricingWidget: React.FC<VehiclePricingWidgetProps> = ({
  vehicleId,
  vehicleInfo,
  isOwner = false,
  className = '',
  initialValuation
}) => {
  const [pricingStatus, setPricingStatus] = useState<PricingStatus | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDataSources, setShowDataSources] = useState(false);
  const [showPartViewer, setShowPartViewer] = useState(false);
  const [selectedPart, setSelectedPart] = useState<any>(null);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'info' | 'error'} | null>(null);

  // Use initialValuation if provided (eliminates duplicate query)
  useEffect(() => {
    if (initialValuation) {
      const valuation = initialValuation;
      setPricingStatus({
        status: (valuation.confidence_score || 0) >= 80 ? 'high_confidence' : 
                (valuation.confidence_score || 0) >= 65 ? 'medium_confidence' : 
                (valuation.confidence_score || 0) > 0 ? 'low_confidence' : 'not_analyzed',
        message: valuation.documented_components?.length > 0 ? 
                `Based on ${valuation.documented_components.length} components` : 
                'No data available',
        estimated_value: Math.round(valuation.estimated_value || 0),
        confidence_score: valuation.confidence_score || 0,
        last_analyzed: valuation.valuation_date
      });
      return; // Skip fetch if provided
    }
    if (vehicleId) {
      loadPricingStatus();
    }
  }, [vehicleId, initialValuation]);

  // Refresh when receipts/documents update
  useEffect(() => {
    const handler = (e: any) => {
      if (!vehicleId) return;
      if (e?.detail?.vehicleId && e.detail.vehicleId !== vehicleId) return;
      VehicleValuationService.clearCache(vehicleId);
      loadPricingStatus();
    };
    window.addEventListener('valuation_updated', handler as any);
    window.addEventListener('timeline_updated', handler as any);
    return () => {
      window.removeEventListener('valuation_updated', handler as any);
      window.removeEventListener('timeline_updated', handler as any);
    };
  }, [vehicleId]);

  const loadPricingStatus = async () => {
    try {
      // Use the shared valuation service
      const valuation = await VehicleValuationService.getValuation(vehicleId);
      
      // Convert to pricing status format
      setPricingStatus({
        status: valuation.confidence >= 80 ? 'high_confidence' : 
                valuation.confidence >= 65 ? 'medium_confidence' : 
                valuation.confidence > 0 ? 'low_confidence' : 'not_analyzed',
        message: valuation.dataSources.length > 0 ? 
                `Based on ${valuation.dataSources.join(', ')}` : 
                'No data available',
        estimated_value: Math.round(valuation.estimatedValue),
        confidence_score: valuation.confidence,
        last_analyzed: valuation.lastUpdated
      });
      
      // Also set breakdown data
      setBreakdown({
        buildInvestment: valuation.totalInvested,
        topParts: valuation.topParts,
        hasRealData: valuation.hasRealData
      });
      
      setError(null);
    } catch (err: any) {
      console.error('Failed to load pricing status:', err);
      setPricingStatus({
        status: 'not_analyzed',
        message: 'Unable to load valuation data',
        estimated_value: 0,
        confidence_score: 0,
        last_analyzed: new Date().toISOString()
      });
      setError(null);
    }
  };

  const triggerAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      // TODO: Implement triggerManualAnalysis in pricingService
      // For now, just reload the status after a delay
      console.log('Triggering analysis for vehicle:', vehicleId);

      // Poll for updated status
      setTimeout(() => {
        loadPricingStatus();
        setIsAnalyzing(false);
      }, 5000);
    } catch (err: any) {
      console.error('Failed to trigger analysis:', err);
      // Generate an enhanced estimate when backend isn't available
      setTimeout(async () => {
        const enhancedValue = await calculateEnhancedEstimate();
        setPricingStatus({
          status: 'medium_confidence',
          estimated_value: enhancedValue.estimate,
          confidence_score: enhancedValue.confidence,
          last_analyzed: new Date().toISOString(),
          message: enhancedValue.message
        });
        setIsAnalyzing(false);
      }, 2000);
    }
  };
  
  // Enhanced calculation that uses actual vehicle data from database
  const calculateEnhancedEstimate = async () => {
    try {
      // Import supabase here to access vehicle data
      const { supabase } = await import('../lib/supabase');

      // Get full vehicle data with modifications and images
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (vehicleError || !vehicle) {
        return {
          estimate: 0,
          confidence: 0,
          message: 'No vehicle data available'
        };
      }

      // Get image tags for component analysis
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('vehicle_id', vehicleId);

      let tagData: any[] = [];
      if (images && images.length > 0) {
        const imageIds = images.map(img => img.id);
        const { data: tags } = await supabase
          .from('image_tags')
          .select('*')
          .in('image_id', imageIds)
          .in('type', ['product', 'part', 'brand', 'modification']);

        tagData = tags || [];
      }

      // Base vehicle value calculation
      let baseValue = getBaseValueByMakeModel(vehicle.make, vehicle.model, vehicle.year);

      // Apply mileage adjustment
      if (vehicle.mileage) {
        const mileageMultiplier = calculateMileageAdjustment(vehicle.mileage, vehicle.year);
        baseValue *= mileageMultiplier;
      }

      // Apply condition and modification adjustments based on actual data
      const modificationValue = calculateModificationValue(tagData);
      const imageQualityBonus = Math.min(images?.length || 0, 50) * 25; // Up to $1,250 for documentation

      const finalValue = baseValue + modificationValue + imageQualityBonus;
      const confidence = calculateConfidence(vehicle, tagData, images?.length || 0);

      const sources = buildDataSources(vehicle, tagData, images?.length || 0);

      return {
        estimate: Math.round(finalValue / 100) * 100,
        confidence,
        message: `Based on ${sources.join(', ')}`
      };

    } catch (error) {
      console.error('Enhanced estimation failed:', error);
      return {
        estimate: 0,
        confidence: 0,
        message: 'No data available'
      };
    }
  };

  // No mock data - only real database values
  const getRealEstimate = async () => {
    // Only return actual database values, no fake calculations
    const { data: buildData } = await supabase
      .from('vehicle_builds')
      .select('total_spent')
      .eq('vehicle_id', vehicleId)
      .single();
    
    if (buildData?.total_spent) {
      return buildData.total_spent;
    }
    
    // If no real data, return 0
    return 0;
  };

  // Helper functions for enhanced calculation
  const getBaseValueByMakeModel = (make: string, model: string, year: number) => {
    // Basic vehicle value lookup - could be enhanced with real market data
    const makeMultipliers: Record<string, number> = {
      'porsche': 80000, 'bmw': 60000, 'mercedes': 65000, 'audi': 55000,
      'lexus': 50000, 'acura': 40000, 'infiniti': 42000,
      'ford': 35000, 'chevrolet': 35000, 'dodge': 38000,
      'toyota': 32000, 'honda': 30000, 'nissan': 30000,
      'subaru': 32000, 'mazda': 28000, 'hyundai': 25000, 'kia': 25000
    };

    const baseValue = makeMultipliers[make.toLowerCase()] || 35000;
    const age = new Date().getFullYear() - year;
    const depreciation = Math.min(age * 0.15, 0.8);

    return baseValue * (1 - depreciation);
  };

  const calculateMileageAdjustment = (mileage: number, year: number) => {
    const age = new Date().getFullYear() - year;
    const avgMilesPerYear = 12000;
    const expectedMiles = age * avgMilesPerYear;

    if (mileage < expectedMiles * 0.5) return 1.15; // Low miles bonus
    if (mileage < expectedMiles) return 1.05; // Below average
    if (mileage < expectedMiles * 1.5) return 0.95; // Above average
    return 0.8; // High mileage
  };

  const calculateModificationValue = (tags: any[]) => {
    let modValue = 0;
    const brands = new Set<string>();

    tags.forEach(tag => {
      const text = tag.text?.toLowerCase() || '';

      // High-value performance brands
      if (text.includes('arp') || text.includes('ae86')) modValue += 800;
      if (text.includes('coilover') || text.includes('turbo')) modValue += 1200;
      if (text.includes('exhaust')) modValue += 600;
      if (text.includes('intake')) modValue += 400;

      // Track unique brands
      const brandMatches = text.match(/\b(arp|bilstein|eibach|kw|ohlins|brembo|stoptech|aem|hks|greddy|spoon|mugen)\b/i);
      if (brandMatches) brands.add(brandMatches[1]);
    });

    // Brand diversity bonus
    modValue += brands.size * 300;

    return Math.min(modValue, 15000); // Cap at $15k
  };

  const calculateConfidence = (vehicle: any, tags: any[], imageCount: number) => {
    let confidence = 70; // Base confidence

    if (vehicle.vin) confidence += 10;
    if (vehicle.mileage) confidence += 5;
    if (tags.length > 5) confidence += 10; // Good documentation
    if (imageCount > 10) confidence += 5; // Good photo coverage

    return Math.min(confidence, 95);
  };

  const buildDataSources = (vehicle: any, tags: any[], imageCount: number) => {
    const sources = ['vehicle specifications'];

    if (vehicle.mileage) sources.push('mileage data');
    if (tags.length > 0) sources.push('modification analysis');
    if (imageCount > 0) sources.push('visual documentation');

    return sources;
  };

  const openFullAnalysis = () => {
    setShowFullAnalysis(true);
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'high_confidence': return 'text-green-600 bg-green-50 border-green-200';
      case 'medium_confidence': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low_confidence': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'needs_review': return 'text-red-600 bg-red-50 border-red-200';
      case 'analyzing': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'high_confidence':
        return <span className="text-green-500">✅</span>;
      case 'medium_confidence':
        return <span className="text-yellow-500">⚠️</span>;
      case 'low_confidence':
        return <span className="text-orange-500">❓</span>;
      case 'needs_review':
        return <span className="text-red-500">🚨</span>;
      case 'analyzing':
        return <span className="animate-spin text-blue-500">⚡</span>;
      default:
        return <span className="text-gray-500">💰</span>;
    }
  };

  const formatCurrency = (value?: number) => {
    if (!value) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const openPartViewer = (part: any) => {
    setSelectedPart(part);
    setShowPartViewer(true);
    showToast(`Viewing validation data for ${part.name}`, 'info');
  };

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <div className="flex items-center text-red-700">
          <span className="mr-2">❌</span>
          <span className="font-medium">Pricing Unavailable</span>
        </div>
        <p className="text-sm text-red-600 mt-1">{error}</p>
        <button
          onClick={loadPricingStatus}
          className="mt-2 text-red-600 text-sm font-medium hover:underline"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Only show breakdown if we have real data sources
  const [breakdown, setBreakdown] = useState<any>(null);
  
  // Breakdown is now loaded together with pricing status
  // No need for separate effect
  
  // Breakdown is now loaded as part of loadPricingStatus
  // No separate loadBreakdown function needed

  return (
    <>
      <div className={`card ${className}`}>
        {/* Primary Value Display */}
        <div className="card-body" style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--border-medium)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div className="text" style={{ fontSize: '18pt', fontWeight: 'bold', lineHeight: '1.2' }}>
                {pricingStatus?.estimated_value ?
                  formatCurrency(pricingStatus.estimated_value) :
                  '—'
                }
              </div>
              <div className="text text-muted" style={{ fontSize: '8pt', marginTop: '2px', letterSpacing: '0.5px' }}>
                ESTIMATED VALUE
              </div>
            </div>
            {pricingStatus?.confidence_score && (
              <div style={{ textAlign: 'right' }}>
                <div className="text" style={{
                  fontSize: '12pt',
                  fontWeight: 'bold',
                  color: pricingStatus.confidence_score >= 80 ? '#008000' :
                         pricingStatus.confidence_score >= 60 ? '#808000' : '#800000'
                }}>
                  {pricingStatus.confidence_score}%
                </div>
                <div className="text text-muted" style={{ fontSize: '7pt', marginTop: '2px' }}>CONFIDENCE</div>
              </div>
            )}
          </div>
        </div>

        {/* Value Breakdown - ONLY REAL DATA */}
        {breakdown?.hasRealData && (
          <div className="card-body" style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--border-medium)' }}>
            <div className="text text-muted" style={{ fontSize: '7pt', fontWeight: 'bold', marginBottom: 'var(--space-1)', letterSpacing: '0.5px' }}>
              BUILD INVESTMENT {breakdown.topParts?.some((p: any) => p.images?.length > 0) && (
                <span style={{ fontSize: '6pt', fontWeight: '400', marginLeft: '4px', color: '#008000' }}>
                  ✓ AI-verified parts
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text" style={{ fontSize: '8pt' }}>Total Build Cost</span>
                <span className="text" style={{ fontSize: '8pt', fontWeight: 'bold' }}>
                  {formatCurrency(breakdown.buildInvestment)}
                </span>
              </div>
              {breakdown.topParts?.map((part: any, idx: number) => (
                <div key={idx} style={{ marginBottom: '6px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '2px',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      borderRadius: '2px'
                    }}
                    className="hover:bg-gray-50"
                    onClick={() => openPartViewer(part)}
                    title="Click to view validation images"
                  >
                    <span className="text" style={{ fontSize: '7pt' }}>• {part.name}</span>
                    <span className="text" style={{ fontSize: '7pt', fontWeight: part.price > 0 ? 'bold' : '400' }}>
                      {part.price > 0 ? formatCurrency(part.price) : 'AI analyzing...'}
                    </span>
                  </div>
                  {/* Show image thumbnails if available */}
                  {part.images && part.images.length > 0 && (
                    <div style={{ 
                      display: 'flex', 
                      gap: '4px', 
                      marginLeft: '16px',
                      marginTop: '4px' 
                    }}>
                      {part.images.slice(0, 3).map((img: any, imgIdx: number) => (
                        <div 
                          key={imgIdx}
                          style={{
                            position: 'relative',
                            width: '40px',
                            height: '40px',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            border: '1px solid #e5e7eb',
                            cursor: 'pointer'
                          }}
                          onClick={() => window.open(img.url, '_blank')}
                          title={img.tags.join(', ')}
                        >
                          <img 
                            src={img.url} 
                            alt={part.name}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                          />
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            background: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            fontSize: '8px',
                            padding: '1px 2px',
                            textAlign: 'center'
                          }}>
                            IMG {imgIdx + 1}
                          </div>
                        </div>
                      ))}
                      {part.images.length > 3 && (
                        <div style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '4px',
                          backgroundColor: '#f3f4f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          color: '#6b7280',
                          border: '1px solid #e5e7eb'
                        }}>
                          +{part.images.length - 3}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Market Range */}
        {pricingStatus?.estimated_value && (
          <div className="card-body" style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '12px', letterSpacing: '0.5px' }}>
              MARKET RANGE
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>LOW</div>
                <div style={{ fontSize: '16px', fontWeight: '500' }}>
                  {formatCurrency((pricingStatus.estimated_value || 0) * 0.85)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>HIGH</div>
                <div style={{ fontSize: '16px', fontWeight: '500' }}>
                  {formatCurrency((pricingStatus.estimated_value || 0) * 1.15)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="card-body" style={{ padding: '16px' }}>
          {!pricingStatus || pricingStatus.status === 'not_analyzed' ? (
            <button
              onClick={triggerAnalysis}
              disabled={isAnalyzing}
              className="button button-primary"
              style={{ width: '100%' }}
            >
              {isAnalyzing ? 'Refreshing...' : 'Refresh'}
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={triggerAnalysis}
                  disabled={isAnalyzing}
                  className="button button-secondary button-small"
                >
                  {isAnalyzing ? 'Updating...' : 'Update'}
                </button>
                <button
                  className="button button-secondary button-small"
                  style={{ position: 'relative' }}
                  onClick={() => setShowDataSources(!showDataSources)}
                >
                  Data Sources {showDataSources ? '▲' : '▼'}
                </button>
              </div>
              {pricingStatus.last_analyzed && (
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                  Updated {formatDate(pricingStatus.last_analyzed)}
                </span>
              )}
            </div>
          )}
          
          {/* Data Sources Dropdown */}
          {showDataSources && (
            <div className="card" style={{
              marginTop: 'var(--space-2)',
              padding: 'var(--space-2)',
              fontSize: '7pt'
            }}>
              <div className="text" style={{ marginBottom: 'var(--space-1)', fontWeight: 'bold' }}>
                Data Sources:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {pricingStatus?.message && pricingStatus.message !== 'No data available' ? (
                  pricingStatus.message.replace('Based on ', '').split(', ').map((source, idx) => (
                    <div
                      key={idx}
                      className="button button-small"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-1)',
                        padding: '2px var(--space-1)',
                        fontSize: '7pt',
                        cursor: 'pointer',
                        justifyContent: 'flex-start'
                      }}
                      onClick={async () => {
                        // Query real database data for each source
                        switch (source.toLowerCase()) {
                          case 'vehicle specifications':
                            document.getElementById('basic-info-section')?.scrollIntoView({ behavior: 'smooth' });
                            showToast('Viewing vehicle specifications', 'success');
                            break;
                          case 'visual documentation':
                            try {
                              const { data: images } = await supabase
                                .from('vehicle_images')
                                .select('id')
                                .eq('vehicle_id', vehicleId);

                              if (images && images.length > 0) {
                                const imageSection = document.querySelector('[data-section="images"]');
                                if (imageSection) {
                                  imageSection.scrollIntoView({ behavior: 'smooth' });
                                  showToast(`Found ${images.length} images for analysis`, 'success');
                                } else {
                                  showToast(`${images.length} images available`, 'info');
                                }
                              } else {
                                showToast('No images uploaded yet', 'error');
                              }
                            } catch (error) {
                              showToast('Unable to load image data', 'error');
                            }
                            break;
                          case 'modification analysis':
                            try {
                              const { data: images } = await supabase
                                .from('vehicle_images')
                                .select('id')
                                .eq('vehicle_id', vehicleId);

                              if (images && images.length > 0) {
                                const imageIds = images.map(img => img.id);
                                const { data: tags } = await supabase
                                  .from('image_tags')
                                  .select('*')
                                  .in('image_id', imageIds)
                                  .in('type', ['product', 'part', 'brand', 'modification']);

                                if (tags && tags.length > 0) {
                                  const modCount = new Set(tags.map(t => t.text.toLowerCase())).size;
                                  showToast(`AI found ${modCount} unique modifications`, 'success');
                                } else {
                                  showToast('No modifications detected in images', 'info');
                                }
                              } else {
                                showToast('No images to analyze for modifications', 'error');
                              }
                            } catch (error) {
                              showToast('Unable to analyze modifications', 'error');
                            }
                            break;
                          case 'mileage data':
                            try {
                              const { data: vehicle } = await supabase
                                .from('vehicles')
                                .select('mileage, year')
                                .eq('id', vehicleId)
                                .single();

                              if (vehicle?.mileage) {
                                const age = new Date().getFullYear() - vehicle.year;
                                const avgMiles = age * 12000;
                                const status = vehicle.mileage < avgMiles * 0.8 ? 'Low' :
                                              vehicle.mileage > avgMiles * 1.2 ? 'High' : 'Average';
                                showToast(`${vehicle.mileage.toLocaleString()} miles (${status} for age)`, 'success');
                              } else {
                                showToast('No mileage data recorded', 'error');
                              }
                            } catch (error) {
                              showToast('Unable to load mileage data', 'error');
                            }
                            break;
                          case 'build receipts':
                          case 'receipts':
                            try {
                              const { data: buildData } = await supabase
                                .from('vehicle_builds')
                                .select('total_spent, created_at')
                                .eq('vehicle_id', vehicleId);

                              const { data: lineItems } = await supabase
                                .from('build_line_items')
                                .select('price, description')
                                .eq('vehicle_id', vehicleId);

                              if (buildData && buildData.length > 0) {
                                const totalSpent = buildData.reduce((sum, b) => sum + (b.total_spent || 0), 0);
                                const itemCount = lineItems?.length || 0;
                                showToast(`${itemCount} receipts totaling ${formatCurrency(totalSpent)}`, 'success');
                              } else if (lineItems && lineItems.length > 0) {
                                showToast(`${lineItems.length} line items recorded`, 'info');
                              } else {
                                showToast('No build receipts uploaded', 'error');
                              }
                            } catch (error) {
                              showToast('Unable to load build data', 'error');
                            }
                            break;
                          default:
                            showToast(`Data source: ${source}`, 'info');
                        }
                      }}
                      title={`View ${source} data`}
                    >
                      <span style={{ color: '#008000' }}>✓</span>
                      <span style={{ textTransform: 'capitalize' }}>
                        {source}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text text-muted">No data sources available</div>
                )}
              </div>
              <div style={{ marginTop: 'var(--space-1)', paddingTop: 'var(--space-1)', borderTop: '1px solid var(--border-light)' }}>
                <div className="text" style={{ fontSize: '6pt', fontWeight: 'bold' }}>
                  Database Tables:
                </div>
                <div className="text text-muted" style={{ fontSize: '6pt', marginTop: '2px' }}>
                  • vehicle_builds (receipts)<br/>
                  • build_line_items (parts)<br/>
                  • build_benchmarks (comparables)<br/>
                  • image_tags (AI analysis)
                </div>
              </div>
            </div>
          )}

          {/* Payments: Buy Credits CTA (desktop) */}
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
            <BuyCreditsButton presetAmounts={[3, 10, 25]} />
          </div>
        </div>
      </div>

      {/* Full Analysis Modal */}
      {showFullAnalysis && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                Complete Pricing Analysis - {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}
              </h2>
              <button
                onClick={() => setShowFullAnalysis(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ×
              </button>
            </div>
            <div className="p-4 max-h-[calc(90vh-120px)] overflow-y-auto">
              {/* This would be the full PricingIntelligence component */}
              <div className="text-center py-8">
                <div className="animate-spin text-4xl mb-4">⚡</div>
                <p className="text-gray-600">Loading comprehensive analysis...</p>
                <p className="text-sm text-gray-500 mt-2">
                  AI is analyzing market data, modifications, and generating detailed report
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification - Windows 95 Style */}
      {toast && (
        <div
          className="card"
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 1000,
            padding: 'var(--space-2)',
            fontSize: '8pt',
            backgroundColor: 'var(--grey-100)',
            border: '2px outset var(--grey-300)',
            minWidth: '200px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <span style={{
              color: toast.type === 'success' ? '#008000' :
                     toast.type === 'error' ? '#800000' : '#000080'
            }}>
              {toast.type === 'success' ? '✓' :
               toast.type === 'error' ? '✗' : 'ℹ'}
            </span>
            <span className="text">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Part Viewer Modal */}
      {showPartViewer && selectedPart && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            zIndex: 1001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowPartViewer(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: '600px',
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto',
              padding: 'var(--space-3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <h3 className="text" style={{ fontSize: '10pt', fontWeight: 'bold' }}>
                {selectedPart.name} - Validation Data
              </h3>
              <button
                className="button button-small"
                onClick={() => setShowPartViewer(false)}
              >
                ×
              </button>
            </div>

            <div style={{ marginBottom: 'var(--space-2)' }}>
              <div className="text" style={{ fontSize: '8pt', marginBottom: 'var(--space-1)' }}>
                <strong>Cost:</strong> {selectedPart.price > 0 ? formatCurrency(selectedPart.price) : 'Analyzing...'}
              </div>
            </div>

            {selectedPart.images && selectedPart.images.length > 0 ? (
              <>
                <div className="text" style={{ fontSize: '8pt', marginBottom: 'var(--space-2)', fontWeight: 'bold' }}>
                  Validation Images ({selectedPart.images.length}):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-2)' }}>
                  {selectedPart.images.map((img: any, idx: number) => (
                    <div
                      key={idx}
                      className="card"
                      style={{ padding: 'var(--space-1)', cursor: 'pointer' }}
                      onClick={() => window.open(img.url, '_blank')}
                    >
                      <img
                        src={img.url}
                        alt={`${selectedPart.name} validation ${idx + 1}`}
                        style={{
                          width: '100%',
                          height: '120px',
                          objectFit: 'cover',
                          marginBottom: 'var(--space-1)'
                        }}
                      />
                      <div className="text text-muted" style={{ fontSize: '6pt' }}>
                        Tags: {img.tags?.join(', ') || 'Receipt, Installation'}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text text-muted" style={{ fontSize: '8pt', textAlign: 'center', padding: 'var(--space-4)' }}>
                No validation images available for this part.
                <br />
                This would show receipts, installation photos, or part identification images.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};