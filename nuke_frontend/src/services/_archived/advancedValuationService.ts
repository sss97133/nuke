/**
 * Advanced Valuation Service
 * Implements sophisticated value estimation using:
 * - Guidrails and manuals for parts pricing
 * - Labor values based on documented time
 * - Market averages from comparables
 * - User skill levels for labor discounting
 * - Material usage tracking
 * - Product associations
 */

import { supabase } from '../lib/supabase';

export interface UserSkillProfile {
  userId: string;
  skillLevel: 'novice' | 'intermediate' | 'expert' | 'professional';
  specialties: string[];
  verifiedHours: number;
  qualityRating: number; // 1-10 based on work quality
  laborDiscountFactor: number; // 0.5-1.0 (experts save on labor costs)
}

export interface GuidelinePrice {
  partName: string;
  category: string;
  marketLow: number;
  marketAvg: number;
  marketHigh: number;
  laborHours: number;
  skillRequired: 'basic' | 'intermediate' | 'expert';
  source: 'manual' | 'guideline' | 'market_data';
}

export interface AdvancedValuation {
  totalValue: number;
  breakdown: {
    baseValue: number;
    partsValue: number;
    laborValue: number;
    skillAdjustment: number;
    marketAdjustment: number;
    qualityBonus: number;
  };
  confidence: number;
  guidanceUsed: GuidelinePrice[];
  userSkillImpact: {
    laborSavings: number;
    qualityBonus: number;
    skillLevel: string;
  };
  marketComparison: {
    averageForYear: number;
    percentileRank: number;
    comparables: number;
  };
}

export class AdvancedValuationService {
  /**
   * Get comprehensive valuation using all available algorithms and data sources
   */
  static async getAdvancedValuation(vehicleId: string, userId?: string): Promise<AdvancedValuation> {
    try {
      // Get base vehicle info
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (!vehicle) {
        throw new Error('Vehicle not found');
      }

      // Get user skill profile if provided
      const userProfile = userId ? await this.getUserSkillProfile(userId) : null;

      // Get guidelines and manual pricing
      const guidelines = await this.getApplicableGuidelines(vehicle);

      // Get market comparables
      const marketData = await this.getMarketComparables(vehicle);

      // Get AI-detected parts and systems
      const { data: aiValuation } = await supabase
        .rpc('calculate_ai_vehicle_valuation', { p_vehicle_id: vehicleId });

      const aiResult = aiValuation?.[0];

      // Calculate base values
      let baseValue = parseFloat(aiResult?.base_value) || vehicle.purchase_price || 15000;
      let partsValue = 0;
      let laborValue = 0;
      let skillAdjustment = 0;
      let marketAdjustment = 0;
      let qualityBonus = 0;

      // Apply guideline pricing to detected parts
      const detectedWork = await this.getDetectedWork(vehicleId);
      const guidelinesUsed: GuidelinePrice[] = [];

      for (const work of detectedWork) {
        const applicableGuidelines = guidelines.filter(g =>
          work.systems.some(system =>
            g.category.toLowerCase().includes(system.toLowerCase()) ||
            g.partName.toLowerCase().includes(system.toLowerCase())
          )
        );

        for (const guideline of applicableGuidelines) {
          partsValue += guideline.marketAvg;

          // Calculate labor based on guideline and user skill
          let laborCost = guideline.laborHours * 75; // Standard $75/hr rate

          if (userProfile) {
            const discount = this.calculateLaborDiscount(guideline.skillRequired, userProfile);
            laborCost *= discount;
            skillAdjustment += laborCost * (1 - discount);
          }

          laborValue += laborCost;
          guidelinesUsed.push(guideline);
        }
      }

      // Apply market adjustments
      if (marketData.averagePrice > 0) {
        const expectedValue = baseValue + partsValue + laborValue;
        const marketDelta = marketData.averagePrice - expectedValue;
        marketAdjustment = marketDelta * 0.3; // 30% weight to market
      }

      // Quality bonus based on documentation and user skill
      if (userProfile && userProfile.qualityRating > 7) {
        qualityBonus = (baseValue + partsValue) * 0.05; // 5% quality bonus
      }

      // Calculate final values
      const totalValue = Math.round(
        baseValue +
        partsValue +
        laborValue +
        skillAdjustment +
        marketAdjustment +
        qualityBonus
      );

      // Calculate confidence based on data sources
      let confidence = 60;
      if (aiResult) confidence += 20;
      if (guidelines.length > 0) confidence += 15;
      if (marketData.comparables > 2) confidence += 10;
      if (userProfile) confidence += 10;

      return {
        totalValue,
        breakdown: {
          baseValue: Math.round(baseValue),
          partsValue: Math.round(partsValue),
          laborValue: Math.round(laborValue),
          skillAdjustment: Math.round(skillAdjustment),
          marketAdjustment: Math.round(marketAdjustment),
          qualityBonus: Math.round(qualityBonus)
        },
        confidence: Math.min(confidence, 95),
        guidanceUsed: guidelinesUsed.slice(0, 10), // Top 10 most relevant
        userSkillImpact: userProfile ? {
          laborSavings: Math.round(skillAdjustment),
          qualityBonus: Math.round(qualityBonus),
          skillLevel: userProfile.skillLevel
        } : {
          laborSavings: 0,
          qualityBonus: 0,
          skillLevel: 'unknown'
        },
        marketComparison: {
          averageForYear: Math.round(marketData.averagePrice),
          percentileRank: this.calculatePercentileRank(totalValue, marketData.allPrices),
          comparables: marketData.comparables
        }
      };

    } catch (error) {
      console.error('Advanced valuation error:', error);

      // Return basic valuation on error
      return {
        totalValue: 0,
        breakdown: {
          baseValue: 0,
          partsValue: 0,
          laborValue: 0,
          skillAdjustment: 0,
          marketAdjustment: 0,
          qualityBonus: 0
        },
        confidence: 0,
        guidanceUsed: [],
        userSkillImpact: {
          laborSavings: 0,
          qualityBonus: 0,
          skillLevel: 'unknown'
        },
        marketComparison: {
          averageForYear: 0,
          percentileRank: 0,
          comparables: 0
        }
      };
    }
  }

