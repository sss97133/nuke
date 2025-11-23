/**
 * PROFILE COMPLETENESS CARD
 * 
 * Shows how complete a vehicle profile is based on database table population
 * Guides users on what to add next for maximum value
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface CompletenessData {
  completeness_score: number;
  tier: string;
  tier_description: string;
  breakdown: Record<string, {
    score: number;
    maxScore: number;
    present: number;
    total: number;
    percent: number;
  }>;
  priorities: Array<{
    table: string;
    value: number;
    action: string;
    impact: string;
  }>;
  context_implications: {
    image_processing_cost: string;
    confidence_level: string;
    ready_for_professional_appraisal: boolean;
  };
}

export default function ProfileCompletenessCard({ vehicleId }: { vehicleId: string }) {
  const [data, setData] = useState<CompletenessData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCompleteness();
  }, [vehicleId]);

  async function loadCompleteness() {
    try {
      const { data: result, error } = await supabase.functions.invoke('calculate-profile-completeness', {
        body: { vehicle_id: vehicleId }
      });

      if (error) throw error;
      setData(result);
    } catch (error) {
      console.error('Error loading completeness:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-gray-900 border-2 border-gray-800 rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-800 rounded w-1/3 mb-4"></div>
          <div className="h-20 bg-gray-800 rounded"></div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const scoreColor = 
    data.completeness_score >= 80 ? 'text-green-400' :
    data.completeness_score >= 60 ? 'text-blue-400' :
    data.completeness_score >= 40 ? 'text-yellow-400' : 'text-red-400';

  const tierColor =
    data.tier === 'complete' ? 'bg-green-900 border-green-600 text-green-400' :
    data.tier === 'excellent' ? 'bg-blue-900 border-blue-600 text-blue-400' :
    data.tier === 'good' ? 'bg-yellow-900 border-yellow-600 text-yellow-400' :
    'bg-gray-900 border-gray-600 text-gray-400';

  return (
    <div className="bg-gray-900 border-2 border-gray-800 rounded-lg p-6">
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold mb-1">Profile Completeness</h3>
          <p className="text-sm text-gray-400">{data.tier_description}</p>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-bold ${scoreColor}`}>
            {data.completeness_score.toFixed(0)}%
          </div>
          <div className={`text-xs px-2 py-1 border rounded mt-1 inline-block ${tierColor}`}>
            {data.tier.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="bg-gray-800 rounded-full h-3">
          <div 
            className={`h-3 rounded-full transition-all duration-500 ${
              data.completeness_score >= 80 ? 'bg-green-600' :
              data.completeness_score >= 60 ? 'bg-blue-600' :
              data.completeness_score >= 40 ? 'bg-yellow-600' : 'bg-red-600'
            }`}
            style={{ width: `${data.completeness_score}%` }}
          />
        </div>
      </div>

      {/* Context Implications */}
      <div className="grid grid-cols-3 gap-3 mb-6 text-center text-sm">
        <div className="bg-gray-800 rounded p-3">
          <div className="text-gray-400 text-xs mb-1">Processing Cost</div>
          <div className={`font-semibold ${
            data.context_implications.image_processing_cost === 'ultra_low' ? 'text-green-400' :
            data.context_implications.image_processing_cost === 'low' ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {data.context_implications.image_processing_cost === 'ultra_low' ? '$0.0001/img' :
             data.context_implications.image_processing_cost === 'low' ? '$0.005/img' : '$0.02/img'}
          </div>
        </div>
        <div className="bg-gray-800 rounded p-3">
          <div className="text-gray-400 text-xs mb-1">AI Confidence</div>
          <div className={`font-semibold ${
            data.context_implications.confidence_level === 'high' ? 'text-green-400' :
            data.context_implications.confidence_level === 'medium' ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {data.context_implications.confidence_level.toUpperCase()}
          </div>
        </div>
        <div className="bg-gray-800 rounded p-3">
          <div className="text-gray-400 text-xs mb-1">Appraisal Ready</div>
          <div className={`font-semibold ${
            data.context_implications.ready_for_professional_appraisal ? 'text-green-400' : 'text-gray-500'
          }`}>
            {data.context_implications.ready_for_professional_appraisal ? 'YES' : 'NO'}
          </div>
        </div>
      </div>

      {/* Top Priorities */}
      {data.priorities.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 text-gray-300">
            Top Priorities to Improve Score
          </h4>
          <div className="space-y-2">
            {data.priorities.slice(0, 3).map((priority, idx) => (
              <div 
                key={idx}
                className="bg-gray-800 border border-gray-700 rounded p-3"
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="text-sm font-medium">{priority.action}</div>
                  <div className="text-green-400 text-sm font-bold">
                    +{priority.value.toFixed(1)} pts
                  </div>
                </div>
                <div className="text-xs text-gray-400">{priority.impact}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed Breakdown (Collapsible) */}
      <details className="mt-4">
        <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
          View detailed breakdown →
        </summary>
        <div className="mt-3 space-y-2 text-xs">
          {Object.entries(data.breakdown).map(([table, info]: [string, any]) => (
            <div key={table} className="flex items-center justify-between">
              <span className="text-gray-400">{table.replace(/_/g, ' ')}</span>
              <div className="flex items-center space-x-2">
                <span className="text-gray-500">{info.present}/{info.total}</span>
                <div className="w-16 bg-gray-800 rounded-full h-1.5">
                  <div 
                    className="bg-blue-600 h-1.5 rounded-full"
                    style={{ width: `${info.percent}%` }}
                  />
                </div>
                <span className={info.score > 0 ? 'text-green-400' : 'text-gray-600'}>
                  {info.score.toFixed(1)}/{info.maxScore}
                </span>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

