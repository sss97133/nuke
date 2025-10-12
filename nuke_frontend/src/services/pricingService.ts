/**
 * Pricing Intelligence Service - "The Ultimate Appraisal Tool"
 *
 * This service connects to the AI-powered automated pricing system
 * to provide instant, data-driven vehicle valuations with real market data.
 */

import axios from 'axios';

// Create API instance for pricing endpoints
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || import.meta.env.VITE_PHOENIX_API_URL || 'http://localhost:4000/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface PriceIntelligence {
  total_estimated_value: string;
  confidence_score: number;
  valuation_breakdown: {
    base_market_value: string;
    modification_impact: string;
    condition_adjustment: string;
    market_factors: string;
    rarity_multiplier: number;
  };
  visual_evidence: {
    total_images: number;
    high_value_images: number;
    verification_quality: number;
  };
  value_drivers: {
    key_modifications: any[];
    premium_brands: any[];
    documented_work: number;
    image_count: number;
    verification_quality: number;
  };
  risk_factors: {
    high_mileage: boolean;
    flood_damage: boolean;
    accident_history: boolean;
    modified_heavily: boolean;
    incomplete_documentation: boolean;
  };
  market_comparables: any[];
}

export interface ModificationAnalysis {
  vehicle_id: string;
  total_modification_impact: string;
  detailed_analysis: {
    modification_name: string;
    modification_type: string;
    brand: string;
    value_impact: string;
    quality_assessment: {
      installation_quality: string;
      visual_verification_score: number;
      documentation_quality: string;
    };
    market_factors: {
      market_demand: string;
      depreciation_rate: number;
      resale_factor: number;
    };
  }[];
  modification_count: number;
  summary: {
    total_modification_value: string;
    modification_categories: {
      performance: number;
      aesthetic: number;
      functional: number;
    };
    average_quality_score: number;
    high_value_modifications: any[];
  };
}

export interface MarketComparison {
  vehicle_id: string;
  vehicle_info: {
    year: number;
    make: string;
    model: string;
    trim: string;
    mileage: number;
  };
  market_intelligence: {
    estimated_base_value: string;
    confidence_score: number;
    source_count: number;
  };
  sources: {
    source: string;
    data_type: string;
    price_value: string;
    price_range: {
      low: string;
      high: string;
    };
    confidence_score: number;
    location: string;
    last_updated: string;
  }[];
  generated_at: string;
}

export interface PriceHistory {
  vehicle_id: string;
  price_history: {
    estimated_value: string;
    mileage_at_time: number;
    valuation_date: string;
    value_change: string;
    percent_change: number;
    change_reason: string;
    confidence_score: number;
    data_source: string;
  }[];
  trend_analysis: {
    trend: string;
    change_percentage: number;
    value_change: string;
    time_period_days: number;
  };
  total_valuations: number;
}

class PricingService {
  /**
   * Generate comprehensive AI-powered price intelligence for a vehicle
   * This is the main "Ultimate Appraisal Tool" endpoint using:
   * - Real-time market data scraping
   * - OpenAI analysis with custom prompts
   * - Configurable pricing equations
   * - Human oversight capabilities
   */
  async generatePriceIntelligence(vehicleId: string): Promise<PriceIntelligence> {
    const response = await api.post(`/vehicles/${vehicleId}/price-intelligence`);
    return response.data.pricing_intelligence;
  }

  /**
   * Get the automated analysis status for a vehicle
   */
  async getAnalysisStatus(vehicleId: string) {
    const response = await api.get(`/vehicles/${vehicleId}/analysis-status`);
    return response.data;
  }

  /**
   * Trigger manual re-analysis with fresh data (for power users)
   */
  async triggerManualAnalysis(vehicleId: string, options = {}) {
    const response = await api.post(`/vehicles/${vehicleId}/trigger-analysis`, options);
    return response.data;
  }

  /**
   * Get human review queue (for experts/admins)
   */
  async getHumanReviewQueue() {
    const response = await api.get('/pricing/human-review-queue');
    return response.data;
  }

  /**
   * Submit human override for vehicle pricing
   */
  async submitPricingOverride(vehicleId: string, overrideData: any) {
    const response = await api.post(`/vehicles/${vehicleId}/pricing-override`, overrideData);
    return response.data;
  }

  /**
   * Get detailed modification analysis showing how each mod affects value
   */
  async getModificationAnalysis(vehicleId: string): Promise<ModificationAnalysis> {
    const response = await api.get(`/vehicles/${vehicleId}/modification-analysis`);
    return response.data;
  }

  /**
   * Get market data comparison from multiple external sources
   */
  async getMarketComparison(vehicleId: string): Promise<MarketComparison> {
    const response = await api.get(`/vehicles/${vehicleId}/market-comparison`);
    return response.data;
  }

  /**
   * Get price history and trend analysis for a vehicle
   */
  async getPriceHistory(vehicleId: string): Promise<PriceHistory> {
    const response = await api.get(`/vehicles/${vehicleId}/price-history`);
    return response.data;
  }

  /**
   * Format currency values for display
   */
  formatCurrency(value: string | number): string {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numValue);
  }

  /**
   * Format percentage values for display
   */
  formatPercentage(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  }

  /**
   * Calculate total estimated value from breakdown
   */
  calculateTotalValue(breakdown: PriceIntelligence['valuation_breakdown']): number {
    const base = parseFloat(breakdown.base_market_value);
    const mods = parseFloat(breakdown.modification_impact);
    const condition = parseFloat(breakdown.condition_adjustment);
    const market = parseFloat(breakdown.market_factors);

    return (base + mods + condition + market) * breakdown.rarity_multiplier;
  }

  /**
   * Get confidence level text from score
   */
  getConfidenceLevel(score: number): string {
    if (score >= 90) return 'Extremely High';
    if (score >= 80) return 'High';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Moderate';
    if (score >= 50) return 'Fair';
    return 'Low';
  }

  /**
   * Get trend direction with emoji
   */
  getTrendIcon(trend: string): string {
    switch (trend) {
      case 'increasing': return '📈';
      case 'decreasing': return '📉';
      case 'stable': return '➡️';
      default: return '❓';
    }
  }

  /**
   * Get quality badge color
   */
  getQualityColor(quality: string): string {
    switch (quality) {
      case 'professional': return '#10B981'; // green
      case 'diy_good': return '#F59E0B'; // amber
      case 'diy_poor': return '#EF4444'; // red
      default: return '#6B7280'; // gray
    }
  }

  /**
   * Get market demand badge color
   */
  getDemandColor(demand: string): string {
    switch (demand) {
      case 'high': return '#10B981'; // green
      case 'medium': return '#F59E0B'; // amber
      case 'low': return '#EF4444'; // red
      default: return '#6B7280'; // gray
    }
  }
}

export const pricingService = new PricingService();
export default pricingService;