  /**
   * Get user skill profile from their work history and verifications
   */
  private static async getUserSkillProfile(userId: string): Promise<UserSkillProfile | null> {
    try {
      // Get user's documented work history
      const { data: workHistory } = await supabase
        .from('vehicle_timeline_events')
        .select('labor_hours, metadata, event_type')
        .eq('user_id', userId)
        .not('labor_hours', 'is', null);

      if (!workHistory || workHistory.length === 0) {
        return null;
      }

      // Calculate verified hours
      const verifiedHours = workHistory.reduce((sum, work) => sum + (work.labor_hours || 0), 0);

      // Determine skill level based on hours and complexity
      let skillLevel: UserSkillProfile['skillLevel'] = 'novice';
      if (verifiedHours > 500) skillLevel = 'professional';
      else if (verifiedHours > 200) skillLevel = 'expert';
      else if (verifiedHours > 50) skillLevel = 'intermediate';

      // Extract specialties from work types
      const specialties = [
        ...new Set(
          workHistory
            .map(w => w.metadata?.category || w.event_type)
            .filter(Boolean)
            .slice(0, 5)
        )
      ];

      // Calculate quality rating based on work complexity and outcomes
      const qualityRating = Math.min(10, 5 + (verifiedHours / 100));

      // Calculate labor discount factor (experts save money on labor)
      const laborDiscountFactor = Math.max(0.5, 1 - (verifiedHours / 1000));

      return {
        userId,
        skillLevel,
        specialties,
        verifiedHours,
        qualityRating,
        laborDiscountFactor
      };

    } catch (error) {
      console.error('Error getting user skill profile:', error);
      return null;
    }
  }

  /**
   * Get applicable pricing guidelines from manuals and market data
   */
  private static async getApplicableGuidelines(vehicle: any): Promise<GuidelinePrice[]> {
    // This would integrate with pricing guides, manuals, and market data
    // For now, return common guidelines based on vehicle type
    const guidelines: GuidelinePrice[] = [];

    // Classic truck guidelines (1960-1990)
    if (vehicle.year >= 1960 && vehicle.year <= 1990 &&
        ['chevrolet', 'gmc', 'ford', 'dodge'].includes(vehicle.make?.toLowerCase())) {
      guidelines.push(
        {
          partName: 'Engine Rebuild',
          category: 'engine',
          marketLow: 3000,
          marketAvg: 5000,
          marketHigh: 8000,
          laborHours: 40,
          skillRequired: 'expert',
          source: 'manual'
        },
        {
          partName: 'Body Panel Replacement',
          category: 'body',
          marketLow: 500,
          marketAvg: 1200,
          marketHigh: 2000,
          laborHours: 16,
          skillRequired: 'intermediate',
          source: 'guideline'
        },
        {
          partName: 'Paint Job',
          category: 'paint',
          marketLow: 2000,
          marketAvg: 4000,
          marketHigh: 8000,
          laborHours: 60,
          skillRequired: 'expert',
          source: 'market_data'
        },
        {
          partName: 'Suspension Upgrade',
          category: 'suspension',
          marketLow: 800,
          marketAvg: 1500,
          marketHigh: 3000,
          laborHours: 12,
          skillRequired: 'intermediate',
          source: 'guideline'
        }
      );
    }

    return guidelines;
  }

