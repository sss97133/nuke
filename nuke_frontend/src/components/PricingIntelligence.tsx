/**
 * Pricing Intelligence Component - "The Ultimate Appraisal Tool"
 *
 * This component provides instant, data-driven vehicle valuations
 * that explain why modifications add or subtract value with visual proof.
 */

import React, { useState, useEffect } from 'react';
import type { pricingService, PriceIntelligence, ModificationAnalysis, MarketComparison } from '../services/pricingService';

interface PricingIntelligenceProps {
  vehicleId: string;
  onClose?: () => void;
}

export const PricingIntelligence: React.FC<PricingIntelligenceProps> = ({ vehicleId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'modifications' | 'market' | 'history'>('overview');
  const [priceIntelligence, setPriceIntelligence] = useState<PriceIntelligence | null>(null);
  const [modificationAnalysis, setModificationAnalysis] = useState<ModificationAnalysis | null>(null);
  const [marketComparison, setMarketComparison] = useState<MarketComparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (vehicleId) {
      generateFullAnalysis();
    }
  }, [vehicleId]);

  const generateFullAnalysis = async () => {
    setLoading(true);
    setError(null);

    try {
      // Load all pricing data in parallel
      const [intelligence, modifications, market] = await Promise.all([
        pricingService.generatePriceIntelligence(vehicleId),
        pricingService.getModificationAnalysis(vehicleId),
        pricingService.getMarketComparison(vehicleId),
      ]);

      setPriceIntelligence(intelligence);
      setModificationAnalysis(modifications);
      setMarketComparison(market);
    } catch (err: any) {
      setError(err.message || 'Failed to generate pricing intelligence');
      console.error('Pricing intelligence error:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderOverview = () => {
    if (!priceIntelligence) return null;

    return (
      <div className="space-y-6">
        {/* Main Valuation */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-xl p-6 border border-blue-200 dark:border-blue-700">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              {pricingService.formatCurrency(priceIntelligence.total_estimated_value)}
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-4">Estimated Market Value</p>
            <div className="flex items-center justify-center gap-2">
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                priceIntelligence.confidence_score >= 80 ? 'bg-green-100 text-green-800' :
                priceIntelligence.confidence_score >= 60 ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {priceIntelligence.confidence_score}% Confidence
              </div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                ({pricingService.getConfidenceLevel(priceIntelligence.confidence_score)})
              </span>
            </div>
          </div>
        </div>

        {/* Value Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Value Breakdown</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Base Market Value</span>
              <span className="font-medium">
                {pricingService.formatCurrency(priceIntelligence.valuation_breakdown.base_market_value)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Modification Impact</span>
              <span className={`font-medium ${
                parseFloat(priceIntelligence.valuation_breakdown.modification_impact) >= 0
                ? 'text-green-600' : 'text-red-600'
              }`}>
                {parseFloat(priceIntelligence.valuation_breakdown.modification_impact) >= 0 ? '+' : ''}
                {pricingService.formatCurrency(priceIntelligence.valuation_breakdown.modification_impact)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Condition Adjustment</span>
              <span className={`font-medium ${
                parseFloat(priceIntelligence.valuation_breakdown.condition_adjustment) >= 0
                ? 'text-green-600' : 'text-red-600'
              }`}>
                {parseFloat(priceIntelligence.valuation_breakdown.condition_adjustment) >= 0 ? '+' : ''}
                {pricingService.formatCurrency(priceIntelligence.valuation_breakdown.condition_adjustment)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600 dark:text-gray-400">Market Factors</span>
              <span className={`font-medium ${
                parseFloat(priceIntelligence.valuation_breakdown.market_factors) >= 0
                ? 'text-green-600' : 'text-red-600'
              }`}>
                {parseFloat(priceIntelligence.valuation_breakdown.market_factors) >= 0 ? '+' : ''}
                {pricingService.formatCurrency(priceIntelligence.valuation_breakdown.market_factors)}
              </span>
            </div>
            <div className="flex justify-between items-center border-t pt-3">
              <span className="text-gray-600 dark:text-gray-400">Rarity Multiplier</span>
              <span className="font-medium">
                {priceIntelligence.valuation_breakdown.rarity_multiplier}x
              </span>
            </div>
          </div>
        </div>

        {/* Visual Evidence */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Visual Evidence Quality</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {priceIntelligence.visual_evidence.total_images}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Images</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {priceIntelligence.visual_evidence.high_value_images}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">High-Value Images</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">Verification Quality</div>
            <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full"
                style={{ width: `${priceIntelligence.visual_evidence.verification_quality}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {priceIntelligence.visual_evidence.verification_quality.toFixed(1)}% verified
            </div>
          </div>
        </div>

        {/* Risk Factors */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Risk Assessment</h3>
          <div className="space-y-2">
            {Object.entries(priceIntelligence.risk_factors).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-gray-600 dark:text-gray-400 capitalize">
                  {key.replace(/_/g, ' ')}
                </span>
                <div className={`px-2 py-1 rounded text-xs font-medium ${
                  value ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                }`}>
                  {value ? 'Risk Detected' : 'No Issues'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderModifications = () => {
    if (!modificationAnalysis) return null;

    return (
      <div className="space-y-6">
        {/* Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Modification Summary</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {pricingService.formatCurrency(modificationAnalysis.summary.total_modification_value)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Added Value</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {modificationAnalysis.modification_count}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Modifications</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {modificationAnalysis.summary.average_quality_score.toFixed(1)}%
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Avg Quality</div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <div className="text-lg font-semibold text-red-700">
                {modificationAnalysis.summary.modification_categories.performance}
              </div>
              <div className="text-xs text-red-600">Performance</div>
            </div>
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <div className="text-lg font-semibold text-blue-700">
                {modificationAnalysis.summary.modification_categories.aesthetic}
              </div>
              <div className="text-xs text-blue-600">Aesthetic</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-lg font-semibold text-green-700">
                {modificationAnalysis.summary.modification_categories.functional}
              </div>
              <div className="text-xs text-green-600">Functional</div>
            </div>
          </div>
        </div>

        {/* Detailed Analysis */}
        <div className="space-y-4">
          {modificationAnalysis.detailed_analysis.map((mod, index) => (
            <div key={index} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white">{mod.modification_name}</h4>
                  {mod.brand && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">{mod.brand}</p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs">
                      {mod.modification_type}
                    </span>
                    <span
                      className="px-2 py-1 rounded text-xs text-white"
                      style={{ backgroundColor: pricingService.getDemandColor(mod.market_factors.market_demand) }}
                    >
                      {mod.market_factors.market_demand} demand
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-green-600">
                    {pricingService.formatCurrency(mod.value_impact)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Value Added</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-gray-600 dark:text-gray-400">Installation Quality</div>
                  <div
                    className="px-2 py-1 rounded text-xs text-white mt-1 inline-block"
                    style={{ backgroundColor: pricingService.getQualityColor(mod.quality_assessment.installation_quality) }}
                  >
                    {mod.quality_assessment.installation_quality.replace('_', ' ')}
                  </div>
                </div>
                <div>
                  <div className="text-gray-600 dark:text-gray-400">Visual Verification</div>
                  <div className="font-medium">{mod.quality_assessment.visual_verification_score.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-gray-600 dark:text-gray-400">Resale Factor</div>
                  <div className="font-medium">{(mod.market_factors.resale_factor * 100).toFixed(0)}%</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMarket = () => {
    if (!marketComparison) return null;

    return (
      <div className="space-y-6">
        {/* Market Intelligence */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Market Intelligence</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-xl font-bold text-blue-600">
                {pricingService.formatCurrency(marketComparison.market_intelligence.estimated_base_value)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Base Market Value</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-green-600">
                {marketComparison.market_intelligence.source_count}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Data Sources</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-purple-600">
                {marketComparison.market_intelligence.confidence_score.toFixed(1)}%
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Confidence</div>
            </div>
          </div>
        </div>

        {/* Data Sources */}
        <div className="space-y-4">
          {marketComparison.sources.map((source, index) => (
            <div key={index} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-white capitalize">{source.source}</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{source.data_type} • {source.location}</p>
                </div>
                <div className="text-right">
                  <div className="font-bold text-gray-900 dark:text-white">
                    {pricingService.formatCurrency(source.price_value)}
                  </div>
                  {source.price_range.low && source.price_range.high && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {pricingService.formatCurrency(source.price_range.low)} - {pricingService.formatCurrency(source.price_range.high)}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {source.confidence_score.toFixed(1)}% confidence
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <span className="ml-4 text-gray-600 dark:text-gray-400">Generating pricing intelligence...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-red-800 font-medium mb-2">Failed to Generate Pricing Intelligence</div>
        <div className="text-red-600 text-sm mb-4">{error}</div>
        <button
          onClick={generateFullAnalysis}
          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🎯 The Ultimate Appraisal Tool</h1>
            <p className="text-gray-600 dark:text-gray-400">Instant, data-driven vehicle valuation with visual evidence</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-400"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 mb-6">
        <div className="flex border-b">
          {[
            { key: 'overview', label: 'Overview', icon: '📊' },
            { key: 'modifications', label: 'Modifications', icon: '🔧' },
            { key: 'market', label: 'Market Data', icon: '📈' },
            { key: 'history', label: 'History', icon: '📅' }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-6 py-4 flex items-center gap-2 font-medium border-b-2 ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:text-white'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'modifications' && renderModifications()}
          {activeTab === 'market' && renderMarket()}
          {activeTab === 'history' && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <div className="text-4xl mb-4">📅</div>
              <div>Price history coming soon...</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PricingIntelligence;