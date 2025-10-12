import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Database source types (from vehicle_field_sources table)
type DatabaseSourceType = 
  | 'ai_scraped'
  | 'user_input'
  | 'db_average'
  | 'human_verified'
  | 'professional';

interface FieldSourceSummary {
  source_type: DatabaseSourceType;
  field_count: number;
  percentage: number;
}

interface VehicleDataQualityRatingProps {
  vehicleId: string;
  className?: string;
}

interface QualityMetrics {
  humanVerificationPercentage: number;
  totalFields: number;
  sourceSummary: FieldSourceSummary[];
  overallRating: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  ratingColor: string;
  trustScore: number;
}

const VehicleDataQualityRating: React.FC<VehicleDataQualityRatingProps> = ({
  vehicleId,
  className = ''
}) => {
  const [metrics, setMetrics] = useState<QualityMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQualityMetrics();
  }, [vehicleId]);

  const loadQualityMetrics = async () => {
    try {
      setLoading(true);
      
      // First, get basic vehicle data to check what fields exist
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (!vehicleData) {
        setMetrics(null);
        return;
      }

      // Count filled fields in the vehicle itself
      const filledFields = [
        vehicleData.make,
        vehicleData.model, 
        vehicleData.year,
        vehicleData.vin,
        vehicleData.color,
        vehicleData.mileage,
        vehicleData.msrp,
        vehicleData.current_value,
        vehicleData.engine_size,
        vehicleData.transmission,
        vehicleData.fuel_type,
        vehicleData.drivetrain,
        vehicleData.body_style
      ].filter(field => field !== null && field !== undefined).length;

      // Try to get field sources data
      const { data: fieldSources } = await supabase
        .from('vehicle_field_sources')
        .select('field_name, source_type, confidence_score')
        .eq('vehicle_id', vehicleId);

      let humanPercentage = 0;
      let sourceSummary: FieldSourceSummary[] = [];
      
      if (fieldSources && fieldSources.length > 0) {
        // Group by source type
        const bySource: Record<string, number> = {};
        let humanVerified = 0;
        let total = fieldSources.length;
        
        fieldSources.forEach(source => {
          const sourceType = source.source_type || 'unknown';
          bySource[sourceType] = (bySource[sourceType] || 0) + 1;
          
          // Count human verified sources
          if (sourceType === 'human_verified' || sourceType === 'professional' || sourceType === 'user_input') {
            humanVerified++;
          }
        });
        
        humanPercentage = total > 0 ? Math.round((humanVerified / total) * 100) : 0;
        sourceSummary = Object.entries(bySource).map(([source_type, field_count]) => ({
          source_type: source_type as DatabaseSourceType,
          field_count,
          percentage: total ? Math.round((field_count / total) * 100) : 0
        }));
      } else if (filledFields > 0) {
        // No field sources, but we have vehicle data - treat as user input
        humanPercentage = vehicleData.user_id ? 75 : 0;
        sourceSummary = [{
          source_type: vehicleData.user_id ? 'user_input' : 'ai_scraped',
          field_count: filledFields,
          percentage: 100
        }];
      }

      const totalFields = sourceSummary.reduce((sum, source) => sum + source.field_count, 0) || filledFields;
      
      // Calculate overall rating based on human verification percentage and data completeness
      const rating = calculateOverallRating(humanPercentage, totalFields, sourceSummary);
      const trustScore = calculateTrustScore(humanPercentage, sourceSummary);

      setMetrics({
        humanVerificationPercentage: humanPercentage,
        totalFields,
        sourceSummary,
        overallRating: rating.grade,
        ratingColor: rating.color,
        trustScore
      });
    } catch (error) {
      console.error('Error loading quality metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateOverallRating = (
    humanPercentage: number, 
    totalFields: number, 
    sourceSummary: FieldSourceSummary[]
  ) => {
    // Start with base score based on data availability
    let score = totalFields > 0 ? 20 : 0; // Base 20 points for having data
    
    // Add points based on data completeness (up to 30 points)
    const completenessScore = Math.min((totalFields / 20) * 30, 30);
    score += completenessScore;
    
    // Add points based on verification quality (up to 50 points)
    const professionalFields = sourceSummary.find(s => s.source_type === 'professional')?.field_count || 0;
    const humanVerifiedFields = sourceSummary.find(s => s.source_type === 'human_verified')?.field_count || 0;
    const userInputFields = sourceSummary.find(s => s.source_type === 'user_input')?.field_count || 0;
    const aiFields = sourceSummary.find(s => s.source_type === 'ai_scraped')?.field_count || 0;
    
    if (totalFields > 0) {
      const verificationScore = 
        (professionalFields / totalFields) * 50 +
        (humanVerifiedFields / totalFields) * 45 +
        (userInputFields / totalFields) * 35 +
        (aiFields / totalFields) * 15;
      score += verificationScore;
    }

    // Convert to letter grade
    if (score >= 95) return { grade: 'A+' as const, color: '#22c55e' };
    if (score >= 90) return { grade: 'A' as const, color: '#16a34a' };
    if (score >= 85) return { grade: 'B+' as const, color: '#65a30d' };
    if (score >= 80) return { grade: 'B' as const, color: '#84cc16' };
    if (score >= 75) return { grade: 'C+' as const, color: '#eab308' };
    if (score >= 70) return { grade: 'C' as const, color: '#f59e0b' };
    if (score >= 60) return { grade: 'D' as const, color: '#f97316' };
    return { grade: 'F' as const, color: '#ef4444' };
  };

  const calculateTrustScore = (humanPercentage: number, sourceSummary: FieldSourceSummary[]): number => {
    if (sourceSummary.length === 0) return 0;
    
    // Calculate weighted trust score based on source types
    let totalWeight = 0;
    let weightedScore = 0;
    
    sourceSummary.forEach(source => {
      const weight = source.field_count;
      let score = 0;
      
      switch(source.source_type) {
        case 'professional':
          score = 100;
          break;
        case 'human_verified':
          score = 90;
          break;
        case 'user_input':
          score = 75;
          break;
        case 'db_average':
          score = 60;
          break;
        case 'ai_scraped':
          score = 30;
          break;
        default:
          score = 20;
      }
      
      weightedScore += score * weight;
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
  };

  const getRatingDescription = (rating: string): string => {
    switch (rating) {
      case 'A+': return 'Exceptional - Fully human-verified data';
      case 'A': return 'Excellent - Mostly human-verified';
      case 'B+': return 'Very Good - Good human verification';
      case 'B': return 'Good - Adequate verification';
      case 'C+': return 'Fair - Some verification needed';
      case 'C': return 'Average - Mixed AI/human data';
      case 'D': return 'Below Average - Mostly AI data';
      case 'F': return 'Poor - Unverified AI data';
      default: return 'No rating available';
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="animate-pulse bg-gray-200 h-6 w-16 rounded"></div>
        <div className="animate-pulse bg-gray-200 h-4 w-32 rounded"></div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className={`text-gray-500 text-sm ${className}`}>
        No data quality information available
      </div>
    );
  }

  return (
    <div className={`flex items-center space-x-3 ${className}`}>
      {/* Rating Badge */}
      <div 
        className="flex items-center justify-center w-12 h-8 rounded font-bold text-white text-sm"
        style={{ backgroundColor: metrics.ratingColor }}
      >
        {metrics.overallRating}
      </div>
      
      {/* Rating Details */}
      <div className="flex flex-col">
        <div className="text-sm font-medium text-gray-900">
          Data Quality: {getRatingDescription(metrics.overallRating)}
        </div>
        <div className="text-xs text-gray-600">
          {metrics.humanVerificationPercentage.toFixed(0)}% Human Verified • 
          Trust Score: {metrics.trustScore}/100 • 
          {metrics.totalFields} Fields
        </div>
      </div>

      {/* Detailed Breakdown (Tooltip/Expandable) */}
      <div className="text-xs text-gray-500 ml-auto">
        {metrics.sourceSummary.map(source => (
          <div key={source.source_type} className="flex justify-between">
            <span className="capitalize">{source.source_type.replace('_', ' ')}:</span>
            <span>{source.field_count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VehicleDataQualityRating;
