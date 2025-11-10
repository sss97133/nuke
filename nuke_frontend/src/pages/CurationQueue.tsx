/**
 * Curation Queue - Secretary Mode Main Interface
 * 
 * Rapid data validation workflow
 * Swipe through items, approve/reject/correct
 * Keyboard shortcuts for speed
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { FiCheck, FiX, FiEdit2, FiSkipForward, FiArrowLeft } from 'react-icons/fi';

interface QueueItem {
  id: string;
  vehicle_id: string;
  vehicle_name: string;
  vehicle_image?: string;
  item_type: 'ai_detection' | 'missing_field' | 'duplicate' | 'price_update';
  description: string;
  ai_suggestion?: any;
  confidence?: number;
}

export default function CurationQueue() {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [stats, setStats] = useState({ approved: 0, rejected: 0, corrected: 0 });

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (session) {
      loadQueue();
    }
  }, [session]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Y') handleApprove();
      if (e.key === 'n' || e.key === 'N') handleReject();
      if (e.key === 'e' || e.key === 'E') handleEdit();
      if (e.key === 's' || e.key === 'S') handleSkip();
      if (e.key === 'Escape') navigate('/dashboard');
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [currentIndex, queue]);

  const loadSession = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    setSession(s);
  };

  const loadQueue = async () => {
    if (!session?.user) return;

    try {
      // Get all pending AI detections for user's vehicles
      const { data: detections } = await supabase
        .from('ai_component_detections')
        .select(`
          id,
          component_name,
          confidence,
          estimated_cost_cents,
          vehicle_id,
          vehicles!inner(year, make, model, vehicle_images(image_url))
        `)
        .is('user_validated', null)
        .limit(50);

      const items: QueueItem[] = (detections || []).map((d: any) => ({
        id: d.id,
        vehicle_id: d.vehicle_id,
        vehicle_name: `${d.vehicles.year} ${d.vehicles.make} ${d.vehicles.model}`,
        vehicle_image: d.vehicles.vehicle_images?.[0]?.image_url,
        item_type: 'ai_detection',
        description: d.component_name,
        ai_suggestion: {
          cost: d.estimated_cost_cents ? d.estimated_cost_cents / 100 : null
        },
        confidence: d.confidence * 100
      }));

      setQueue(items);
    } catch (error) {
      console.error('Failed to load queue:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (currentIndex >= queue.length) return;
    
    const item = queue[currentIndex];
    
    try {
      await supabase
        .from('ai_component_detections')
        .update({ 
          user_validated: true,
          validation_result: 'approved',
          validated_at: new Date().toISOString()
        })
        .eq('id', item.id);

      setStats(prev => ({ ...prev, approved: prev.approved + 1 }));
      nextItem();
    } catch (error) {
      console.error('Approve failed:', error);
    }
  };

  const handleReject = async () => {
    if (currentIndex >= queue.length) return;
    
    const item = queue[currentIndex];
    
    try {
      await supabase
        .from('ai_component_detections')
        .update({ 
          user_validated: true,
          validation_result: 'rejected',
          validated_at: new Date().toISOString()
        })
        .eq('id', item.id);

      setStats(prev => ({ ...prev, rejected: prev.rejected + 1 }));
      nextItem();
    } catch (error) {
      console.error('Reject failed:', error);
    }
  };

  const handleEdit = () => {
    const item = queue[currentIndex];
    navigate(`/vehicle/${item.vehicle_id}#edit-${item.id}`);
  };

  const handleSkip = () => {
    nextItem();
  };

  const nextItem = () => {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      // Queue complete!
      navigate('/dashboard');
    }
  };

  if (loading) {
    return (
      <div className="section">
        <div className="text-center">Loading curation queue...</div>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="section">
        <div className="card">
          <div className="card-body text-center">
            <FiCheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
            <h2 className="text-2xl font-bold mb-2">All Caught Up!</h2>
            <p className="text-gray-600 mb-4">
              No items need your review right now.
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              className="btn btn-primary"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentItem = queue[currentIndex];
  const progress = ((currentIndex + 1) / queue.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header with Progress */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <FiArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="text-sm font-medium">
              {currentIndex + 1} of {queue.length}
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-orange-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Review Area */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full">
          {/* Vehicle Context */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-4">
            <div className="flex gap-4 items-start mb-6">
              {currentItem.vehicle_image && (
                <img 
                  src={currentItem.vehicle_image}
                  alt={currentItem.vehicle_name}
                  className="w-24 h-24 object-cover rounded"
                />
              )}
              <div>
                <h3 className="text-xl font-bold mb-1">{currentItem.vehicle_name}</h3>
                <button
                  onClick={() => navigate(`/vehicle/${currentItem.vehicle_id}`)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  View Full Profile →
                </button>
              </div>
            </div>

            {/* Item to Review */}
            <div className="bg-orange-50 border-2 border-orange-200 rounded-lg p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm text-gray-600 uppercase tracking-wide mb-1">
                    AI Detected
                  </div>
                  <div className="text-2xl font-bold text-gray-900">
                    {currentItem.description}
                  </div>
                </div>
                {currentItem.confidence && (
                  <div className="text-right">
                    <div className="text-xs text-gray-600">Confidence</div>
                    <div className={`text-lg font-bold ${
                      currentItem.confidence >= 80 ? 'text-green-600' :
                      currentItem.confidence >= 60 ? 'text-yellow-600' :
                      'text-orange-600'
                    }`}>
                      {currentItem.confidence.toFixed(0)}%
                    </div>
                  </div>
                )}
              </div>

              {currentItem.ai_suggestion?.cost && (
                <div className="text-gray-700">
                  Estimated Cost: <span className="font-semibold">${currentItem.ai_suggestion.cost}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-4 gap-3">
            <button
              onClick={handleApprove}
              className="bg-green-500 hover:bg-green-600 text-white p-6 rounded-lg flex flex-col items-center gap-2 transition-colors"
            >
              <FiCheck className="w-8 h-8" />
              <span className="font-bold">Approve</span>
              <span className="text-xs opacity-80">(Y)</span>
            </button>

            <button
              onClick={handleReject}
              className="bg-red-500 hover:bg-red-600 text-white p-6 rounded-lg flex flex-col items-center gap-2 transition-colors"
            >
              <FiX className="w-8 h-8" />
              <span className="font-bold">Reject</span>
              <span className="text-xs opacity-80">(N)</span>
            </button>

            <button
              onClick={handleEdit}
              className="bg-blue-500 hover:bg-blue-600 text-white p-6 rounded-lg flex flex-col items-center gap-2 transition-colors"
            >
              <FiEdit2 className="w-8 h-8" />
              <span className="font-bold">Correct</span>
              <span className="text-xs opacity-80">(E)</span>
            </button>

            <button
              onClick={handleSkip}
              className="bg-gray-400 hover:bg-gray-500 text-white p-6 rounded-lg flex flex-col items-center gap-2 transition-colors"
            >
              <FiSkipForward className="w-8 h-8" />
              <span className="font-bold">Skip</span>
              <span className="text-xs opacity-80">(S)</span>
            </button>
          </div>

          {/* Stats Bar */}
          <div className="mt-4 bg-white rounded-lg p-4 flex justify-around text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
              <div className="text-gray-600">Approved</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{stats.rejected}</div>
              <div className="text-gray-600">Rejected</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.corrected}</div>
              <div className="text-gray-600">Corrected</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