  /**
   * Get market comparables for similar vehicles
   */
  private static async getMarketComparables(vehicle: any): Promise<{
    averagePrice: number;
    allPrices: number[];
    comparables: number;
  }> {
    try {
      // Get build benchmarks for similar vehicles
      const { data: benchmarks } = await supabase
        .from('build_benchmarks')
        .select('sale_price, build_cost, year')
        .eq('make', vehicle.make)
        .gte('year', vehicle.year - 5)
        .lte('year', vehicle.year + 5)
        .not('sale_price', 'is', null);

      if (!benchmarks || benchmarks.length === 0) {
        return { averagePrice: 0, allPrices: [], comparables: 0 };
      }

      const prices = benchmarks.map(b => b.sale_price).filter(p => p > 0);
      const averagePrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;

      return {
        averagePrice,
        allPrices: prices,
        comparables: prices.length
      };

    } catch (error) {
      console.error('Error getting market comparables:', error);
      return { averagePrice: 0, allPrices: [], comparables: 0 };
    }
  }

  /**
   * Get detected work from AI analysis and timeline events
   */
  private static async getDetectedWork(vehicleId: string): Promise<Array<{
    date: string;
    systems: string[];
    imageCount: number;
    laborHours: number;
  }>> {
    try {
      const { data: workSessions } = await supabase
        .rpc('get_vehicle_work_sessions', { p_vehicle_id: vehicleId });

      if (!workSessions) return [];

      return workSessions.map((session: any) => ({
        date: session.work_date,
        systems: this.categorizeWorkSystems(session.detected_work || ''),
        imageCount: session.image_count,
        laborHours: session.labor_hours || 0
      }));

    } catch (error) {
      console.error('Error getting detected work:', error);
      return [];
    }
  }

  /**
   * Categorize work into major systems
   */
  private static categorizeWorkSystems(detectedWork: string): string[] {
    const work = detectedWork.toLowerCase();
    const systems: string[] = [];

    if (work.includes('engine') || work.includes('block')) systems.push('engine');
    if (work.includes('body') || work.includes('panel')) systems.push('body');
    if (work.includes('paint') || work.includes('primer')) systems.push('paint');
    if (work.includes('suspension') || work.includes('shock')) systems.push('suspension');
    if (work.includes('brake') || work.includes('caliper')) systems.push('brakes');
    if (work.includes('interior') || work.includes('seat')) systems.push('interior');
    if (work.includes('electrical') || work.includes('wiring')) systems.push('electrical');

    return systems.length > 0 ? systems : ['general'];
  }

  /**
   * Calculate labor discount based on skill level vs requirement
   */
  private static calculateLaborDiscount(required: string, userProfile: UserSkillProfile): number {
    const skillLevels = { 'novice': 1, 'intermediate': 2, 'expert': 3, 'professional': 4 };
    const requiredLevels = { 'basic': 1, 'intermediate': 2, 'expert': 3 };

    const userLevel = skillLevels[userProfile.skillLevel];
    const reqLevel = requiredLevels[required] || 2;

    // Higher skill than required = labor savings
    if (userLevel > reqLevel) {
      return userProfile.laborDiscountFactor;
    }

    // Equal skill = full cost
    if (userLevel === reqLevel) {
      return 1.0;
    }

    // Lower skill = premium cost (learning curve)
    return 1.2;
  }

  /**
   * Calculate percentile rank compared to market
   */
  private static calculatePercentileRank(value: number, marketPrices: number[]): number {
    if (marketPrices.length === 0) return 50;

    const lowerCount = marketPrices.filter(p => p < value).length;
    return Math.round((lowerCount / marketPrices.length) * 100);
  }
}