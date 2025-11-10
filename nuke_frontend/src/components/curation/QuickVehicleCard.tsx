/**
 * Quick Vehicle Card - Secretary Mode
 * 
 * Transform passive cards into active curation interfaces
 * User = Boss reviewing papers, not data entry clerk
 * AI presents findings, user validates/corrects in seconds
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { FiCheck, FiX, FiEdit2, FiMessageSquare, FiEye, FiAlertCircle } from 'react-icons/fi';

interface QuickVehicleCardProps {
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    vin?: string;
    current_value?: number;
    image_url?: string;
  };
  onValidate?: (vehicleId: string, action: 'approve' | 'reject' | 'correct') => void;
  showQuickActions?: boolean;
}

interface PendingItem {
  id: string;
  type: 'ai_detection' | 'missing_field' | 'price_update' | 'duplicate';
  description: string;
  confidence?: number;
  suggestedValue?: any;
}

const QuickVehicleCard: React.FC<QuickVehicleCardProps> = ({ 
  vehicle, 
  onValidate,
  showQuickActions = true 
}) => {
  const navigate = useNavigate();
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadPendingItems();
  }, [vehicle.id]);

  const loadPendingItems = async () => {
    try {
      // Check for AI detections needing validation
      const { data: detections } = await supabase
        .from('ai_component_detections')
        .select('id, component_name, confidence, estimated_cost_cents')
        .eq('vehicle_id', vehicle.id)
        .is('user_validated', null) // Not yet validated
        .limit(3);

      // Check for missing required fields
      const missingFields: PendingItem[] = [];
      if (!vehicle.vin) {
        missingFields.push({
          id: 'missing_vin',
          type: 'missing_field',
          description: 'VIN not entered',
          suggestedValue: null
        });
      }

      // Combine
      const items: PendingItem[] = [
        ...(detections || []).map(d => ({
          id: d.id,
          type: 'ai_detection' as const,
          description: `AI found: ${d.component_name}`,
          confidence: d.confidence * 100,
          suggestedValue: d.estimated_cost_cents ? `$${(d.estimated_cost_cents / 100).toFixed(0)}` : null
        })),
        ...missingFields
      ];

      setPendingItems(items);
    } catch (error) {
      console.error('Failed to load pending items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (itemId: string) => {
    try {
      await supabase
        .from('ai_component_detections')
        .update({ 
          user_validated: true,
          validation_result: 'approved',
          validated_at: new Date().toISOString()
        })
        .eq('id', itemId);

      // Remove from pending
      setPendingItems(prev => prev.filter(item => item.id !== itemId));
      onValidate?.(vehicle.id, 'approve');
    } catch (error) {
      console.error('Approve failed:', error);
    }
  };

  const handleReject = async (itemId: string) => {
    try {
      await supabase
        .from('ai_component_detections')
        .update({ 
          user_validated: true,
          validation_result: 'rejected',
          validated_at: new Date().toISOString()
        })
        .eq('id', itemId);

      setPendingItems(prev => prev.filter(item => item.id !== itemId));
      onValidate?.(vehicle.id, 'reject');
    } catch (error) {
      console.error('Reject failed:', error);
    }
  };

  const pendingCount = pendingItems.length;

  return (
    <div 
      className="card hover:shadow-lg transition-all cursor-pointer"
      style={{ 
        borderLeft: pendingCount > 0 ? '4px solid #f59e0b' : '4px solid transparent',
        position: 'relative'
      }}
    >
      {/* Pending Badge */}
      {pendingCount > 0 && (
        <div 
          className="absolute top-2 right-2 bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          <FiAlertCircle className="w-3 h-3" />
          {pendingCount}
        </div>
      )}

      <div 
        className="card-body" 
        onClick={() => !expanded && navigate(`/vehicle/${vehicle.id}`)}
      >
        <div className="flex gap-3">
          {/* Thumbnail */}
          {vehicle.image_url && (
            <img 
              src={vehicle.image_url} 
              alt={`${vehicle.year} ${vehicle.make}`}
              className="w-20 h-20 object-cover rounded"
            />
          )}

          {/* Vehicle Info */}
          <div className="flex-1">
            <h4 className="font-semibold text-gray-900">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h4>
            {vehicle.vin && (
              <div className="text-xs text-gray-600 font-mono">{vehicle.vin}</div>
            )}
            {vehicle.current_value && (
              <div className="text-sm font-semibold text-green-600 mt-1">
                ${vehicle.current_value.toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* Expanded Quick Actions */}
        {expanded && showQuickActions && pendingItems.length > 0 && (
          <div 
            className="mt-3 pt-3 border-t border-gray-200 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            {pendingItems.map((item) => (
              <div 
                key={item.id}
                className="p-2 bg-orange-50 rounded flex items-center justify-between"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {item.description}
                  </div>
                  {item.confidence && (
                    <div className="text-xs text-gray-600">
                      AI Confidence: {item.confidence.toFixed(0)}%
                    </div>
                  )}
                  {item.suggestedValue && (
                    <div className="text-xs text-gray-600">
                      Estimated: {item.suggestedValue}
                    </div>
                  )}
                </div>

                {/* Quick Action Buttons */}
                <div className="flex items-center gap-2 ml-3">
                  <button
                    onClick={() => handleApprove(item.id)}
                    className="p-2 rounded hover:bg-green-100 text-green-600 transition-colors"
                    title="Approve"
                  >
                    <FiCheck className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleReject(item.id)}
                    className="p-2 rounded hover:bg-red-100 text-red-600 transition-colors"
                    title="Reject"
                  >
                    <FiX className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => navigate(`/vehicle/${vehicle.id}#edit-${item.id}`)}
                    className="p-2 rounded hover:bg-blue-100 text-blue-600 transition-colors"
                    title="Correct"
                  >
                    <FiEdit2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {/* Collapse/Full Profile */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setExpanded(false)}
                className="text-xs text-gray-600 hover:text-gray-900"
              >
                Collapse
              </button>
              <button
                onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                className="text-xs text-blue-600 hover:text-blue-900 font-medium"
              >
                Full Profile →
              </button>
            </div>
          </div>
        )}

        {/* Quick Action Bar (Not Expanded) */}
        {!expanded && showQuickActions && pendingCount > 0 && (
          <div className="mt-2 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              className="text-xs px-3 py-1 bg-orange-100 text-orange-800 rounded hover:bg-orange-200"
            >
              Review {pendingCount} item{pendingCount > 1 ? 's' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickVehicleCard;

